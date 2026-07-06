import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import Lead from "./models/Lead.js";
import { sendLeadEmail } from "./services/email.js";
import {
  analyzeLeadWithGemini,
  validateAnswerWithGemini,
  getGeminiKeyCount,
  getGeminiPoolInfo
} from "./services/gemini.js";
import { validateAnswerLocally } from "./services/localValidation.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "microphone=(self)");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

function normalizeEnum(value, allowed, fallback = "unknown") {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function isMeaningfulAnswer(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return Boolean(normalized) && ![
    "unknown",
    "unclear",
    "not provided",
    "no response",
    "n/a",
    "na",
    "skip",
    "skipped"
  ].includes(normalized);
}

function validationClassification(answers, key) {
  const entry = answers?._validation?.[key];
  const candidate = entry?.validation || entry;
  const classification = String(candidate?.classification || "").toLowerCase();
  if (["positive", "neutral", "negative", "irrelevant"].includes(classification)) return classification;
  if (entry?.forcedClosestMatch === true) return "irrelevant";
  return "irrelevant";
}

function calculateQualificationScore(answers = {}, declinedAtOpening = false) {
  if (declinedAtOpening) {
    return {
      answeredCount: 0,
      possibleCount: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 1,
      effectiveScore: -2,
      leadQuality: "cold",
      positiveMetrics: [],
      neutralMetrics: [],
      negativeMetrics: ["consent"],
      hardNegative: true
    };
  }

  // Property type and follow-up time are excluded from the direct quality score.
  const metricKeys = ["intent", "purpose", "preferredArea", "budget", "timeline", "paymentMethod", "whatsappConsent"]
    .filter((key) => !(key === "paymentMethod" && answers.intent === "lease"));

  const classifications = metricKeys.map((key) => [key, validationClassification(answers, key)]);
  const positiveMetrics = classifications.filter(([, value]) => value === "positive").map(([key]) => key);
  const neutralMetrics = classifications.filter(([, value]) => value === "neutral").map(([key]) => key);
  const negativeMetrics = classifications.filter(([, value]) => value === "negative").map(([key]) => key);
  const answeredCount = classifications.filter(([, value]) => value !== "irrelevant").length;
  const positiveCount = positiveMetrics.length;
  const neutralCount = neutralMetrics.length;
  const negativeCount = negativeMetrics.length;
  const effectiveScore = positiveCount + (neutralCount * 0.5) - negativeCount;

  const hardNegative = classifications.some(([key]) => {
    const entry = answers?._validation?.[key];
    const candidate = entry?.validation || entry;
    return candidate?.hardNegative === true;
  });

  let leadQuality = "cold";
  if (!hardNegative) {
    if (effectiveScore >= 5 && positiveCount >= 4) leadQuality = "hot";
    else if (effectiveScore >= 3) leadQuality = "warm";
  }

  return {
    answeredCount,
    possibleCount: metricKeys.length,
    positiveCount,
    neutralCount,
    negativeCount,
    effectiveScore,
    leadQuality,
    positiveMetrics,
    neutralMetrics,
    negativeMetrics,
    hardNegative
  };
}

function applyGeminiQualityRecommendation(qualification, data = {}) {
  if (qualification.hardNegative) return "cold";

  const recommendation = normalizeEnum(data.lead_quality, ["hot", "warm", "cold"], qualification.leadQuality);
  const confidence = Math.max(0, Math.min(100, Number(data.qualification_confidence) || 0));
  let quality = qualification.leadQuality;

  // Gemini acts as a bounded tie-breaker rather than replacing hard local evidence.
  if (confidence >= 80) {
    if (quality === "warm" && recommendation === "hot" && qualification.positiveCount >= 4 && qualification.negativeCount === 0) quality = "hot";
    else if (quality === "hot" && recommendation === "warm") quality = "warm";
    else if (quality === "cold" && recommendation === "warm" && qualification.positiveCount >= 2 && qualification.negativeCount === 0) quality = "warm";
    else if (recommendation === "cold" && qualification.negativeCount >= 2) quality = "cold";
  }
  return quality;
}

function transcriptFromPayload(payload = {}) {
  const message = payload.message || {};
  const candidates = [
    message.artifact?.transcript,
    message.call?.artifact?.transcript,
    payload.artifact?.transcript,
    payload.call?.artifact?.transcript,
    message.transcript,
    payload.transcript
  ];

  const direct = candidates.find((value) => typeof value === "string" && value.trim());
  if (direct) return direct.trim();

  const messages =
    message.artifact?.messages ||
    message.call?.artifact?.messages ||
    payload.call?.artifact?.messages ||
    payload.artifact?.messages;

  if (!Array.isArray(messages)) return "";

  return messages
    .filter((item) => item?.role && (item?.message || item?.content))
    .map((item) => `${item.role}: ${item.message || item.content}`)
    .join("\n");
}

function callIdFromPayload(payload = {}) {
  return String(
    payload.message?.call?.id ||
    payload.call?.id ||
    payload.message?.callId ||
    payload.callId ||
    ""
  );
}

function structuredOutputsFromPayload(payload = {}) {
  const message = payload.message || {};

  return (
    payload.call?.artifact?.structuredOutputs ||
    message.call?.artifact?.structuredOutputs ||
    message.artifact?.structuredOutputs ||
    payload.artifact?.structuredOutputs ||
    null
  );
}

function pickKennyResult(structuredOutputs) {
  if (!structuredOutputs || typeof structuredOutputs !== "object") return null;

  const entries = Object.values(structuredOutputs);
  const named = entries.find(
    (entry) => String(entry?.name || "").trim().toLowerCase() === "kenny lead analysis"
  );

  if (named?.result && typeof named.result === "object") {
    return { result: named.result, envelope: named };
  }

  const matching = entries.find((entry) => {
    const result = entry?.result;
    return result && typeof result === "object" && (
      "lead_quality" in result ||
      "intent" in result ||
      "summary" in result
    );
  });

  if (matching?.result) return { result: matching.result, envelope: matching };
  return null;
}

async function findLeadForCall(callId) {
  if (callId) {
    const exact = await Lead.findOne({ callId });
    if (exact) return exact;
  }

  // Browser-widget builds do not always expose a call ID to the page.
  // This fallback is safe for the current single-demo workflow.
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  return Lead.findOne({
    status: { $in: ["calling", "awaiting_analysis"] },
    updatedAt: { $gte: cutoff }
  }).sort({ updatedAt: -1 });
}

async function applyStructuredAnalysis(lead, data, payload, transcript) {
  lead.whatsappNumber = data.whatsapp_number || "unknown";
  lead.intent = normalizeEnum(data.intent, ["buy", "lease", "unknown"]);
  lead.purpose = normalizeEnum(data.purpose, [
    "personal",
    "family",
    "business",
    "investment",
    "unknown"
  ]);
  lead.propertyType = data.property_type || "unknown";
  lead.preferredArea = data.preferred_area || "unknown";
  lead.budget = data.budget || "unknown";
  lead.timeline = data.timeline || "unknown";
  lead.paymentMethod = normalizeEnum(data.payment_method, [
    "cash",
    "finance",
    "unknown"
  ]);
  lead.leadQuality = normalizeEnum(
    data.lead_quality,
    ["hot", "warm", "cold"],
    "warm"
  );
  lead.callerSentiment = normalizeEnum(
    data.caller_sentiment,
    ["positive", "neutral", "negative", "busy", "unknown"],
    "unknown"
  );
  lead.summary = data.summary || "No summary generated.";
  lead.nextStep = data.next_step || "Review the lead manually.";
  lead.bestFollowUpTime = data.best_follow_up_time || "unknown";

  if (transcript) lead.transcript = transcript;
  lead.status = "completed";
  lead.callEndedAt = lead.callEndedAt || new Date();
  lead.processingError = "";
  lead.rawStructuredOutput = data;
  lead.rawVapiPayload = payload;
  await lead.save();

  if (!lead.emailSent) {
    try {
      console.log("Sending lead email through Brevo to:", process.env.EMAIL_TO || "missing");
      lead.emailSent = await sendLeadEmail(lead);
      console.log("Lead email sent:", lead.emailSent);
      await lead.save();
    } catch (error) {
      console.error("EMAIL_SEND_FAILED:", error.stack || error.message);
      lead.processingError = `Analysis saved, but email failed: ${error.message}`;
      await lead.save();
    }
  }
}


function buildRecordedSummary(lead) {
  const parts = [
    `${lead.name || "The customer"} is interested in ${lead.intent || "property"}`,
    lead.purpose && lead.purpose !== "unknown" ? `for ${lead.purpose}` : "",
    lead.preferredArea && lead.preferredArea !== "unknown" ? `in ${lead.preferredArea}` : "",
    lead.budget && lead.budget !== "unknown" ? `with a budget of ${lead.budget}` : "",
    lead.timeline && lead.timeline !== "unknown" ? `and a timeline of ${lead.timeline}` : ""
  ].filter(Boolean);

  return `${parts.join(" ")}. This lead was qualified using Kenny's original prerecorded voice flow.`;
}

async function sendEmailIfNeeded(lead) {
  if (lead.emailSent) return;

  try {
    console.log("Sending lead email through Brevo to:", process.env.EMAIL_TO || "missing");
    lead.emailSent = await sendLeadEmail(lead);
    console.log("Lead email sent:", lead.emailSent);
    await lead.save();
  } catch (error) {
    console.error("EMAIL_SEND_FAILED:", error.stack || error.message);
    lead.processingError = `Lead saved, but email failed: ${error.message}`;
    await lead.save();
  }
}



app.post("/api/validate-answer", async (req, res) => {
  const { questionKey, questionLabel, answer, attempt, previousAttempts } = req.body || {};
  if (!questionKey || !answer) {
    return res.status(400).json({ success: false, message: "questionKey and answer are required." });
  }

  const key = String(questionKey);
  const rawAnswer = String(answer);
  const local = validateAnswerLocally(key, rawAnswer, req.body?.context || {});

  // High-confidence local answers are accepted or rejected immediately.
  // Gemini is only used for genuinely ambiguous answers.
  if (local.handled) {
    console.log(`LOCAL_VALIDATION:${key}`, {
      relevant: local.relevant,
      score: local.relevanceScore,
      normalizedAnswer: local.normalizedAnswer
    });
    return res.json({ success: true, validation: local });
  }

  try {
    const validation = await validateAnswerWithGemini({
      questionKey: key,
      questionLabel: String(questionLabel || key),
      answer: rawAnswer,
      attempt: Number(attempt) || 1,
      previousAttempts: Array.isArray(previousAttempts) ? previousAttempts : []
    });
    return res.json({ success: true, validation });
  } catch (error) {
    // Provider details stay in server logs. The browser receives only a normal
    // validation result so the live call can continue without technical errors.
    console.error("GEMINI_ANSWER_VALIDATION_FAILED:", error.message);
    return res.json({
      success: true,
      validation: {
        ...local,
        handled: true,
        source: "local-fallback",
        reason: local.reason || "Local fallback validation was used."
      }
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "kenny-vapi-agent",
    emailProvider: "brevo-http-api",
    emailConfigured: Boolean(
      process.env.BREVO_API_KEY && process.env.EMAIL_FROM && process.env.EMAIL_TO
    ),
    geminiConfigured: getGeminiKeyCount() > 0,
    geminiKeyCount: getGeminiKeyCount(),
    ...getGeminiPoolInfo(),
    validationTimeoutMs: Number(process.env.GEMINI_VALIDATION_TIMEOUT_MS || 3500),
    finalizationTimeoutMs: Number(process.env.GEMINI_FINALIZATION_TIMEOUT_MS || 5000),
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    time: new Date().toISOString()
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    vapiPublicKey: process.env.VAPI_PUBLIC_KEY || "",
    vapiAssistantId: process.env.VAPI_ASSISTANT_ID || ""
  });
});

app.post("/api/demo-access", (req, res) => {
  const expectedAccessCode = String(process.env.DEMO_ACCESS_CODE || "LEAD2026").trim();
  const suppliedAccessCode = String(req.body?.accessCode || "").trim();

  if (!suppliedAccessCode || suppliedAccessCode.toLowerCase() !== expectedAccessCode.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: "Invalid access code. No details were saved and no call was started."
    });
  }

  res.json({ success: true, message: "Access approved." });
});

