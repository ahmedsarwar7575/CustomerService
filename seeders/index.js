// seeders/index.js

import { faker } from "@faker-js/faker";
import sequelize from "../config/db.js";
import Ticket from "../models/ticket.js";
import Call from "../models/Call.js";

const USER_IDS = [32, 33, 34, 35, 36, 37];
const AGENT_IDS = [22, 23, 24, 25, 26, 27];

const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"];
const TICKET_TYPES = ["support", "sales", "billing"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const CALL_TYPES = ["inbound", "outbound"];
const CALL_CATEGORIES = ["satisfaction", "upsell", "both", "other"];
const LANGUAGES = ["en", "ur"];

function buildQaPairs() {
  const qaPairs = [];
  const count = faker.number.int({ min: 3, max: 5 });

  for (let i = 0; i < count; i++) {
    qaPairs.push({
      q: faker.helpers.arrayElement([
        "Can you describe your issue?",
        "When did the issue start?",
        "Did you try restarting the service?",
        "Do you want us to escalate this?",
        "Are you interested in an upgraded plan?",
        "Anything else you need help with?",
      ]),
      a: faker.helpers.arrayElement([
        faker.lorem.sentence(),
        "It started this morning.",
        "Yes, but it did not fix the issue.",
        "Please escalate it.",
        "Yes, I want to know more.",
        "No, that is all.",
      ]),
    });
  }

  return qaPairs;
}

function buildNotes(agentId) {
  return [
    {
      by: agentId,
      text: faker.lorem.sentence(),
      at: new Date().toISOString(),
    },
  ];
}

function buildOutboundDetails(type) {
  if (type !== "outbound") return null;

  return {
    dialedNumber: faker.phone.number("+92##########"),
    attempts: faker.number.int({ min: 1, max: 3 }),
    connected: faker.datatype.boolean(),
    campaign: faker.helpers.arrayElement([
      "retention",
      "upsell",
      "feedback",
      "support-followup",
    ]),
  };
}

async function seed() {
  try {
    await sequelize.authenticate();
    console.log("DB connected");

    await sequelize.transaction(async (transaction) => {
      for (let i = 0; i < 10; i++) {
        const userId = USER_IDS[i % USER_IDS.length];
        const agentId = AGENT_IDS[i % AGENT_IDS.length];
        const status = faker.helpers.arrayElement(TICKET_STATUSES);
        const type = faker.helpers.arrayElement(CALL_TYPES);
        const callCategory = faker.helpers.arrayElement(CALL_CATEGORIES);

        const ticket = await Ticket.create(
          {
            status,
            ticketType: faker.helpers.arrayElement(TICKET_TYPES),
            priority: faker.helpers.arrayElement(PRIORITIES),
            proposedSolution: faker.helpers.arrayElement([
              "Restart the service and try again.",
              "Escalate issue to technical team.",
              "Verify billing details and invoice status.",
              "Offer upgraded plan with discount.",
              "Collect logs and schedule callback.",
            ]),
            isSatisfied: ["resolved", "closed"].includes(status)
              ? faker.datatype.boolean()
              : null,
            summary: `Seeded ticket ${i + 1} - ${faker.lorem.sentence()}`,
            userId,
            agentId,
            notes: buildNotes(agentId),
            isManualCall: false,
            isManual: false,
            createdByAgentId: agentId,
          },
          { transaction }
        );

        await Call.create(
          {
            type,
            userId: ticket.userId,
            ticketId: ticket.id, // attach call with ticket
            QuestionsAnswers: buildQaPairs(), // [{ q: "...", a: "..." }]
            languages: [faker.helpers.arrayElement(LANGUAGES)],
            isResolvedByAi: faker.datatype.boolean(),
            summary: `Seeded call ${i + 1} for ticket ${ticket.id}`,
            recordingUrl: `https://example.com/recordings/${faker.string.uuid()}.mp3`,
            callSid: `CA${faker.string.alphanumeric(30)}`,
            outboundDetails: buildOutboundDetails(type),
            callCategory,
            customerSatisfied: ["satisfaction", "both"].includes(callCategory)
              ? faker.datatype.boolean()
              : null,
            customerInterestedInUpsell: ["upsell", "both"].includes(
              callCategory
            )
              ? faker.datatype.boolean()
              : null,
            isManualCall: false,
          },
          { transaction }
        );

        console.log(`Created ticket ${ticket.id} with linked call`);
      }
    });

    console.log("Seeding completed successfully");
  } catch (error) {
    console.error("Seeding failed:", error);
  } finally {
    await sequelize.close();
    console.log("DB connection closed");
  }
}

seed();
