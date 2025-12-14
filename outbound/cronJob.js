// outbound/cronJob.js
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

// ✅ lock so cron does NOT overlap (your biggest issue)
let cronRunning = false;

function dayWindowUtc(daysAgo) {
  const dayLocal = subDays(new Date(), daysAgo);
  const startUtc = fromZonedTime(startOfDay(dayLocal), TZ);
  const endUtc = fromZonedTime(endOfDay(dayLocal), TZ);
  return { startUtc, endUtc };
}

// ✅ retry grace: allow 7 OR 8 days (and 21 OR 22 days)
function dueWindowsUtc(daysAgo, retryExtraDays = 1) {
  const w1 = dayWindowUtc(daysAgo);
  const w2 = dayWindowUtc(daysAgo + retryExtraDays);
  return [w1, w2];
}

// ✅ latest inbound per user (this already solves: "if user called 2 days ago, exclude 7 days")
async function getLatestInboundMap() {
  const rows = await Call.findAll({
    attributes: ["userId", [fn("MAX", col("createdAt")), "lastInboundAt"]],
    where: { type: "inbound" },
    group: ["userId"],
    raw: true,
  });

  const m = new Map();
  for (const r of rows) {
    if (r.userId && r.lastInboundAt) {
      m.set(r.userId, new Date(r.lastInboundAt));
    }
  }
  return m;
}

function makeUrl(userId, kind) {
  const base = PUBLIC_BASE_URL || "https://customerservice-kabe.onrender.com";
  const u = new URL(base);
  const basePath = u.pathname.replace(/\/+$/, "");
  u.pathname = `${basePath}/outbound-upsell/${encodeURIComponent(userId)}`;
  u.searchParams.set("kind", String(kind || ""));
  return u.toString();
}

// ✅ prevent spam: if we already attempted today for that user+campaign, skip
async function getAttemptedTodayUserIdSet(userIds, kind) {
  if (!userIds.length) return new Set();

  const { startUtc, endUtc } = dayWindowUtc(0);

  const rows = await Call.findAll({
    attributes: ["userId"],
    where: {
      type: "outbound",
      callCategory: kind,
      userId: { [Op.in]: userIds },
      createdAt: { [Op.between]: [startUtc, endUtc] },
    },
    group: ["userId"],
    raw: true,
  });

  return new Set(rows.map((r) => String(r.userId)));
}

function inAnyWindow(date, windows) {
  for (const w of windows) {
    if (date >= w.startUtc && date <= w.endUtc) return true;
  }
  return false;
}

// ✅ main selector: latest inbound must be due AND user flags must be false/null AND not attempted today
async function fetchUsersDueByInbound(daysAgo, kind) {
  const latestInboundMap = await getLatestInboundMap();
  const userIds = Array.from(latestInboundMap.keys());
  if (!userIds.length) return [];

  const userWhere = {
    id: { [Op.in]: userIds },
    phone: { [Op.ne]: null },
  };

  // ✅ rule #3 (don’t call already-contacted users)
  if (kind === "satisfaction" && User.rawAttributes?.isSatisfactionCall) {
    userWhere[Op.or] = [{ isSatisfactionCall: null }, { isSatisfactionCall: false }];
  }
  if (kind === "upsell" && User.rawAttributes?.isUpSellCall) {
    userWhere[Op.or] = [{ isUpSellCall: null }, { isUpSellCall: false }];
  }

  const users = await User.findAll({
    where: userWhere,
    order: [["createdAt", "ASC"]],
  });

  // ✅ rule #4 retry support (7 OR 8) / (21 OR 22)
  const windows = dueWindowsUtc(daysAgo, 1);

  // ✅ spam blocker (only 1 attempt per day)
  const attemptedToday = await getAttemptedTodayUserIdSet(
    users.map((u) => u.id),
    kind
  );

  const entries = [];
  for (const u of users) {
    const lastInboundAt = latestInboundMap.get(u.id);
    if (!lastInboundAt) continue;

    if (attemptedToday.has(String(u.id))) continue;
    if (!inAnyWindow(lastInboundAt, windows)) continue;

    entries.push({ user: u, lastInboundAt });
  }

  return entries;
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

      // ✅ create a Call row even if user NEVER answers (fixes spam + tracking)
      await Call.findOrCreate({
        where: { callSid: call.sid },
        defaults: {
          callSid: call.sid,
          type: "outbound",
          userId: u.id,
          callCategory: kind,
          summary: "",
        },
      });

      const final = await waitForCompletion(call.sid);

      // ✅ if user attended => set TRUE
      if (final === "completed") {
        if (kind === "satisfaction" && User.rawAttributes?.isSatisfactionCall) {
          await u.update({ isSatisfactionCall: true });
        }
        if (kind === "upsell" && User.rawAttributes?.isUpSellCall) {
          await u.update({ isUpSellCall: true });
        }
      } else {
        // ✅ if user did NOT attend => keep FALSE so we can retry (and do not spam same day)
        if (kind === "satisfaction" && User.rawAttributes?.isSatisfactionCall) {
          await u.update({ isSatisfactionCall: false });
        }
        if (kind === "upsell" && User.rawAttributes?.isUpSellCall) {
          await u.update({ isUpSellCall: false });
        }
      }

      // ✅ store result in Call row (optional but helpful)
      await Call.update(
        {
          type: "outbound",
          userId: u.id,
          callCategory: kind,
          outboundDetails: {
            twilioFinalStatus: final,
            lastInboundAtUsed: lastInboundAt?.toISOString?.() || null,
          },
        },
        { where: { callSid: call.sid } }
      );

      console.log(`[CRON] ${kind} ended status=${final} userId=${u.id} sid=${call.sid}`);
    } catch (e) {
      console.error(`[CRON] ${kind} FAIL userId=${u.id}`, e?.message || e);
    }
  }
}

export async function runSatisfactionOnce() {
  const entries = await fetchUsersDueByInbound(S_DAYS, "satisfaction");
  if (!entries.length) {
    console.log("[CRON] no users due for 7-day satisfaction (latest-inbound-based)");
    return;
  }
  await dialSequential(entries, "satisfaction");
}

export async function runUpsellJobOnce() {
  const entries = await fetchUsersDueByInbound(U_DAYS, "upsell");
  if (!entries.length) {
    console.log("[CRON] no users due for 21-day upsell (latest-inbound-based)");
    return;
  }
  await dialSequential(entries, "upsell");
}

export function startUpsellCron() {
  cron.schedule(
    "*/1 * * * *",
    async () => {
      if (cronRunning) {
        console.log("[CRON] skip tick (previous run still running)");
        return;
      }

      cronRunning = true;
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

      cronRunning = false;
    },
    { timezone: TZ }
  );

  console.log("[CRON] scheduled every 1m Asia/Karachi (no overlap)");
}
