// outbound/sendCallController.js
import { Op } from "sequelize";
import twilio from "twilio";
import dotenv from "dotenv";
import User from "../models/user.js";
import Call from "../models/Call.js";

dotenv.config();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
  PUBLIC_BASE_URL,
  CALL_STATUS_POLL_SEC = "5",
  CALL_STATUS_TIMEOUT_SEC = "1200",
} = process.env;

const client =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

const POLL = parseInt(CALL_STATUS_POLL_SEC, 10) || 5;
const TIMEOUT = parseInt(CALL_STATUS_TIMEOUT_SEC, 10) || 1200;

// same cooldown behavior as cron job
const ATTEMPT_COOLDOWN_HOURS = 24;

function makeUrl(userId, kind) {
  const base = PUBLIC_BASE_URL || "https://customerservice-kabe.onrender.com";
  const u = new URL(base);
  const basePath = u.pathname.replace(/\/+$/, "");
  u.pathname = `${basePath}/outbound-upsell/${encodeURIComponent(userId)}`;
  u.searchParams.set("kind", String(kind || ""));
  return u.toString();
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

/**
 * POST body example:
 * {
 *   "userId": 123,
 *   "type": "satisfaction" // or "upsell"
 * }
 *
 * Optional:
 * - wait: boolean (default true). If false, returns immediately with callSid.
 */
export const sendCallController = async (req, res) => {
  try {
    if (!client || !TWILIO_FROM_NUMBER) {
      return res.status(500).json({
        error: "twilio_not_configured",
        message: "Missing TWILIO_* env vars (account/auth/from).",
      });
    }

    const userId = req.body?.userId ?? req.params?.userId;
    const kindRaw = req.body?.type ?? req.body?.kind ?? req.query?.type ?? req.query?.kind;

    const kind = String(kindRaw || "").toLowerCase().trim();
    if (!userId) return res.status(400).json({ error: "missing_userId" });
    if (!["satisfaction", "upsell"].includes(kind)) {
      return res.status(400).json({
        error: "invalid_type",
        message: "type must be 'satisfaction' or 'upsell'",
      });
    }

    const wait =
      req.body?.wait === undefined ? true : !!req.body.wait;

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: "user_not_found" });
    if (!user.phone) return res.status(400).json({ error: "user_missing_phone" });

    // respect "already completed" flags (same idea as cron userWhere filters)
    if (kind === "satisfaction" && User.rawAttributes?.isSatisfactionCall && user.isSatisfactionCall) {
      return res.json({ skipped: "already_completed", type: kind, userId: user.id });
    }
    if (kind === "upsell" && User.rawAttributes?.isUpSellCall && user.isUpSellCall) {
      return res.json({ skipped: "already_completed", type: kind, userId: user.id });
    }

    // cooldown (avoid spam)
    if (await hasRecentOutboundAttempt(user.id, kind)) {
      return res.status(429).json({
        error: "cooldown_active",
        message: `Outbound ${kind} was attempted within last ${ATTEMPT_COOLDOWN_HOURS}h`,
        userId: user.id,
        type: kind,
      });
    }

    const url = makeUrl(user.id, kind);

    // place call
    const call = await client.calls.create({
      to: user.phone,
      from: TWILIO_FROM_NUMBER,
      url,
    });

    // record outbound attempt immediately
    await Call.findOrCreate({
      where: { callSid: call.sid },
      defaults: {
        callSid: call.sid,
        type: "outbound",
        userId: user.id,
        callCategory: kind,
        summary: `Outbound ${kind} attempt started`,
      },
    });

    // return early if caller doesn't want to wait
    if (!wait) {
      return res.status(202).json({
        ok: true,
        queued: true,
        callSid: call.sid,
        userId: user.id,
        type: kind,
        url,
      });
    }

    // wait like cron
    const final = await waitForCompletion(call.sid);

    // update attempt row with final status
    await Call.update(
      { summary: `Outbound ${kind} finished: ${final}` },
      { where: { callSid: call.sid } }
    );

    // mark user only if answered/completed (same rule)
    if (final === "completed") {
      if (kind === "satisfaction") await user.update({ isSatisfactionCall: true });
      if (kind === "upsell") await user.update({ isUpSellCall: true });
    }

    return res.json({
      ok: true,
      callSid: call.sid,
      finalStatus: final,
      userId: user.id,
      type: kind,
      markedDone: final === "completed",
    });
  } catch (e) {
    console.error("[sendCallController] error:", e?.message || e);
    return res.status(500).json({
      error: "send_call_failed",
      message: String(e?.message || e),
    });
  }
};
