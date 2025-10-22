// outbound/cronJob.js
import cron from "node-cron";
import { Op } from "sequelize";
import twilio from "twilio";
import User from "../models/user.js";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import dotenv from "dotenv";
dotenv.config();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
  PUBLIC_BASE_URL,
  // dynamic/test overrides:
  SATISFACTION_DAYS = "7",
  UPSELL_DAYS = "21",
  CALL_STATUS_POLL_SEC = "5",
  CALL_STATUS_TIMEOUT_SEC = "1200", // 20m
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const TZ = "Asia/Karachi";

const S_DAYS = parseInt(SATISFACTION_DAYS, 10) || 7;
const U_DAYS = parseInt(UPSELL_DAYS, 10) || 21;
const POLL = parseInt(CALL_STATUS_POLL_SEC, 10) || 5;
const TIMEOUT = parseInt(CALL_STATUS_TIMEOUT_SEC, 10) || 1200;

 function dayWindowUtc(daysAgo) {
     const dayLocal = subDays(new Date(), daysAgo);     // local date anchor
     const startUtc = fromZonedTime(startOfDay(dayLocal), TZ);
     const endUtc = fromZonedTime(endOfDay(dayLocal), TZ);
     return { startUtc, endUtc };
   }

async function fetchUsers(daysAgo, kind) {
  const { startUtc, endUtc } = dayWindowUtc(daysAgo);
  const where = {
    createdAt: { [Op.between]: [startUtc, endUtc] },
    phone: { [Op.ne]: null },
  };
  if (kind === "satisfaction") where.isSatisfactionCall = false;
  if (kind === "upsell") where.isUpSellCall = false;
  return User.findAll({ where, order: [["createdAt", "ASC"]] });
}

function makeUrl(kind, userId) {
  const path = kind === "satisfaction" ? "outbound-satisfaction" : "outbound-upsell";
  return `${PUBLIC_BASE_URL}/${path}?userId=${encodeURIComponent(userId)}`;
}

async function waitForCompletion(callSid) {
  const endStatuses = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
  const start = Date.now();
  while (Date.now() - start < TIMEOUT * 1000) {
    const c = await client.calls(callSid).fetch();
    if (endStatuses.has(c.status)) return c.status;
    await new Promise(r => setTimeout(r, POLL * 1000));
  }
  return "timeout";
}

async function dialSequential(users, kind) {
  for (const u of users) {
    try {
      const url = makeUrl(kind, u.id);
      const call = await client.calls.create({ to: u.phone, from: TWILIO_FROM_NUMBER, url });
      const final = await waitForCompletion(call.sid);
      if (final === "completed") {
        if (kind === "satisfaction") await u.update({ isSatisfactionCall: true });
        if (kind === "upsell") await u.update({ isUpSellCall: true });
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
  const users = await fetchUsers(S_DAYS, "satisfaction");
  if (!users.length) { console.log("[CRON] no 7-day (config) users"); return; }
  await dialSequential(users, "satisfaction");
}

export async function runUpsellJobOnce() {
  const users = await fetchUsers(U_DAYS, "upsell");
  if (!users.length) { console.log("[CRON] no 21-day (config) users"); return; }
  await dialSequential(users, "upsell");
}

export function startUpsellCron() {
  cron.schedule("*/1 * * * *", async () => {
    console.log("[CRON] tick 30m");
    try { await runSatisfactionOnce(); } catch (e) { console.error("[CRON] sat error", e); }
    try { await runUpsellJobOnce(); } catch (e) { console.error("[CRON] upsell error", e); }
  }, { timezone: TZ });
  console.log("[CRON] scheduled every 30m Asia/Karachi");
}