app.post("/api/leads", async (req, res) => {
  try {
    const { name, phone, email, accessCode } = req.body;
    const expectedAccessCode = String(process.env.DEMO_ACCESS_CODE || "LEAD2026").trim();
    const suppliedAccessCode = String(accessCode || "").trim();

    if (!name || !phone || !suppliedAccessCode) {
      return res.status(400).json({
        success: false,
        message: "Name, phone, and access code are required."
      });
    }

    if (suppliedAccessCode.toLowerCase() !== expectedAccessCode.toLowerCase()) {
      console.warn("Blocked demo access attempt for phone:", String(phone).trim());
      return res.status(403).json({
        success: false,
        message: "Invalid access code. No details were saved and no call was started."
      });
    }

    const lead = await Lead.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: String(email || "").trim(),
      status: "created"
    });

    res.status(201).json({ success: true, lead });
  } catch (error) {
    console.error("Create lead error:", error.message);
    res.status(500).json({ success: false, message: "Unable to create lead." });
  }
});

app.patch("/api/leads/:id/call-start", async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      {
        status: "calling",
        callStartedAt: new Date(),
        callId: String(req.body?.callId || "")
      },
      { new: true }
    );

    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }

    res.json({ success: true, lead });
  } catch {
    res.status(400).json({ success: false, message: "Invalid lead ID." });
  }
});

