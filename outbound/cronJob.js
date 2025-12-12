// outbound/cronJob.js (revised, lean)
import cron from "node-cron";
import { Op, fn, col } from "sequelize";
import twilio from "twilio";
import User from "../models/user.js";
import Call from "../models/Call.js";
import { subDays, startOfDay, endOfDay, addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import dotenv from "dotenv";
dotenv.config();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
  PUBLIC_BASE_URL,
  SATISFACTION_DAYS = "7",
  UPSELL_DAYS = "21",
  CALL_STATUS_POLL_SEC = "5",
  CALL_STATUS_TIMEOUT_SEC = "1200",
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const TZ = "Asia/Karachi";
const S_DAYS = parseInt(SATISFACTION_DAYS, 10) || 7;
const U_DAYS = parseInt(UPSELL_DAYS, 10) || 21;
const POLL = parseInt(CALL_STATUS_POLL_SEC, 10) || 5;
const TIMEOUT = parseInt(CALL_STATUS_TIMEOUT_SEC, 10) || 1200;

function dayWindowUtc(daysAgo) {
  const dayLocal = subDays(new Date(), daysAgo);
  const startUtc = fromZonedTime(startOfDay(dayLocal), TZ);
  const endUtc = fromZonedTime(endOfDay(dayLocal), TZ);
  return { startUtc, endUtc };
}

async function getLatestInboundMap() {
  const rows = await Call.findAll({
    attributes: ["userId", [fn("MAX", col("createdAt")), "lastInboundAt"]],
    where: { type: "inbound" },
    group: ["userId"],
    raw: true,
  });
  const m = new Map();
  for (const r of rows)
    if (r.userId && r.lastInboundAt) m.set(r.userId, new Date(r.lastInboundAt));
  return m;
}
async function fetchUsersDueByInbound(daysAgo, kind) {
  const { startUtc, endUtc } = dayWindowUtc(daysAgo);
  const latestInboundMap = await getLatestInboundMap();
  const userIds = Array.from(latestInboundMap.keys());
  if (!userIds.length) return [];

  // 🔥 Only pick users we have NOT already called for this campaign
  const userWhere = {
    id: { [Op.in]: userIds },
    phone: { [Op.ne]: null },
  };

  if (kind === "satisfaction" && User.rawAttributes?.isSatisfactionCall) {
    // only users where isSatisfactionCall is NULL or FALSE
    userWhere[Op.or] = [
      { isSatisfactionCall: null },
      { isSatisfactionCall: false },
    ];
  } else if (kind === "upsell" && User.rawAttributes?.isUpSellCall) {
    // only users where isUpSellCall is NULL or FALSE
    userWhere[Op.or] = [
      { isUpSellCall: null },
      { isUpSellCall: false },
    ];
  }

  const users = await User.findAll({
    where: userWhere,
    order: [["createdAt", "ASC"]],
  });

  const markerField =
    kind === "satisfaction" ? "satisfactionForInboundAt" : "upsellForInboundAt";

  const entries = [];

  for (const u of users) {
    const lastInboundAt = latestInboundMap.get(u.id);
    if (!lastInboundAt) continue;

    const alreadyForThisInbound =
      Object.prototype.hasOwnProperty.call(u.dataValues || u, markerField) &&
      u[markerField] &&
      new Date(u[markerField]).getTime() === lastInboundAt.getTime();
    if (alreadyForThisInbound) continue;

    if (lastInboundAt >= startUtc && lastInboundAt <= endUtc) {
      entries.push({ user: u, lastInboundAt });
    } else if (lastInboundAt > startUtc) {
      const nextAt = addDays(lastInboundAt, daysAgo);
      // you can log nextAt if you like
    }
  }
  return entries;
}


function makeUrl(userId, kind) {
  const base = PUBLIC_BASE_URL || "https://customerservice-kabe.onrender.com";
  const u = new URL(base);
  const basePath = u.pathname.replace(/\/+$/, "");
  u.pathname = `${basePath}/outbound-upsell/${encodeURIComponent(userId)}`;
  u.searchParams.set("kind", String(kind || ""));
  return u.toString();
}

async function waitForCompletion(callSid) {
  const endStatuses = new Set([
    "completed",
    "busy",
    "failed",
    "no-answer",
    "canceled",
  ]);
  const start = Date.now();
  while (Date.now() - start < TIMEOUT * 1000) {
    const c = await client.calls(callSid).fetch();
    if (endStatuses.has(c.status)) return c.status;
    await new Promise((r) => setTimeout(r, POLL * 1000));
  }
  return "timeout";
}

async function dialSequential(entries, kind) {
  for (const { user: u, lastInboundAt } of entries) {
    try {
      const url = makeUrl(u.id, kind);
      console.log("[CRON] placing call", { kind, userId: u.id, url });
      const call = await client.calls.create({
        to: u.phone,
        from: TWILIO_FROM_NUMBER,
        url,
      });
      const final = await waitForCompletion(call.sid);
      if (final === "completed") {
        const markerField =
          kind === "satisfaction"
            ? "satisfactionForInboundAt"
            : "upsellForInboundAt";
        if (
          Object.prototype.hasOwnProperty.call(u.dataValues || u, markerField)
        )
          await u.update({ [markerField]: lastInboundAt });
        else {
          if (kind === "satisfaction")
            await u.update({ isSatisfactionCall: true });
          if (kind === "upsell") await u.update({ isUpSellCall: true });
        }
        console.log(`[CRON] ${kind} OK userId=${u.id} sid=${call.sid}`);
      } else {
        console.log(`[CRON] ${kind} ended status=${final} userId=${u.id}`);
      }
    } catch (e) {
      console.error(`[CRON] ${kind} FAIL userId=${u.id}`, e?.message || e);
    }
  }
}

export async function runSatisfactionOnce() {
  const entries = await fetchUsersDueByInbound(S_DAYS, "satisfaction");
  if (!entries.length)
    return console.log(
      "[CRON] no users due for 7-day satisfaction (inbound-based)"
    );
  await dialSequential(entries, "satisfaction");
}

export async function runUpsellJobOnce() {
  const entries = await fetchUsersDueByInbound(U_DAYS, "upsell");
  if (!entries.length)
    return console.log("[CRON] no users due for 21-day upsell (inbound-based)");
  await dialSequential(entries, "upsell");
}

export function startUpsellCron() {
  cron.schedule(
    "*/1 * * * *",
    async () => {
      console.log("[CRON] tick 1m");
      try {
        await runSatisfactionOnce();
      } catch (e) {
        console.error("[CRON] sat error", e);
      }
      try {
        await runUpsellJobOnce();
      } catch (e) {
        console.error("[CRON] upsell error", e);
      }
    },
    { timezone: TZ }
  );
  console.log("[CRON] scheduled every 1m Asia/Karachi");
}
