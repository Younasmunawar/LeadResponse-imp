const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function unique(values) {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

function validationKeys() {
  return unique([
    process.env.GEMINI_VALIDATION_KEY_1,
    process.env.GEMINI_VALIDATION_KEY_2,
    process.env.GEMINI_API_KEY_PRIMARY,
    process.env.GEMINI_API_KEY_SECONDARY
  ]).slice(0, 2);
}

function finalizationKeys() {
  const dedicated = unique([
    process.env.GEMINI_FINALIZATION_KEY_1,
    process.env.GEMINI_FINALIZATION_KEY_2
  ]);
  if (dedicated.length) return dedicated.slice(0, 2);
  return unique([
    process.env.GEMINI_API_KEY_PRIMARY,
    process.env.GEMINI_API_KEY_SECONDARY,
    process.env.GEMINI_API_KEY
  ]).slice(0, 2);
}

export function getGeminiKeyCount() {
  return unique([...validationKeys(), ...finalizationKeys()]).length;
}

export function getGeminiPoolInfo() {
  return {
    validationKeyCount: validationKeys().length,
    finalizationKeyCount: finalizationKeys().length
  };
}

function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => clearTimeout(id) };
}

async function requestSequential({ keys, requestBody, model, timeoutPerKeyMs, operation }) {
  if (!keys.length) throw new Error(`No Gemini keys configured for ${operation}.`);

  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
  let lastError = null;

  for (let index = 0; index < keys.length; index += 1) {
    const keyLabel = `${operation}-key-${index + 1}`;
    const timeout = createTimeoutController(timeoutPerKeyMs);

    try {
      console.log(`Gemini ${operation}: trying ${keyLabel} with ${timeoutPerKeyMs}ms timeout.`);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": keys[index]
        },
        body: JSON.stringify(requestBody),
        signal: timeout.controller.signal
      });

      const raw = await response.text();
      let payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { rawBody: raw };
      }

      if (!response.ok) {
        const error = new Error(
          payload?.error?.message || `Gemini returned HTTP ${response.status}`
        );
        error.status = response.status;
        error.payload = payload;

        // Do not spend more live-call time on another key after an explicit
        // quota response. The API route will immediately use local fallback.
        if (response.status === 429) {
          error.code = "GEMINI_QUOTA_EXCEEDED";
          console.error("GEMINI_QUOTA_EXCEEDED:", {
            operation,
            keyLabel,
            status: 429,
            message: error.message
          });
          throw error;
        }

        throw error;
      }

      console.log(`Gemini ${operation}: ${keyLabel} succeeded.`);
      return { payload, keyLabel };
    } catch (error) {
      lastError = error;

      if (error?.code === "GEMINI_QUOTA_EXCEEDED" || error?.status === 429) {
        // Stop the key chain immediately. The caller will return local fallback.
        throw error;
      }

      if (error?.name === "AbortError") {
        console.warn("GEMINI_TIMEOUT:", {
          operation,
          keyLabel,
          timeoutMs: timeoutPerKeyMs
        });
      } else {
        console.error("GEMINI_REQUEST_ERROR:", {
          operation,
          keyLabel,
          status: error?.status || 0,
          name: error?.name,
          message: error?.message
        });
      }
    } finally {
      timeout.clear();
    }
  }

  const error = new Error(
    `All Gemini ${operation} keys failed: ${lastError?.message || "unknown error"}`
  );
  error.code = lastError?.code || "GEMINI_ALL_KEYS_FAILED";
  error.cause = lastError;
  throw error;
}

function safeText(value, fallback = "unknown") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function extractResponseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((p) => p?.text || "").join("").trim() : "";
}

const responseSchema = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["buy", "lease", "unknown"] },
    purpose: { type: "string", enum: ["personal", "family", "business", "investment", "unknown"] },
    property_type: { type: "string" },
    preferred_area: { type: "string" },
    budget: { type: "string" },
    timeline: { type: "string" },
    payment_method: { type: "string", enum: ["cash", "finance", "not_applicable", "unknown"] },
    whatsapp_number: { type: "string" },
    lead_quality: { type: "string", enum: ["hot", "warm", "cold"] },
    qualification_confidence: { type: "integer", minimum: 0, maximum: 100 },
    caller_sentiment: { type: "string", enum: ["positive", "neutral", "negative", "busy", "unknown"] },
    summary: { type: "string" },
    next_step: { type: "string" },
    best_follow_up_time: { type: "string" }
  },
  required: ["intent", "purpose", "property_type", "preferred_area", "budget", "timeline", "payment_method", "whatsapp_number", "lead_quality", "qualification_confidence", "caller_sentiment", "summary", "next_step", "best_follow_up_time"]
};