app.post("/api/leads/:id/complete", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }

    lead.callEndedAt = new Date();
    lead.status = "awaiting_analysis";
    lead.processingError = "";

    if (req.body?.callId) lead.callId = String(req.body.callId);
    if (req.body?.transcript) lead.transcript = String(req.body.transcript).trim();

    await lead.save();

    res.json({
      success: true,
      message: "Call saved. Waiting for Vapi structured analysis.",
      lead
    });
  } catch (error) {
    console.error("Complete lead error:", error.message);
    res.status(500).json({ success: false, message: "Unable to finalize call." });
  }
});


app.post("/api/leads/:id/recorded-complete", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }

    const answers = req.body?.answers || {};
    const transcript = String(req.body?.transcript || "").trim();
    const declinedAtOpening = req.body?.declinedAtOpening === true;
    const qualification = calculateQualificationScore(answers, declinedAtOpening);

    lead.callEndedAt = new Date();
    lead.transcript = transcript;
    lead.status = "awaiting_analysis";
    lead.sourceMode = "original_recordings_gemini";
    lead.processingError = "";
    await lead.save();

    let geminiResult;

    try {
      geminiResult = await analyzeLeadWithGemini({
        lead,
        transcript,
        answers,
        declinedAtOpening
      });

      const data = geminiResult.analysis || {};

      lead.intent = normalizeEnum(data.intent, ["buy", "lease", "unknown"]);
      lead.purpose = normalizeEnum(data.purpose, [
        "personal",
        "family",
        "business",
        "investment",
        "unknown"
      ]);
      lead.propertyType = String(data.property_type || "unknown").trim();
      lead.preferredArea = String(data.preferred_area || "unknown").trim();
      lead.budget = String(data.budget || "unknown").trim();
      lead.timeline = String(data.timeline || "unknown").trim();
      lead.paymentMethod = normalizeEnum(data.payment_method, [
        "cash",
        "finance",
        "not_applicable",
        "unknown"
      ]);
      lead.whatsappNumber = String(data.whatsapp_number || "unknown").trim();
      // Local classifications provide the base score; Gemini is a bounded tie-breaker.
      lead.leadQuality = applyGeminiQualityRecommendation(qualification, data);
      lead.answeredQuestionCount = qualification.answeredCount;
      lead.possibleQuestionCount = qualification.possibleCount;
      lead.positiveMetrics = qualification.positiveMetrics;
      lead.neutralMetrics = qualification.neutralMetrics;
      lead.negativeMetrics = qualification.negativeMetrics;
      lead.positiveAnswerCount = qualification.positiveCount;
      lead.neutralAnswerCount = qualification.neutralCount;
      lead.negativeAnswerCount = qualification.negativeCount;
      lead.effectiveQualificationScore = qualification.effectiveScore;
      lead.callerSentiment = normalizeEnum(
        data.caller_sentiment,
        ["positive", "neutral", "negative", "busy", "unknown"],
        "unknown"
      );
      lead.summary = String(data.summary || "No summary generated.").trim();
      lead.nextStep = String(data.next_step || "Review the lead manually.").trim();
      lead.bestFollowUpTime = String(answers.followUpTime || data.best_follow_up_time || "unknown").trim();
      lead.status = "completed";
      lead.processingError = "";
      lead.rawStructuredOutput = {
        source: "gemini",
        model: geminiResult.model,
        finishReason: geminiResult.finishReason,
        usageMetadata: geminiResult.usageMetadata,
        keyLabel: geminiResult.keyLabel,
        answers,
        qualification,
        analysis: data
      };
    } catch (geminiError) {
      console.error("Recorded flow Gemini error:", geminiError.stack || geminiError.message);

      // Preserve the lead even when Gemini is unavailable. This fallback keeps
      // the customer response and allows a human to review it from the dashboard.
      lead.intent = normalizeEnum(answers.intent, ["buy", "lease", "unknown"]);
      lead.purpose = normalizeEnum(answers.purpose, [
        "personal",
        "family",
        "business",
        "investment",
        "unknown"
      ]);
      lead.preferredArea = String(answers.preferredArea || "unknown").trim();
      lead.budget = String(answers.budget || "unknown").trim();
      lead.timeline = String(answers.timeline || "unknown").trim();
      lead.paymentMethod = normalizeEnum(answers.paymentMethod, [
        "cash",
        "finance",
        "unknown"
      ]);
      lead.whatsappNumber =
        answers.whatsappConsent === "yes"
          ? (lead.phone || "unknown")
          : answers.whatsappConsent === "no"
            ? "not confirmed"
            : "unknown";
      lead.leadQuality = qualification.leadQuality;
      lead.answeredQuestionCount = qualification.answeredCount;
      lead.possibleQuestionCount = qualification.possibleCount;
      lead.positiveMetrics = qualification.positiveMetrics;
      lead.neutralMetrics = qualification.neutralMetrics;
      lead.negativeMetrics = qualification.negativeMetrics;
      lead.positiveAnswerCount = qualification.positiveCount;
      lead.neutralAnswerCount = qualification.neutralCount;
      lead.negativeAnswerCount = qualification.negativeCount;
      lead.effectiveQualificationScore = qualification.effectiveScore;
      lead.callerSentiment = declinedAtOpening || qualification.hardNegative || qualification.negativeCount >= 2
        ? "negative"
        : qualification.positiveCount > (qualification.neutralCount + qualification.negativeCount)
          ? "positive"
          : "neutral";
      lead.summary = buildRecordedSummary(lead);
      lead.nextStep = declinedAtOpening
        ? "Customer declined the qualification at the opening. Follow up only if appropriate."
        : "Review the transcript and contact the lead manually.";
      lead.bestFollowUpTime = declinedAtOpening
        ? "Do not call automatically"
        : String(answers.followUpTime || "unknown").trim();
      lead.status = "completed";
      // Keep provider failures in server logs only. Do not expose API or quota
      // details in the dashboard or customer-facing responses.
      lead.processingError = "";
      lead.rawStructuredOutput = {
        source: "local-fallback",
        answers,
        qualification
      };
    }

    await lead.save();
    await sendEmailIfNeeded(lead);

    const analysisProvider = lead.rawStructuredOutput?.source || "unknown";

    res.json({
      success: true,
      analysisProvider,
      message: lead.emailSent
        ? "Call complete. Lead saved and email sent."
        : "Call complete. Lead saved successfully.",
      lead
    });
  } catch (error) {
    console.error("Recorded flow completion error:", error.stack || error.message);
    res.status(500).json({
      success: false,
      message: "Unable to save or analyze the recorded voice call."
    });
  }
});

