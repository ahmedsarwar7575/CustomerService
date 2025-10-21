import cron from "node-cron";
import { Op } from "sequelize";
import twilio from "twilio";
import User from "../models/user.js";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import dotenv from "dotenv";
dotenv.config();
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_BASE_URL } = process.env;
// if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !PUBLIC_BASE_URL) {
//   throw new Error("Missing env");
// }
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

function getTwentyOneDaysAgoUtcWindow() {
  const TZ = "Asia/Karachi";
  const dayLocal = subDays(new Date(), 21);
  const startUtc = fromZonedTime(startOfDay(dayLocal), TZ);
  const endUtc = fromZonedTime(endOfDay(dayLocal), TZ);
  return { startUtc, endUtc };
}

async function fetchUsersForUpsell() {
  const { startUtc, endUtc } = getTwentyOneDaysAgoUtcWindow();
  return User.findAll({
    where: {
      createdAt: { [Op.between]: [startUtc, endUtc] },
      phone: { [Op.ne]: null },
    },
  });
}

async function callUser(user) {
  const url = `${PUBLIC_BASE_URL}/outbound-upsell?userId=${encodeURIComponent(user.id)}`;
  return client.calls.create({ to: user.phone, from: TWILIO_FROM_NUMBER, url });
}

export async function runUpsellJobOnce() {
  const users = await fetchUsersForUpsell();
  if (!users.length) { console.log("[CRON] No users turning 21 days today."); return; }
  const results = await Promise.allSettled(users.map((u) => callUser(u)));
  results.forEach((r, i) => {
    const u = users[i];
    if (r.status === "fulfilled") console.log(`[CRON] OK userId=${u.id} to=${u.phone} sid=${r.value.sid}`);
    else console.error(`[CRON] FAIL userId=${u.id} to=${u.phone}`, r.reason);
  });
}

export function startUpsellCron() {
  cron.schedule("0 10 * * *", () => {
    console.log("[CRON] Running upsell-caller...");
    runUpsellJobOnce().catch((e) => console.error("[CRON] Job error:", e));
  }, { timezone: "Asia/Karachi" });
  console.log("[CRON] upsell-caller scheduled for 10:00 Asia/Karachi daily");
}
