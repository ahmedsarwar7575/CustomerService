// outbound/cronJob.js (corrected with proper association)
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
  
  // First, let's find all inbound calls from exactly X days ago
  const callsFromTargetDate = await Call.findAll({
    where: {
      type: 'inbound',
      createdAt: {
        [Op.between]: [startUtc, endUtc]
      }
    },
    order: [['createdAt', 'DESC']],
    raw: true
  });

  if (!callsFromTargetDate.length) {
    return [];
  }

  // Group calls by userId
  const callsByUser = {};
  for (const call of callsFromTargetDate) {
    if (call.userId) {
      if (!callsByUser[call.userId]) {
        callsByUser[call.userId] = [];
      }
      callsByUser[call.userId].push(call);
    }
  }

  const eligibleUsers = [];

  // Check each user
  for (const [userId, calls] of Object.entries(callsByUser)) {
    // Get the latest call from this date for this user
    const latestCallFromTargetDate = calls[0]; // Already sorted DESC
    
    // Check if this is the user's LAST inbound call overall
    const lastInboundCallOverall = await Call.findOne({
      where: {
        userId: userId,
        type: 'inbound'
      },
      order: [['createdAt', 'DESC']],
      raw: true
    });

    // If the latest call from target date is NOT the last inbound call, skip
    if (!lastInboundCallOverall || 
        lastInboundCallOverall.id !== latestCallFromTargetDate.id) {
      continue;
    }

    // Get user details
    const user = await User.findOne({
      where: {
        id: userId,
        phone: { [Op.ne]: null }
      },
      raw: true
    });

    if (!user) continue;

    // Check if we already made this type of call
    if (kind === 'satisfaction' && user.isSatisfactionCall) {
      continue;
    }
    if (kind === 'upsell' && user.isUpSellCall) {
      continue;
    }

    eligibleUsers.push({
      user: {
        id: user.id,
        phone: user.phone,
        isSatisfactionCall: user.isSatisfactionCall,
        isUpSellCall: user.isUpSellCall
      },
      callId: latestCallFromTargetDate.id,
      lastInboundAt: latestCallFromTargetDate.createdAt
    });
  }

  return eligibleUsers;
}

// Alternative approach using raw query if associations are problematic
async function getUsersForOutboundAlternative(daysAgo, kind) {
  const { startUtc, endUtc } = getDateWindowUtc(daysAgo);
  
  // This approach uses a subquery to find users whose last inbound call was exactly X days ago
  const query = `
    SELECT 
      u.id,
      u.phone,
      u."isSatisfactionCall",
      u."isUpSellCall",
      c.id as "callId",
      c."createdAt" as "lastInboundAt"
    FROM "Users" u
    INNER JOIN "Calls" c ON u.id = c."userId"
    WHERE c.type = 'inbound'
      AND c."createdAt" BETWEEN :startDate AND :endDate
      AND c.id = (
        SELECT id 
        FROM "Calls" 
        WHERE "userId" = u.id 
          AND type = 'inbound'
        ORDER BY "createdAt" DESC 
        LIMIT 1
      )
      AND u.phone IS NOT NULL
      AND (
        (:kind = 'satisfaction' AND (u."isSatisfactionCall" = false OR u."isSatisfactionCall" IS NULL)) OR
        (:kind = 'upsell' AND (u."isUpSellCall" = false OR u."isUpSellCall" IS NULL))
      )
    ORDER BY u."createdAt" ASC
  `;

  try {
    const [results] = await User.sequelize.query(query, {
      replacements: {
        startDate: startUtc,
        endDate: endUtc,
        kind: kind
      },
      type: User.sequelize.QueryTypes.SELECT
    });

    return Array.isArray(results) ? results : (results ? [results] : []);
  } catch (error) {
    console.error('Error in raw query:', error);
    return [];
  }
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
    "canceled"
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
    console.log(`[CRON] Placing ${kind} call to user ${user.id} at ${user.phone}`);
    
    const url = makeUrl(user.id, kind);
    const call = await client.calls.create({
      to: user.phone,
      from: TWILIO_FROM_NUMBER,
      url,
      statusCallback: `${PUBLIC_BASE_URL}/outbound-callback`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer'],
      statusCallbackMethod: 'POST'
    });

    const finalStatus = await waitForCompletion(call.sid);
    
    // Handle call attendance
    if (finalStatus === 'completed') {
      // User attended the call
      const updateData = kind === 'satisfaction' 
        ? { isSatisfactionCall: true }
        : { isUpSellCall: true };
      
      await User.update(updateData, { where: { id: user.id } });
      console.log(`[CRON] ${kind} call attended for user ${user.id}`);
      
    } else {
      // User did NOT attend the call
      // Reset the call date to one day before so it gets picked up tomorrow
      const newCallDate = new Date(lastInboundAt);
      newCallDate.setDate(newCallDate.getDate() - 1);
      
      await Call.update(
        { createdAt: newCallDate },
        { where: { id: callId } }
      );
      
      // Reset the call flag to false so we try again
      const resetData = kind === 'satisfaction'
        ? { isSatisfactionCall: false }
        : { isUpSellCall: false };
      
      await User.update(resetData, { where: { id: user.id } });
      console.log(`[CRON] ${kind} call not attended for user ${user.id}, resetting for tomorrow`);
    }
    
    return { success: true, status: finalStatus };
    
  } catch (error) {
    console.error(`[CRON] Error processing ${kind} call for user ${user.id}:`, error.message);
    return { success: false, error: error.message };
  }
}

export async function runSatisfactionOnce() {
  console.log(`[CRON] Running satisfaction check for ${S_DAYS} days ago`);
  
  // Try using the alternative method first
  const eligibleUsers = await getUsersForOutboundAlternative(S_DAYS, 'satisfaction');
  
  if (eligibleUsers.length === 0) {
    console.log('[CRON] No users eligible for satisfaction calls');
    return;
  }
  
  console.log(`[CRON] Found ${eligibleUsers.length} users for satisfaction calls`);
  
  // Process calls sequentially
  for (const userData of eligibleUsers) {
    await processOutboundCall(userData, 'satisfaction');
    // Add a small delay between calls to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export async function runUpsellJobOnce() {
  console.log(`[CRON] Running upsell check for ${U_DAYS} days ago`);
  
  // Try using the alternative method first
  const eligibleUsers = await getUsersForOutboundAlternative(U_DAYS, 'upsell');
  
  if (eligibleUsers.length === 0) {
    console.log('[CRON] No users eligible for upsell calls');
    return;
  }
  
  console.log(`[CRON] Found ${eligibleUsers.length} users for upsell calls`);
  
  // Process calls sequentially
  for (const userData of eligibleUsers) {
    await processOutboundCall(userData, 'upsell');
    // Add a small delay between calls to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

export function startUpsellCron() {
  // Run every 5 minutes instead of every minute to avoid overlapping executions
  cron.schedule("*/5 * * * *", async () => {
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
  }, {
    timezone: TZ,
    scheduled: true,
    runOnInit: false
  });
  
  console.log("[CRON] Scheduled outbound calls every 5 minutes");
}