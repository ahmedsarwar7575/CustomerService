// inbound/test.js
import "dotenv/config";
import sequelize from "../config/db.js";
import Agent from "../models/agent.js";
import { summarizer } from "./summery.js";

// Force mock mode (no OpenAI calls) unless explicitly disabled
process.env.SUMMARIZER_MOCK = process.env.SUMMARIZER_MOCK || "1";

async function ensureTestAgent() {
  try {
    // Your Agent model requires: firstName, lastName, email, password
    const hasIsActive = !!Agent?.rawAttributes?.isActive;
    const hasTicketType = !!Agent?.rawAttributes?.ticketType;

    const where = {};
    if (hasIsActive) where.isActive = true;

    const count = await Agent.count({ where });
    if (count === 0) {
      const now = Date.now();
      const payload = {
        firstName: "Test",
        lastName: "Agent",
        email: `test.agent+${now}@example.com`,
        password: "secret123!",
      };
      if (hasIsActive) payload.isActive = true; // active
      if (hasTicketType) payload.ticketType = null; // generalist
      await Agent.create(payload);
      console.log("Seeded 1 Agent for ticket assignment.");
    }
  } catch (e) {
    console.warn(
      "Agent model missing or failed to seed. Ticket assignment may be null.",
      e?.message
    );
  }
}

const cases = [
  {
    label: "1) Greeting-only (no conversation) → no DB writes",
    callSid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    phone: "+15550001001",
    pairs: [
      { q: "Agent", a: "Hello! Thanks for calling GETPIE support." },
      { q: "Agent", a: "How can I help you today?" },
      { q: "Customer", a: "Hi… just testing the line. Bye." },
    ],
  },
  // NEW: explicit contact-info-only so it hits the user-only path
  {
    label: "2) Contact info only (user-only) – explicit 'no issue'",
    callSid: "CA9a2c1f5b7e84d0c9a2c1f5b7e84d0c9",
    phone: "+15550012002",
    pairs: [
      { q: "Agent", a: "How can I help today?" },
      {
        q: "Customer",
        a: "I only want to register my details — no issue right now.",
      },
      { q: "Agent", a: "Sure, your name and email?" },
      {
        q: "Customer",
        a: "My name is John Smath and my email is john.smath+ci@example.com. That's it; only my name and email.",
      },
    ],
  },
  {
    label: "3) Satisfied flow → user + call, NO ticket",
    callSid: "CAccccccccccccccccccccccccccccccccc",
    phone: "+15550001003",
    pairs: [
      { q: "Agent", a: "How can I help?" },
      { q: "Customer", a: "I can't log in; I forgot my password." },
      {
        q: "Agent",
        a: "I sent a reset link to alice@example.com, please try it.",
      },
      {
        q: "Customer",
        a: "Done. I can log in now. This solves it. I'm satisfied.",
      },
    ],
  },
  {
    label:
      "4) Unsatisfied flow → user + call + ticket (assign least-loaded agent)",
    callSid: "CAddddddddddddddddddddddddddddddddd",
    phone: "+15550001004",
    pairs: [
      { q: "Agent", a: "How can I help?" },
      { q: "Customer", a: "My card is declined when I pay invoice 7842." },
      { q: "Agent", a: "Try clearing cache and a different browser." },
      {
        q: "Customer",
        a: "Tried Chrome & Firefox. Still failing with error P-102. Not satisfied.",
      },
    ],
  },
  {
    label: "5) Same phone as #4 → no new user, create new Call",
    callSid: "CAeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    phone: "+15550001004",
    pairs: [
      { q: "Agent", a: "Welcome back. How can I help?" },
      { q: "Customer", a: "Just checking my ticket status." },
      { q: "Agent", a: "It's in progress; you'll get an email shortly." },
      { q: "Customer", a: "Okay, thanks." },
    ],
  },
  {
    label: "6) Invalid email → user by phone, unsatisfied → ticket",
    callSid: "CAffffffffffffffffffffffffffffffff",
    phone: "+15550001006",
    pairs: [
      { q: "Agent", a: "How can I help?" },
      {
        q: "Customer",
        a: "Contact me at bob@@example.com. App crashes on start.",
      },
      { q: "Agent", a: "Share the steps, please." },
      {
        q: "Customer",
        a: "Open app → tap Dashboard → it closes. I'm not satisfied.",
      },
    ],
  },
  {
    label: "7) Misspelled name (fix to Michael/Smith) → unsatisfied → ticket",
    callSid: "CA11111111111111111111111111111111",
    phone: "+15550001007",
    pairs: [
      { q: "Agent", a: "Your name and email?" },
      { q: "Customer", a: "It's Mchael Smath, email m.smath@example.com." },
      { q: "Agent", a: "What's the issue?" },
      {
        q: "Customer",
        a: "Billing charged me twice for order 12345; not happy.",
      },
    ],
  },
  {
    label: "8) Urdu detected → satisfied → NO ticket",
    callSid: "CA22222222222222222222222222222222",
    phone: "+15550001008",
    pairs: [
      { q: "Agent", a: "How can I help?" },
      { q: "Customer", a: "Assalam o Alaikum, my order hasn't arrived." },
      { q: "Agent", a: "Do you have the order number?" },
      { q: "Customer", a: "Ji haan, 55673. Can you track it?" },
      { q: "Agent", a: "It's out for delivery today." },
      { q: "Customer", a: "Theek hai, thanks. I'm satisfied." },
    ],
  },
  {
    label: "9) No email shared (phone only) → unsatisfied → ticket",
    callSid: "CA33333333333333333333333333333333",
    phone: "+15550001009",
    pairs: [
      { q: "Agent", a: "How can I help?" },
      {
        q: "Customer",
        a: "My shipment is lost; tracking shows delivered but I didn't receive it.",
      },
      { q: "Agent", a: "We'll investigate and open a case." },
      { q: "Customer", a: "Please do. I'm not satisfied." },
    ],
  },
];

async function run() {
  try {
    await sequelize.authenticate();
    await ensureTestAgent();

    for (const c of cases) {
      console.log(`\n==============================\nRunning: ${c.label}`);
      const res = await summarizer(c.pairs, c.callSid, c.phone);
      const out = {
        label: c.label,
        returnedKeys: Object.keys(res),
        note: res.note,
        skipped: res.skipped,
        error: res.error,
        userId: res?.user?.id,
        ticketId: res?.ticket?.id,
        callId: res?.call?.id,
        agentId: res?.agentId,
        extracted: res?.extracted && {
          name: res.extracted.name,
          email: res.extracted.email,
          phone: res.extracted.phone,
          isSatisfied: res.extracted.isSatisfied,
          hasConversation: res.extracted.hasConversation,
          contactInfoOnly: res.extracted.contactInfoOnly,
          languages: res.extracted.languages,
          summary: res.extracted.summary,
        },
      };
      console.dir(out, { depth: 5 });
    }
  } catch (e) {
    console.error("Test runner error:", e);
  } finally {
    try {
      await sequelize.close();
    } catch {}
  }
}

run();
