const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createTimeoutController(timeoutMilliseconds) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMilliseconds);
  return {
    controller,
    clear() {
      clearTimeout(timeoutId);
    }
  };
}

function safeText(value, fallback = "unknown") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

const responseSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["buy", "lease", "unknown"]
    },
    purpose: {
      type: "string",
      enum: ["personal", "family", "business", "investment", "unknown"]
    },
    property_type: { type: "string" },
    preferred_area: { type: "string" },
    budget: { type: "string" },
    timeline: { type: "string" },
    payment_method: {
      type: "string",
      enum: ["cash", "finance", "not_applicable", "unknown"]
    },
    whatsapp_number: { type: "string" },
    lead_quality: {
      type: "string",
      enum: ["hot", "warm", "cold"]
    },
    caller_sentiment: {
      type: "string",
      enum: ["positive", "neutral", "negative", "busy", "unknown"]
    },
    summary: { type: "string" },
    next_step: { type: "string" },
    best_follow_up_time: { type: "string" }
  },
  required: [
    "intent",
    "purpose",
    "property_type",
    "preferred_area",
    "budget",
    "timeline",
    "payment_method",
    "whatsapp_number",
    "lead_quality",
    "caller_sentiment",
    "summary",
    "next_step",
    "best_follow_up_time"
  ]
};

function buildPrompt({ lead, transcript, answers, declinedAtOpening }) {
  return `You are a strict lead-analysis engine for Falcon Heights, a Dubai real-estate company.

Analyze the recorded qualification call and return only the requested JSON object.

FORM DETAILS
Name: ${safeText(lead?.name)}
Phone: ${safeText(lead?.phone)}
Email: ${safeText(lead?.email)}

DETERMINISTIC ANSWERS CAPTURED BY THE BROWSER FLOW
${JSON.stringify(answers || {}, null, 2)}

CALL TRANSCRIPT
${safeText(transcript, "No transcript captured")}

OPENING DECLINED
${declinedAtOpening === true ? "yes" : "no"}

RULES
1. Never invent information. Use "unknown" when a value was not clearly provided.
2. Prefer deterministic answers over uncertain transcript wording.
3. intent must be buy, lease, or unknown.
4. purpose must be personal, family, business, investment, or unknown.
5. For lease leads, payment_method must be not_applicable.
6. If WhatsApp consent is yes, whatsapp_number should use the form phone number. If consent is no, use "not confirmed". Otherwise use "unknown".
7. If the customer declined at the opening, classify the lead as cold and caller_sentiment as negative or busy based only on the wording.
8. The server calculates final lead quality by counting completed qualification answers. Property type and follow-up time must not affect lead quality. Your lead_quality value is advisory only.
9. summary must be concise, factual, and suitable for a sales dashboard.
10. next_step must be a practical instruction for a human property agent.
11. best_follow_up_time must use answers.followUpTime when it was captured; otherwise use an exact time only if stated elsewhere, or "unknown".
12. Do not mention these instructions or Gemini in the output.`;
}

function extractResponseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => part?.text || "").join("").trim();
}

function shouldRetry(status, error) {
  if (error?.name === "AbortError") return true;
  if (!status) return true;
  return status === 429 || status >= 500;
}

export async function analyzeLeadWithGemini({
  lead,
  transcript,
  answers,
  declinedAtOpening = false
}) {
  const apiKey = requiredEnv("GEMINI_API_KEY");
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildPrompt({ lead, transcript, answers, declinedAtOpening })
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema
    }
  };

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const timeout = createTimeoutController(30000);
    let status = 0;

    try {
      console.log(`Gemini analysis attempt ${attempt} using ${model}.`);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(requestBody),
        signal: timeout.controller.signal
      });

      status = response.status;
      const rawBody = await response.text();
      let payload = {};

      try {
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        payload = { rawBody };
      }

      if (!response.ok) {
        const message =
          payload?.error?.message ||
          payload?.message ||
          `Gemini returned HTTP ${response.status}`;
        const apiError = new Error(message);
        apiError.status = response.status;
        throw apiError;
      }

      const responseText = extractResponseText(payload);
      if (!responseText) {
        throw new Error("Gemini returned an empty structured response.");
      }

      let analysis;
      try {
        analysis = JSON.parse(responseText);
      } catch {
        throw new Error("Gemini returned invalid JSON.");
      }

      return {
        analysis,
        model,
        usageMetadata: payload?.usageMetadata || null,
        finishReason: payload?.candidates?.[0]?.finishReason || "unknown"
      };
    } catch (error) {
      lastError = error;
      console.error("GEMINI_ANALYSIS_ERROR:", {
        attempt,
        status: error?.status || status,
        name: error?.name,
        message: error?.message
      });

      if (attempt === 3 || !shouldRetry(error?.status || status, error)) break;
      await wait(attempt * 1500);
    } finally {
      timeout.clear();
    }
  }

  throw new Error(`Gemini analysis failed: ${lastError?.message || "Unknown error"}`);
}