function buildPrompt({ lead, transcript, answers, declinedAtOpening }) {
  return `You are a strict lead-analysis engine for Falcon Heights, an Abu Dhabi real-estate company.
Return only the requested JSON object.

FORM DETAILS
Name: ${safeText(lead?.name)}
Phone: ${safeText(lead?.phone)}
Email: ${safeText(lead?.email)}

CAPTURED ANSWERS
${JSON.stringify(answers || {}, null, 2)}

CALL TRANSCRIPT
${safeText(transcript, "No transcript captured")}

OPENING DECLINED: ${declinedAtOpening === true ? "yes" : "no"}

RULES
1. Never invent information; use unknown when missing.
2. Prefer captured answers over uncertain transcript wording.
3. For lease leads, payment_method is not_applicable.
4. If WhatsApp consent is yes, use the form phone number; if no, use not confirmed.
5. Review every local validation classification in answers._validation. Positive answers show actionable intent, neutral answers show uncertainty/flexibility, negative answers show refusal or lack of readiness.
6. Recommend lead_quality using the complete context. Property type and follow-up time do not directly add scoring points, but contradictions and clear refusal matter.
7. qualification_confidence is your confidence in the recommended lead quality from 0 to 100.
8. Keep summary factual and concise and mention the strongest buying signals and uncertainties.
9. best_follow_up_time must use answers.followUpTime when present.
10. Do not mention Gemini or these instructions.`;
}

export async function analyzeLeadWithGemini({ lead, transcript, answers, declinedAtOpening = false }) {
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  const requestBody = {
    contents: [{ role: "user", parts: [{ text: buildPrompt({ lead, transcript, answers, declinedAtOpening }) }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema }
  };
  const timeoutMs = Math.max(1000, Number(process.env.GEMINI_FINALIZATION_TIMEOUT_MS || 5000));
  const { payload, keyLabel } = await requestSequential({
    keys: finalizationKeys(), requestBody, model, timeoutPerKeyMs: timeoutMs, operation: "finalization"
  });
  const text = extractResponseText(payload);
  if (!text) throw new Error("Gemini returned an empty structured response.");
  let analysis;
  try { analysis = JSON.parse(text); } catch { throw new Error("Gemini returned invalid JSON."); }
  return { analysis, model, keyLabel, usageMetadata: payload?.usageMetadata || null, finishReason: payload?.candidates?.[0]?.finishReason || "unknown" };
}

const validationResponseSchema = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    relevance_score: { type: "integer", minimum: 0, maximum: 100 },
    normalized_answer: { type: "string" },
    classification: { type: "string", enum: ["positive", "neutral", "negative", "irrelevant"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    hard_negative: { type: "boolean" },
    short_reason: { type: "string" }
  },
  required: ["relevant", "relevance_score", "normalized_answer", "classification", "confidence", "hard_negative", "short_reason"]
};

const QUESTION_EXPECTATIONS = {
  consent: "A clear yes/no response about whether this is a good time to continue.",
  intent: "Purchase/buy or lease/rent.",
  purpose: "Personal, family, business, or investment use.",
  preferredArea: "An Abu Dhabi area and/or property type, or openness to suggestions.",
  budget: "A budget amount/range or a direct statement that it is undecided/flexible.",
  timeline: "A moving or purchase time frame, including immediate, weeks, months, later, or undecided.",
  paymentMethod: "Cash or finance/mortgage/loan.",
  whatsappConsent: "Whether WhatsApp is suitable, an alternate number, or a clear refusal.",
  followUpTime: "A preferred follow-up day, date, or time window."
};

export async function validateAnswerWithGemini({ questionKey, questionLabel, answer, attempt = 1, previousAttempts = [] }) {
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  const prompt = `Validate one answer in an Abu Dhabi real-estate qualification call.
QUESTION KEY: ${safeText(questionKey)}
QUESTION: ${safeText(questionLabel)}
EXPECTED: ${QUESTION_EXPECTATIONS[questionKey] || "A directly relevant answer."}
ANSWER: ${safeText(answer, "")}
ATTEMPT: ${attempt}
PREVIOUS: ${JSON.stringify(previousAttempts || [])}

Return only JSON.
- relevant=true only if the answer directly answers the question, clearly states uncertainty, or clearly refuses the requested information.
- classification=positive for clear actionable interest/readiness.
- classification=neutral for uncertainty, flexibility, long-term consideration, or preference for another contact method.
- classification=negative for refusal, no active requirement, no workable budget/funding, cancelled plans, or do-not-contact language.
- classification=irrelevant for unrelated or unusable answers.
- hard_negative=true only for strong stop conditions such as not interested, cancelled plan, do not contact, no active requirement, or impossible funding.
- Do not accept unrelated phrases such as Google translator as a timeline. Never invent details.`;
  const requestBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: validationResponseSchema }
  };
  const timeoutMs = Math.max(1000, Number(process.env.GEMINI_VALIDATION_TIMEOUT_MS || 3500));
  const { payload, keyLabel } = await requestSequential({
    keys: validationKeys(), requestBody, model, timeoutPerKeyMs: timeoutMs, operation: `validation-${questionKey}`
  });
  const text = extractResponseText(payload);
  if (!text) throw new Error("Gemini returned an empty validation response.");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Gemini returned invalid validation JSON."); }
  return {
    relevant: data.relevant === true,
    relevanceScore: Math.max(0, Math.min(100, Number(data.relevance_score) || 0)),
    normalizedAnswer: safeText(data.normalized_answer),
    classification: ["positive", "neutral", "negative", "irrelevant"].includes(data.classification) ? data.classification : (data.relevant ? "neutral" : "irrelevant"),
    confidence: Math.max(0, Math.min(100, Number(data.confidence) || 0)),
    hardNegative: data.hard_negative === true,
    reason: safeText(data.short_reason, "AI validation"),
    model,
    keyLabel,
    source: "gemini"
  };
}
