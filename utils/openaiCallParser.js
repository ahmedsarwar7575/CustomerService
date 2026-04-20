import fs from "fs/promises";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const extractManualCallDataFromAudio = async (file) => {
  if (!file?.path) {
    throw new Error("Recording file path is missing");
  }

  const fileBuffer = await fs.readFile(file.path);

  const openaiFile = await toFile(
    fileBuffer,
    file.originalname || "recording.mp3",
    {
      type: file.mimetype || "audio/mpeg",
    }
  );

  const transcription = await openai.audio.transcriptions.create({
    file: openaiFile,
    model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe",
  });

  const transcriptText = transcription.text?.trim() || "";

  if (!transcriptText) {
    return {
      transcript: "",
      QuestionsAnswers: [],
      LANGUAGES: [],
      Summary: "",
    };
  }

  const structured = await openai.chat.completions.create({
    model: process.env.OPENAI_STRUCTURED_MODEL || "gpt-4o",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are extracting support call data from a transcript.

Return valid JSON only.

"a" = customer answer
"q" = agent question

Return:
{
  "QuestionsAnswers": [{ "a": "...", "q": "..." }],
  "LANGUAGES": ["urdu", "English"],
  "Summary": "..."
}`,
      },
      {
        role: "user",
        content: `Transcript:\n${transcriptText}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "manual_call_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            QuestionsAnswers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  a: { type: "string" },
                  q: { type: "string" },
                },
                required: ["a", "q"],
              },
            },
            LANGUAGES: {
              type: "array",
              items: { type: "string" },
            },
            Summary: {
              type: "string",
            },
          },
          required: ["QuestionsAnswers", "LANGUAGES", "Summary"],
        },
      },
    },
  });

  const parsed = JSON.parse(structured.choices[0].message.content);

  return {
    transcript: transcriptText,
    QuestionsAnswers: parsed.QuestionsAnswers || [],
    LANGUAGES: parsed.LANGUAGES || [],
    Summary: parsed.Summary || "",
  };
};
