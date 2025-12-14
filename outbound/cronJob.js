// outbound/cronJob.js (corrected)
import cron from "node-cron";
import { Op, fn, col, literal } from "sequelize";
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

function getDateWindowUtc(daysAgo) {
  const targetDate = subDays(new Date(), daysAgo);
  const startUtc = fromZonedTime(startOfDay(targetDate), TZ);
  const endUtc = fromZonedTime(endOfDay(targetDate), TZ);
  return { startUtc, endUtc };
}

async function getUsersForOutbound(daysAgo, kind) {
  const { startUtc, endUtc } = getDateWindowUtc(daysAgo);

  // STEP 1 & 2: Find users with inbound calls exactly 7/21 days ago
  // and ensure it's their LAST inbound call
  const usersWithCalls = await User.findAll({
    attributes: ["id", "phone", "isSatisfactionCall", "isUpSellCall"],
    include: [
      {
        model: Call,
        as: "calls",
        where: {
          type: "inbound",
          createdAt: {
            [Op.between]: [startUtc, endUtc],
          },
        },
        required: true,
      },
    ],
    where: {
      phone: { [Op.ne]: null },
    },
    raw: true,
    nest: true,
  });

  // Filter users to ensure this is their LAST inbound call
  const eligibleUsers = [];

  for (const user of usersWithCalls) {
    // Check if this is the user's last inbound call
    const lastInboundCall = await Call.findOne({
      where: {
        userId: user.id,
        type: "inbound",
      },
      order: [["createdAt", "DESC"]],
      limit: 1,
    });

    // If the last inbound call is NOT from 7/21 days ago, skip this user
    if (
      !lastInboundCall ||
      lastInboundCall.createdAt < startUtc ||
      lastInboundCall.createdAt > endUtc
    ) {
      continue;
    }

    // STEP 3: Check if we already made this type of call
    if (kind === "satisfaction" && user.isSatisfactionCall) {
      continue;
    }
    if (kind === "upsell" && user.isUpSellCall) {
      continue;
    }

    eligibleUsers.push({
      user: {
        id: user.id,
        phone: user.phone,
        isSatisfactionCall: user.isSatisfactionCall,
        isUpSellCall: user.isUpSellCall,
      },
      callId: lastInboundCall.id,
      lastInboundAt: lastInboundCall.createdAt,
    });
  }

  return eligibleUsers;
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
    try {
      const c = await client.calls(callSid).fetch();
      if (endStatuses.has(c.status)) return c.status;
      await new Promise((r) => setTimeout(r, POLL * 1000));
    } catch (error) {
      console.error(`Error polling call status: ${error.message}`);
      return "failed";
    }
  }
  return "timeout";
}

async function processOutboundCall(userData, kind) {
  const { user, callId, lastInboundAt } = userData;

  try {
    console.log(
      `[CRON] Placing ${kind} call to user ${user.id} at ${user.phone}`
    );

    const url = makeUrl(user.id, kind);
    const call = await client.calls.create({
      to: user.phone,
      from: TWILIO_FROM_NUMBER,
      url,
      statusCallback: `${PUBLIC_BASE_URL}/outbound-callback`,
      statusCallbackEvent: ["completed", "failed", "busy", "no-answer"],
      statusCallbackMethod: "POST",
    });

    const finalStatus = await waitForCompletion(call.sid);

    // STEP 4 & 5: Handle call attendance
    if (finalStatus === "completed") {
      // User attended the call
      const updateData =
        kind === "satisfaction"
          ? { isSatisfactionCall: true }
          : { isUpSellCall: true };

      await User.update(updateData, { where: { id: user.id } });
      console.log(`[CRON] ${kind} call attended for user ${user.id}`);
    } else {
      // User did NOT attend the call
      // Reset the call date to one day before so it gets picked up tomorrow
      const newCallDate = subDays(lastInboundAt, 1);

      await Call.update({ createdAt: newCallDate }, { where: { id: callId } });

      // Reset the call flag to false so we try again
      const resetData =
        kind === "satisfaction"
          ? { isSatisfactionCall: false }
          : { isUpSellCall: false };

      await User.update(resetData, { where: { id: user.id } });
      console.log(
        `[CRON] ${kind} call not attended for user ${user.id}, resetting for tomorrow`
      );
    }

    return { success: true, status: finalStatus };
  } catch (error) {
    console.error(
      `[CRON] Error processing ${kind} call for user ${user.id}:`,
      error.message
    );
    return { success: false, error: error.message };
  }
}

export async function runSatisfactionOnce() {
  console.log(`[CRON] Running satisfaction check for ${S_DAYS} days ago`);

  const eligibleUsers = await getUsersForOutbound(S_DAYS, "satisfaction");

  if (eligibleUsers.length === 0) {
    console.log("[CRON] No users eligible for satisfaction calls");
    return;
  }

  console.log(
    `[CRON] Found ${eligibleUsers.length} users for satisfaction calls`
  );

  // Process calls sequentially
  for (const userData of eligibleUsers) {
    await processOutboundCall(userData, "satisfaction");
    // Add a small delay between calls to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function runUpsellJobOnce() {
  console.log(`[CRON] Running upsell check for ${U_DAYS} days ago`);

  const eligibleUsers = await getUsersForOutbound(U_DAYS, "upsell");

  if (eligibleUsers.length === 0) {
    console.log("[CRON] No users eligible for upsell calls");
    return;
  }

  console.log(`[CRON] Found ${eligibleUsers.length} users for upsell calls`);

  // Process calls sequentially
  for (const userData of eligibleUsers) {
    await processOutboundCall(userData, "upsell");
    // Add a small delay between calls to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export function startUpsellCron() {
  // Run every 5 minutes instead of every minute to avoid overlapping executions
  cron.schedule(
    "*/5 * * * *",
    async () => {
      console.log("[CRON] Starting outbound call process");

      try {
        await runSatisfactionOnce();
      } catch (error) {
        console.error("[CRON] Error in satisfaction job:", error);
      }

      try {
        await runUpsellJobOnce();
      } catch (error) {
        console.error("[CRON] Error in upsell job:", error);
      }

      console.log("[CRON] Outbound call process completed");
    },
    {
      timezone: TZ,
      scheduled: true,
      runOnInit: false,
    }
  );

  console.log("[CRON] Scheduled outbound calls every 5 minutes");
}

// Also add a callback handler for Twilio status updates
export async function handleCallStatusCallback(req, res) {
  const { CallSid, CallStatus } = req.body;

  console.log(`[Twilio Callback] Call ${CallSid} status: ${CallStatus}`);

  // You might want to update your database here based on the callback
  // This provides more reliable status updates than polling

  res.status(200).send("OK");
}
