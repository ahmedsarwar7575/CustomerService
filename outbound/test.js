// outbound/test.v2.js
import "dotenv/config";
import sequelize from "../config/db.js";
import Agent from "../models/agent.js";
import User from "../models/user.js";
import processCallOutcome from "./summerize.js";

async function ensureTestAgent() {
  try {
    const hasRole = !!Agent?.rawAttributes?.role;
    const where = hasRole ? { role: "agent" } : {};
    const count = await Agent.count({ where });
    if (count === 0) {
      const now = Date.now();
      const payload = {
        firstName: "OB",
        lastName: "Agent",
        email: `ob.agent+${now}@example.com`,
        password: "secret123!",
      };
      if (hasRole) payload.role = "agent";
      await Agent.create(payload);
      console.log("Seeded 1 Agent for assignment.");
    }
  } catch (e) {
    console.warn("Agent seed skipped:", e?.message || e);
  }
}

async function ensureUser({ name, email, phone }) {
  const [user] = await User.findOrCreate({
    where: email ? { email } : { phone },
    defaults: {
      name: name || null,
      email: email || null,
      phone: phone || null,
      status: "active",
    },
  });
  return user;
}

// ----------- Cases you requested -------------
// We will run these for BOTH campaigns separately to show separation.

const SATISFACTION_CASES = [
  {
    label: "1) satisfied",
    callSid: "SAT-1-satisfied",
    qaPairs: [
      { q: "Agent", a: "Are you satisfied with the resolution?" },
      { q: "Customer", a: "Yes, I'm satisfied. Works now." },
    ],
  },
  {
    label: "2) not satisfied",
    callSid: "SAT-2-not-satisfied",
    qaPairs: [
      { q: "Agent", a: "Did we resolve your issue?" },
      { q: "Customer", a: "No, I'm not satisfied. Still failing." },
    ],
  },
  {
    label: "3) did not respond / prefer not to say / call cut",
    callSid: "SAT-3-no-response",
    qaPairs: [
      { q: "Agent", a: "Can you confirm satisfaction?" },
      { q: "Customer", a: "… (call got cut)" },
    ],
  },
];

const UPSELL_CASES = [
  {
    label: "4) interested in upsell",
    callSid: "UP-4-interested",
    qaPairs: [
      { q: "Agent", a: "We have a new plan. Would you like a demo?" },
      { q: "Customer", a: "Yes, schedule a demo please." },
    ],
  },
  {
    label: "5) not interested",
    callSid: "UP-5-not-interested",
    qaPairs: [
      { q: "Agent", a: "Special offer this month." },
      { q: "Customer", a: "No thanks, not interested." },
    ],
  },
  {
    label: "6) did not respond / prefer not to say / call cut",
    callSid: "UP-6-no-response",
    qaPairs: [
      { q: "Agent", a: "Can I share pricing details?" },
      { q: "Customer", a: "(silence) … call cut" },
    ],
  },
];

async function run() {
  try {
    await sequelize.authenticate();
    console.log("✓ DB connected");
    await ensureTestAgent();

    // Create one user for all runs to show idempotency
    const user = await ensureUser({
      name: "Outbound Test",
      email: "outbound.tester@example.com",
      phone: "+15550030001",
    });

    // --- Run satisfaction campaign cases ---
    for (const c of SATISFACTION_CASES) {
      console.log(`\n=== SATISFACTION: ${c.label}`);
      const res = await processCallOutcome({
        qaPairs: c.qaPairs,
        userId: user.id,
        callSid: c.callSid,
        sequelize,
        campaignType: "satisfaction",
      });

      const out = {
        label: c.label,
        error: res?.error,
        outcome: res?.outcome,
        ticketType: res?.ticket?.ticketType || null,
        ticketId: res?.ticket?.id || null,
        agentId: res?.ticket?.agentId || null,
        callId: res?.call?.id || null,
        nextFollowUpAt: res?.outcome?.followupAt || null,
        userId: res?.user?.id || null,
        summary: res?.call?.summary || null,
      };
      console.dir(out, { depth: 5 });
    }

    // --- Run upsell campaign cases ---
    for (const c of UPSELL_CASES) {
      console.log(`\n=== UPSELL: ${c.label}`);
      const res = await processCallOutcome({
        qaPairs: c.qaPairs,
        userId: user.id,
        callSid: c.callSid,
        sequelize,
        campaignType: "upsell",
      });

      const out = {
        label: c.label,
        error: res?.error,
        outcome: res?.outcome,
        ticketType: res?.ticket?.ticketType || null,
        ticketId: res?.ticket?.id || null,
        agentId: res?.ticket?.agentId || null,
        callId: res?.call?.id || null,
        nextFollowUpAt: res?.outcome?.followupAt || null,
        userId: res?.user?.id || null,
        summary: res?.call?.summary || null,
      };
      console.dir(out, { depth: 5 });
    }
  } catch (e) {
    console.error("Test runner error:", e);
  } finally {
    try {
      await sequelize.close();
      console.log("\n✓ DB closed");
    } catch {}
  }
}

run();
