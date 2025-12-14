// outbound/cronJob.js (fixed: no re-call spam + respects user flags)
import cron from "node-cron";
import { Op, fn, col } from "sequelize";
import twilio from "twilio";
import User from "../models/user.js";
import Call from "../models/Call.js";
import { subDays, startOfDay, endOfDay } from "date-fns";
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

// ⬇️ prevents calling the same user again and again within minutes
const ATTEMPT_COOLDOWN_HOURS = 24;

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
  for (const r of rows) {
    if (r.userId && r.lastInboundAt) m.set(r.userId, new Date(r.lastInboundAt));
  }
  return m;
}

async function hasRecentOutboundAttempt(userId, kind) {
  const since = new Date(Date.now() - ATTEMPT_COOLDOWN_HOURS * 60 * 60 * 1000);

  const row = await Call.findOne({
    where: {
      userId,
      type: "outbound",
      callCategory: kind,
      createdAt: { [Op.gte]: since },
    },
    order: [["createdAt", "DESC"]],
  });

  return !!row;
}

async function fetchUsersDueByInbound(daysAgo, kind) {
  const { startUtc, endUtc } = dayWindowUtc(daysAgo);
  const latestInboundMap = await getLatestInboundMap();

  const userIds = Array.from(latestInboundMap.keys());
  if (!userIds.length) return [];

  // Only users we have NOT completed this campaign for
  const userWhere = {
    id: { [Op.in]: userIds },
    phone: { [Op.ne]: null },
  };

  if (kind === "satisfaction" && User.rawAttributes?.isSatisfactionCall) {
    userWhere[Op.or] = [
      { isSatisfactionCall: null },
      { isSatisfactionCall: false },
    ];
  } else if (kind === "upsell" && User.rawAttributes?.isUpSellCall) {
    userWhere[Op.or] = [{ isUpSellCall: null }, { isUpSellCall: false }];
  }

  const users = await User.findAll({
    where: userWhere,
    order: [["createdAt", "ASC"]],
  });

  const entries = [];
  for (const u of users) {
    const lastInboundAt = latestInboundMap.get(u.id);
    if (!lastInboundAt) continue;

    // requirement: if user has a newer inbound call, they won't match this window anyway
    if (!(lastInboundAt >= startUtc && lastInboundAt <= endUtc)) continue;

    // ⬇️ IMPORTANT: avoid re-calling every minute if they didn’t answer
    if (await hasRecentOutboundAttempt(u.id, kind)) continue;

    entries.push({ user: u, lastInboundAt });
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
  for (const { user: u } of entries) {
    try {
      const url = makeUrl(u.id, kind);
      console.log("[CRON] placing call", { kind, userId: u.id, url });

      const call = await client.calls.create({
        to: u.phone,
        from: TWILIO_FROM_NUMBER,
        url,
      });

      // record an outbound attempt immediately (so cooldown works even if no WS happens)
      await Call.findOrCreate({
        where: { callSid: call.sid },
        defaults: {
          callSid: call.sid,
          type: "outbound",
          userId: u.id,
          callCategory: kind,
          summary: `Outbound ${kind} attempt started`,
        },
      });

      const final = await waitForCompletion(call.sid);

      // update attempt row with final status
      await Call.update(
        { summary: `Outbound ${kind} finished: ${final}` },
        { where: { callSid: call.sid } }
      );

      // ✅ Only mark user as "done" if the call was actually answered (completed)
      if (final === "completed") {
        if (kind === "satisfaction")
          await u.update({ isSatisfactionCall: true });
        if (kind === "upsell") await u.update({ isUpSellCall: true });
        console.log(`[CRON] ${kind} DONE userId=${u.id} sid=${call.sid}`);
      } else {
        console.log(
          `[CRON] ${kind} retry-later status=${final} userId=${u.id}`
        );
      }
    } catch (e) {
      console.error(`[CRON] ${kind} FAIL userId=${u.id}`, e?.message || e);
    }
  }
}

export async function runSatisfactionOnce() {
  const entries = await fetchUsersDueByInbound(S_DAYS, "satisfaction");
  if (!entries.length)
    return console.log("[CRON] no users due for 7-day satisfaction");
  await dialSequential(entries, "satisfaction");
}

export async function runUpsellJobOnce() {
  const entries = await fetchUsersDueByInbound(U_DAYS, "upsell");
  if (!entries.length)
    return console.log("[CRON] no users due for 21-day upsell");
  await dialSequential(entries, "upsell");
}

export function startUpsellCron() {
  cron.schedule(
    "*/1 * * * *",
    async () => {
      console.log("[CRON] tick 1m");
      await runSatisfactionOnce().catch((e) =>
        console.error("[CRON] sat error", e)
      );
      await runUpsellJobOnce().catch((e) =>
        console.error("[CRON] upsell error", e)
      );
    },
    { timezone: TZ }
  );
  console.log("[CRON] scheduled every 1m Asia/Karachi");
}