app.post("/vapi/webhook", async (req, res) => {
  const payload = req.body || {};

  // Vapi informational webhooks should receive a quick success response.
  res.status(200).json({ received: true });

  try {
    const eventType = payload.message?.type || payload.type || "unknown";
    const structuredOutputs = structuredOutputsFromPayload(payload);
    const selected = pickKennyResult(structuredOutputs);

    console.log("Vapi webhook:", eventType, "structured:", Boolean(selected));

    if (!selected) {
      // Keep the raw final report/transcript even if analysis has not arrived yet.
      if (["end-of-call-report", "call.ended"].includes(eventType)) {
        const lead = await findLeadForCall(callIdFromPayload(payload));
        if (lead) {
          const transcript = transcriptFromPayload(payload);
          if (transcript) lead.transcript = transcript;
          lead.rawVapiPayload = payload;
          lead.callEndedAt = lead.callEndedAt || new Date();
          if (lead.status !== "completed") lead.status = "awaiting_analysis";
          await lead.save();
        }
      }
      return;
    }

    const callId = callIdFromPayload(payload);
    const lead = await findLeadForCall(callId);

    if (!lead) {
      console.warn("Structured output received, but no matching lead was found:", callId);
      return;
    }

    if (callId && !lead.callId) lead.callId = callId;

    await applyStructuredAnalysis(
      lead,
      selected.result,
      payload,
      transcriptFromPayload(payload)
    );

    console.log("Lead completed from Vapi structured output:", lead._id.toString());
  } catch (error) {
    console.error("Vapi webhook processing error:", error.stack || error.message);
  }
});

