// seeder.js
import { Agent, User, Ticket, Rating, Call } from "../models/index.js";
import { Email } from "../models/Email.js";

// If you want to force re-seed, handle that at app level with sync({ force: true })
// This file assumes tables already exist.

export default async function seedDatabase() {
  try {
    // ---------- AGENTS ----------
    const agents = await Agent.bulkCreate(
      [
        {
          firstName: "Get",
          lastName: "Pie",
          email: "info@getpiepay.com",
          password: "password123",
          ticketType: "support",
          rating: 4.6,
          role: "admin",
        },
        {
          firstName: "Jane",
          lastName: "Smith",
          email: "jane1@example.com",
          password: "password123",
          ticketType: "sales",
          rating: 4.9,
        },
        {
          firstName: "Sam",
          lastName: "Lee",
          email: "sam.lee@example.com",
          password: "password123",
          ticketType: "billing",
          rating: 4.1,
        },
        {
          firstName: "Maya",
          lastName: "Patel",
          email: "maya.patel@example.com",
          password: "password123",
          ticketType: "support",
          rating: 4.3,
        },
        {
          firstName: "Carlos",
          lastName: "Gomez",
          email: "carlos.g@example.com",
          password: "password123",
          ticketType: "sales",
          rating: 4.7,
        },
      ],
      { returning: true }
    );

    // ---------- USERS ----------
    const users = await User.bulkCreate(
      [
        {
          name: "Alice Johnson",
          email: "alice@example.com",
          phone: "123-456-7890",
          status: "active",
          isUpSellCall: false,
          isSatisfactionCall: false,
          isBothCall: false,
        },
        {
          name: "Bob Williams",
          email: "bob@example.com",
          phone: "098-765-4321",
          status: "active",
          isUpSellCall: true,
          isSatisfactionCall: false,
          isBothCall: false,
        },
        {
          name: "Chloe Brown",
          email: "chloe@example.com",
          phone: "111-222-3333",
          status: "active",
        },
        {
          name: "David Miller",
          email: "david@example.com",
          phone: "222-333-4444",
          status: "inactive",
        },
        {
          name: "Ethan Wilson",
          email: "ethan@example.com",
          phone: "333-444-5555",
          status: "active",
        },
        {
          name: "Fatima Khan",
          email: "fatima@example.com",
          phone: "444-555-6666",
          status: "active",
        },
        {
          name: "Grace Park",
          email: "grace@example.com",
          phone: "555-666-7777",
          status: "pending",
        },
        {
          name: "Henry Zhang",
          email: "henry@example.com",
          phone: "666-777-8888",
          status: "active",
        },
      ],
      { returning: true }
    );

    // Helper picks
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const priorities = ["low", "medium", "high", "critical"];
    const statuses = ["open", "in_progress", "resolved", "closed"];
    const ticketTypes = ["support", "sales", "billing"];

    // ---------- TICKETS (12) ----------
    const tickets = await Ticket.bulkCreate(
      [
        {
          userId: users[0].id,
          agentId: agents[0].id,
          ticketType: "support",
          status: "open",
          priority: "high",
          summary: "Email client shows authentication error on IMAP.",
          notes: [{ step: 1, note: "Collected IMAP logs" }],
        },
        {
          userId: users[0].id,
          agentId: agents[0].id,
          ticketType: "support",
          status: "in_progress",
          priority: "medium",
          summary: "Unable to add new team member to workspace.",
        },
        {
          userId: users[0].id,
          agentId: agents[1].id,
          ticketType: "sales",
          status: "in_progress",
          priority: "low",
          summary: "Questions about premium plan and annual discount.",
        },
        {
          userId: users[1].id,
          agentId: agents[1].id,
          ticketType: "sales",
          status: "resolved",
          priority: "medium",
          summary: "Interested in premium subscription, requested quote.",
          proposedSolution: "Offered 15% annual discount; accepted.",
          isSatisfied: true,
        },
        {
          userId: users[1].id,
          agentId: agents[2].id,
          ticketType: "billing",
          status: "open",
          priority: "critical",
          summary: "Double charge on last invoice.",
        },
        {
          userId: users[2].id,
          agentId: agents[3].id,
          ticketType: "support",
          status: "in_progress",
          priority: "high",
          summary: "2FA not working after device change.",
        },
        {
          userId: users[3].id,
          agentId: agents[2].id,
          ticketType: "billing",
          status: "closed",
          priority: "low",
          summary: "Need VAT invoice for last month.",
          proposedSolution: "Provided VAT-compliant invoice via email.",
          isSatisfied: true,
        },
        {
          userId: users[4].id,
          agentId: agents[4].id,
          ticketType: "sales",
          status: "open",
          priority: "medium",
          summary: "Bulk seats price for education org (~120 seats).",
        },
        {
          userId: users[5].id,
          agentId: agents[0].id,
          ticketType: "support",
          status: "resolved",
          priority: "medium",
          summary: "Signup fails with OAuth redirect_mismatch.",
          proposedSolution: "Updated redirect URI. User confirmed fix.",
          isSatisfied: true,
        },
        {
          userId: users[6].id,
          agentId: agents[3].id,
          ticketType: "support",
          status: "open",
          priority: "low",
          summary: "Feature request: dark mode for reports.",
          notes: [{ tag: "feature-request" }],
        },
        {
          userId: users[7].id,
          agentId: agents[1].id,
          ticketType: "sales",
          status: "in_progress",
          priority: "high",
          summary: "Enterprise SSO and on-prem options.",
        },
        {
          userId: users[2].id,
          agentId: agents[2].id,
          ticketType: "billing",
          status: "open",
          priority: "medium",
          summary: "Refund inquiry for unused month after downgrade.",
        },
      ],
      { returning: true }
    );

    // ---------- CALLS (6) ----------
    const calls = await Call.bulkCreate(
      [
        {
          type: "inbound",
          userId: users[0].id,
          ticketId: tickets[0].id,
          QuestionsAnswers: [{ q: "What error do you see?", a: "Auth failed" }],
          languages: ["en"],
          isResolvedByAi: false,
          summary: "User cannot authenticate to IMAP.",
          callCategory: "other",
          customerSatisfied: null,
          customerInterestedInUpsell: null,
          recordingUrl: null,
        },
        {
          type: "outbound",
          userId: users[1].id,
          ticketId: tickets[3].id,
          QuestionsAnswers: [{ q: "Is the quote acceptable?", a: "Yes" }],
          languages: ["en"],
          isResolvedByAi: true,
          summary: "Follow-up on premium quote. Confirmed purchase.",
          callCategory: "upsell",
          customerSatisfied: true,
          customerInterestedInUpsell: true,
          outboundDetails: { dialer: "Twilio", attempt: 1 },
        },
        {
          type: "inbound",
          userId: users[5].id,
          ticketId: tickets[8].id,
          languages: ["en"],
          isResolvedByAi: true,
          summary: "Signup OAuth issue explained; shared fix article.",
          callCategory: "satisfaction",
          customerSatisfied: true,
        },
        {
          type: "outbound",
          userId: users[7].id,
          ticketId: tickets[10].id,
          languages: ["en"],
          isResolvedByAi: false,
          summary: "Deep dive on SSO requirements and timeline.",
          callCategory: "both",
          customerSatisfied: true,
          customerInterestedInUpsell: true,
        },
        {
          type: "inbound",
          userId: users[4].id,
          ticketId: tickets[7].id,
          languages: ["en"],
          isResolvedByAi: false,
          summary: "Asked about bulk education pricing tiers.",
          callCategory: "upsell",
          customerInterestedInUpsell: true,
        },
        {
          type: "inbound",
          userId: users[2].id,
          ticketId: tickets[11].id,
          languages: ["en"],
          isResolvedByAi: false,
          summary: "Refund policy explained, awaiting docs.",
          callCategory: "other",
        },
      ],
      { returning: true }
    );

    // ---------- EMAILS (5) ----------
    const now = new Date();
    const emails = await Email.bulkCreate(
      [
        {
          id: "eml_10001",
          subject: "Re: IMAP auth error",
          from: "alice@example.com",
          to: "support@example.com",
          date: new Date(now.getTime() - 1000 * 60 * 60 * 72),
          body: "Hi team, still getting auth error when I try to connect.",
          userId: users[0].id,
          isRecieved: true,
        },
        {
          id: "eml_10002",
          subject: "Quote for premium plan",
          from: "jane@example.com",
          to: "bob@example.com",
          date: new Date(now.getTime() - 1000 * 60 * 60 * 48),
          body: "Hi Bob, attaching your quote for the premium plan.",
          userId: users[1].id,
          isRecieved: false,
        },
        {
          id: "eml_10003",
          subject: "VAT invoice request",
          from: "david@example.com",
          to: "billing@example.com",
          date: new Date(now.getTime() - 1000 * 60 * 60 * 36),
          body: "Could you send a VAT-compliant invoice for October?",
          userId: users[3].id,
          isRecieved: true,
        },
        {
          id: "eml_10004",
          subject: "SSO requirements",
          from: "henry@example.com",
          to: "sales@example.com",
          date: new Date(now.getTime() - 1000 * 60 * 60 * 30),
          body: "We need SSO with SAML and SCIM user provisioning.",
          userId: users[7].id,
          isRecieved: true,
        },
        {
          id: "eml_10005",
          subject: "Refund inquiry",
          from: "chloe@example.com",
          to: "billing@example.com",
          date: new Date(now.getTime() - 1000 * 60 * 60 * 18),
          body: "I downgraded last week—am I eligible for a refund of the remaining days?",
          userId: users[2].id,
          isRecieved: true,
        },
      ],
      { returning: true }
    );

    // ---------- RATINGS (4) ----------
    await Rating.bulkCreate([
      {
        ticketId: tickets[3].id, // sales quote resolved
        userId: users[1].id,
        agentId: agents[1].id,
        score: 5,
        comments: "Excellent sales experience.",
      },
      {
        ticketId: tickets[8].id, // signup OAuth fixed
        userId: users[5].id,
        agentId: agents[0].id,
        score: 5,
        comments: "Quick fix, thanks!",
      },
      {
        ticketId: tickets[6].id, // VAT invoice closed
        userId: users[3].id,
        agentId: agents[2].id,
        score: 4,
        comments: "Got what I needed.",
      },
      {
        ticketId: tickets[0].id, // IMAP issue still open
        userId: users[0].id,
        agentId: agents[0].id,
        score: 3,
        comments: "Still investigating, but helpful so far.",
      },
    ]);

    console.log("✅ Database seeded successfully");
    return { agents, users, tickets, calls, emails };
  } catch (error) {
    console.error("❌ Seeding error:", error);
    throw error;
  }
}
seedDatabase()
// Run directly if executed as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
