// scripts/seed.js
import bcrypt from "bcryptjs";
import { faker } from "@faker-js/faker";
import sequelize from "../config/db.js";

// IMPORTANT: import associations before using models
// so all .belongsTo / .hasMany are registered.
import { Agent, User, Ticket, Rating, Call } from "../models/index.js";

// ---- helpers ---------------------------------------------------------
const randomPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randBool = (p = 0.5) => Math.random() < p;
const hash = (plain) => bcrypt.hashSync(plain, 10);

const AGENT_TICKET_TYPES = ["support", "sales", "billing"];
const TICKET_STATUS = ["open", "in_progress", "resolved", "closed"];
const TICKET_PRIORITY = ["low", "medium", "high", "critical"];
const CALL_TYPES = ["inbound", "outbound"];

// Generates a Twilio-looking Call SID (not real)
const genCallSid = () =>
  "CA" + faker.string.hexadecimal({ length: 32, casing: "lower", prefix: "" });

// Sample Q&A JSON
const genQA = () => [
  {
    q: "What is my order status?",
    a: randomPick(["Shipped", "Processing", "Delivered"]),
  },
  { q: "Can I change my address?", a: randomPick(["Yes", "No"]) },
];

const genLanguagesJSON = () =>
  [
    randomPick(["en", "es", "fr", "de", "it", "pt", "ar", "ur"]),
    randBool()
      ? randomPick(["en", "es", "fr", "de", "it", "pt", "ar", "ur"])
      : null,
  ].filter(Boolean);

const genRecordingUrl = () =>
  `https://media.example.com/recordings/${faker.string.uuid()}.mp3`;

// ---- seeders ---------------------------------------------------------
async function seedAgents() {
  const adminEmail = "admin@acmehelpdesk.com";
  const [admin, created] = await Agent.findOrCreate({
    where: { email: adminEmail },
    defaults: {
      firstName: "System",
      lastName: "Admin",
      email: adminEmail,
      password: hash("Admin@12345"),
      isActive: true,
      role: "admin",
      rating: 5.0,
      ticketType: "support",
    },
  });

  const agents = [admin];

  // 9 more non-admin agents (total 10)
  for (let i = 0; i < 9; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet.email({ firstName, lastName }).toLowerCase();

    const agent = await Agent.create({
      firstName,
      lastName,
      email,
      password: hash(faker.internet.password({ length: 12 })),
      isActive: randBool(0.9),
      role: "agent",
      rating: Number((Math.random() * 5).toFixed(1)),
      ticketType: randomPick(AGENT_TICKET_TYPES),
    });
    agents.push(agent);
  }

  return agents;
}

async function seedUsers() {
  const users = [];
  for (let i = 0; i < 10; i++) {
    const name = faker.person.fullName();
    const email = faker.internet
      .email({
        firstName: name.split(" ")[0],
        lastName: name.split(" ")[1] || "",
      })
      .toLowerCase();
    const user = await User.create({
      name,
      email,
      role: "user",
      phone: genPhone(),
      status: randomPick(["active", "inactive", "pending"]),
      isUpSellCall: randBool(0.3),
      isSatisfactionCall: randBool(0.3),
      isBothCall: randBool(0.15),
    });
    users.push(user);
  }
  return users;
}

async function seedTickets(users, agents) {
  const tickets = [];
  for (let i = 0; i < 10; i++) {
    const user = randomPick(users);
    const agent = randomPick(agents);

    const ticket = await Ticket.create({
      status: randomPick(TICKET_STATUS),
      ticketType: randomPick(AGENT_TICKET_TYPES),
      priority: randomPick(TICKET_PRIORITY),
      proposedSolution: randBool(0.6)
        ? faker.lorem.sentences({ min: 1, max: 3 })
        : null,
      isSatisfied: randBool(0.5) ? randBool(0.7) : null, // sometimes unknown
      summary: faker.lorem.sentence({ min: 8, max: 16 }),
      userId: user.id,
      agentId: agent.id,
    });

    tickets.push(ticket);
  }
  return tickets;
}
// put near your other helpers
const genPhone = () => {
    // Example: Pakistani-style E.164 (+92XXXXXXXXXX) or switch to +1 if you prefer
    const subscriber = faker.number.int({ min: 3000000000, max: 3999999999 }).toString(); // 10 digits starting with '3'
    return `+92${subscriber}`; // total length: 13
  };
  
async function seedCalls(users, tickets) {
  const calls = [];
  for (let i = 0; i < 10; i++) {
    const user = randomPick(users);
    const ticket = randomPick(tickets);

    const call = await Call.create({
      type: randomPick(CALL_TYPES),
      userId: user.id,
      ticketId: ticket?.id ?? null,
      QuestionsAnswers: genQA(),
      languages: genLanguagesJSON(),
      isResolvedByAi: randBool(0.5),
      summary: faker.lorem.paragraph({ min: 1, max: 3 }),
      recordingUrl: randBool(0.7) ? genRecordingUrl() : null,
      callSid: genCallSid(),
      outboundDetails: randBool(0.5)
        ? {
            dialedAt: faker.date.recent({ days: 10 }),
            durationSec: faker.number.int({ min: 30, max: 1800 }),
            disposition: randomPick([
              "answered",
              "no_answer",
              "busy",
              "voicemail",
            ]),
          }
        : null,
    });

    calls.push(call);
  }
  return calls;
}

async function seedRatings(users, agents, tickets) {
  const ratings = [];
  for (let i = 0; i < 10; i++) {
    const user = randomPick(users);
    const agent = randomPick(agents);
    const ticket = randomPick(tickets);

    const rating = await Rating.create({
      score: faker.number.int({ min: 1, max: 5 }),
      comments: randBool(0.7) ? faker.lorem.sentence({ min: 6, max: 16 }) : "",
      userId: user.id,
      agentId: agent.id,
      ticketId: ticket.id,
    });

    ratings.push(rating);
  }
  return ratings;
}

// ---- main ------------------------------------------------------------
async function main() {
  console.log("🔄 Connecting to DB…");
  await sequelize.authenticate();
  // Do not drop tables; just ensure they exist.
  await sequelize.sync();

  console.log("👤 Seeding Agents (first is admin)…");
  const agents = await seedAgents();

  console.log("🙋 Seeding Users…");
  const users = await seedUsers();

  console.log("🎫 Seeding Tickets…");
  const tickets = await seedTickets(users, agents);

  console.log("📞 Seeding Calls…");
  const calls = await seedCalls(users, tickets);

  console.log("⭐ Seeding Ratings…");
  const ratings = await seedRatings(users, agents, tickets);

  console.log("✅ Done!");
  console.log({
    agents: agents.length,
    users: users.length,
    tickets: tickets.length,
    calls: calls.length,
    ratings: ratings.length,
  });

  await sequelize.close();
}

main().catch((err) => {
  console.error("❌ Seeder failed:", err);
  process.exit(1);
});