app.post("/api/leads/recalculate-scores", async (_req, res) => {
  try {
    const leads = await Lead.find({
      "rawStructuredOutput.answers": { $exists: true }
    });

    let updated = 0;

    for (const lead of leads) {
      const answers = lead.rawStructuredOutput?.answers || {};
      const declinedAtOpening = answers.consent && answers.consent !== "yes";
      const qualification = calculateQualificationScore(answers, declinedAtOpening);

      if (
        lead.leadQuality !== qualification.leadQuality ||
        lead.answeredQuestionCount !== qualification.answeredCount ||
        lead.possibleQuestionCount !== qualification.possibleCount
      ) {
        lead.leadQuality = qualification.leadQuality;
        lead.answeredQuestionCount = qualification.answeredCount;
        lead.possibleQuestionCount = qualification.possibleCount;
        lead.positiveMetrics = qualification.positiveMetrics;
        lead.neutralMetrics = qualification.neutralMetrics;
        lead.negativeMetrics = qualification.negativeMetrics;
        lead.positiveAnswerCount = qualification.positiveCount;
        lead.neutralAnswerCount = qualification.neutralCount;
        lead.negativeAnswerCount = qualification.negativeCount;
        lead.effectiveQualificationScore = qualification.effectiveScore;
        lead.rawStructuredOutput = {
          ...lead.rawStructuredOutput,
          qualification
        };
        await lead.save();
        updated += 1;
      }
    }

    res.json({ success: true, updated });
  } catch (error) {
    console.error("Recalculate scores error:", error.message);
    res.status(500).json({ success: false, message: "Unable to recalculate lead scores." });
  }
});