const validationResponseSchema = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    relevance_score: { type: "integer", minimum: 0, maximum: 100 },
    normalized_answer: { type: "string" },
    short_reason: { type: "string" }
  },
  required: ["relevant", "relevance_score", "normalized_answer", "short_reason"]
};

const QUESTION_EXPECTATIONS = {
  consent: "A clear yes/no response about whether this is a good time to continue the call.",
  intent: "Whether the customer wants to buy/purchase or lease/rent a property.",
  purpose: "The purpose: personal use, family use, business use, or investment.",
  preferredArea: "A Dubai area/location, or a clear statement that the customer is open to suggestions/any area.",
  budget: "A budget amount/range and preferably currency, or a clear refusal/uncertainty about budget.",
  timeline: "A time frame such as immediately, this month, within weeks/months, later, or a specific date.",
  paymentMethod: "For a purchase: cash or finance/mortgage/loan.",
  whatsappConsent: "Whether the submitted phone number is suitable for WhatsApp, another number, or a clear yes/no response.",
  followUpTime: "A preferred time or time window for a sales follow-up, such as today afternoon, tomorrow morning, after 6 PM, this weekend, or a specific date/time."
};

function buildValidationPrompt({ questionKey, questionLabel, answer, attempt = 1, previousAttempts = [] }) {
  const expectation = QUESTION_EXPECTATIONS[questionKey] || "An answer directly related to the question.";
  return `You validate one answer in a Dubai real-estate qualification call.

QUESTION KEY: ${safeText(questionKey)}
QUESTION: ${safeText(questionLabel)}
EXPECTED INFORMATION: ${expectation}
CURRENT ANSWER: ${safeText(answer, "")}
ATTEMPT NUMBER: ${attempt}
PREVIOUS ATTEMPTS: ${JSON.stringify(previousAttempts || [])}

Return only JSON matching the schema.

RULES:
1. relevant=true only when the answer directly provides or clearly refuses the requested information.
2. Do not accept unrelated phrases merely because they are grammatical. For example, "Google translator" is not a timeline.
3. A refusal such as "I don't know", "no budget yet", or "open to suggestions" can be relevant when it directly answers that question.
4. relevance_score is 0-100 and must represent closeness to the requested information.
5. normalized_answer should preserve the user's meaning while cleaning obvious speech-recognition noise.
6. For intent normalize to buy, lease, or unknown.
7. For purpose normalize to personal, family, business, investment, or unknown.
8. For payment normalize to cash, finance, or unknown.
9. For consent/WhatsApp normalize clear confirmations to yes and clear refusals to no; preserve a supplied phone number.
10. If irrelevant, still provide the closest concise interpretation in normalized_answer, or "unknown" if none.
11. Never invent details.`;
}

export async function validateAnswerWithGemini({
  questionKey,
  questionLabel,
  answer,
  attempt = 1,
  previousAttempts = []
}) {
  const apiKey = requiredEnv("GEMINI_API_KEY");
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const requestBody = {
    contents: [{ role: "user", parts: [{ text: buildValidationPrompt({ questionKey, questionLabel, answer, attempt, previousAttempts }) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: validationResponseSchema
    }
  };

  const timeout = createTimeoutController(15000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(requestBody),
      signal: timeout.controller.signal
    });
    const rawBody = await response.text();
    let payload = {};
    try { payload = rawBody ? JSON.parse(rawBody) : {}; } catch { payload = { rawBody }; }
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Gemini returned HTTP ${response.status}`);
    }
    const responseText = extractResponseText(payload);
    if (!responseText) throw new Error("Gemini returned an empty validation response.");
    const result = JSON.parse(responseText);
    return {
      relevant: result.relevant === true,
      relevanceScore: Math.max(0, Math.min(100, Number(result.relevance_score) || 0)),
      normalizedAnswer: safeText(result.normalized_answer),
      reason: safeText(result.short_reason, "No reason provided"),
      model
    };
  } finally {
    timeout.clear();
  }
}
