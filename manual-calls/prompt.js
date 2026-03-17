export const MANUAL_CALL_ANALYSIS_SYSTEM = `
You analyze manual support call transcripts.

Return only JSON that matches the schema exactly.

Rules:
- Mark isMeaningfulConversation false if the transcript is only greetings, silence, spam, repeated words, or no useful issue details.
- customerName should be empty string if the customer name was not clearly provided.
- languages should contain human language names like English, Urdu, Punjabi.
- issueResolved should be false if the customer still needs follow-up, a callback, an investigation, or a ticket.
- ticketType must be support, sales, billing, or not_specified.
- callCategory must be satisfaction, upsell, both, or other.
- summary should be short, clear, and useful for agents.
`.trim();

export const MANUAL_CALL_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "isMeaningfulConversation",
    "customerName",
    "summary",
    "languages",
    "issueResolved",
    "ticketType",
    "priority",
    "callCategory",
    "reason",
  ],
  properties: {
    isMeaningfulConversation: {
      type: "boolean",
    },
    customerName: {
      type: "string",
    },
    summary: {
      type: "string",
    },
    languages: {
      type: "array",
      items: {
        type: "string",
      },
    },
    issueResolved: {
      type: "boolean",
    },
    ticketType: {
      type: "string",
      enum: ["support", "sales", "billing", "not_specified"],
    },
    priority: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
    },
    callCategory: {
      type: "string",
      enum: ["satisfaction", "upsell", "both", "other"],
    },
    reason: {
      type: "string",
    },
  },
};