app.get("/api/leads", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const leads = await Lead.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ success: true, leads });
  } catch {
    res.status(500).json({ success: false, message: "Unable to load leads." });
  }
});

app.get("/api/leads/export.csv", async (_req, res) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 }).lean();
    const headers = [
      "Created At", "Name", "Phone", "Email", "Quality", "Answered Count",
      "Possible Count", "Positive Count", "Neutral Count", "Negative Count", "Effective Score",
      "Intent", "Purpose", "Area", "Budget", "Timeline", "Payment", "WhatsApp",
      "Sentiment", "Status", "Analysis", "Summary", "Next Step", "Transcript"
    ];

    const csvCell = (value) => {
      const text = String(value ?? "").replace(/\r?\n/g, " ");
      return `"${text.replaceAll('"', '""')}"`;
    };

    const rows = leads.map((lead) => [
      lead.createdAt ? new Date(lead.createdAt).toISOString() : "",
      lead.name, lead.phone, lead.email, lead.leadQuality,
      lead.answeredQuestionCount, lead.possibleQuestionCount,
      lead.positiveAnswerCount, lead.neutralAnswerCount, lead.negativeAnswerCount,
      lead.effectiveQualificationScore, lead.intent, lead.purpose, lead.preferredArea,
      lead.budget, lead.timeline, lead.paymentMethod, lead.whatsappNumber,
      lead.callerSentiment, lead.status,
      lead.rawStructuredOutput?.source || "unknown", lead.summary, lead.nextStep,
      lead.transcript
    ].map(csvCell).join(","));

    const csv = [headers.map(csvCell).join(","), ...rows].join("\n");
    const filename = `kenny-leads-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("Export leads error:", error.message);
    res.status(500).json({ success: false, message: "Unable to export leads." });
  }
});

app.delete("/api/leads/:id", async (req, res) => {
  try {
    const deleted = await Lead.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }
    res.json({ success: true, message: "Lead deleted successfully." });
  } catch {
    res.status(400).json({ success: false, message: "Invalid lead ID." });
  }
});

app.get("/api/leads/:id", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }
    res.json({ success: true, lead });
  } catch {
    res.status(400).json({ success: false, message: "Invalid lead ID." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = Number(process.env.PORT || 3000);

async function start() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing.");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected.");

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Kenny app listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Startup error:", error.message);
  process.exit(1);
});
