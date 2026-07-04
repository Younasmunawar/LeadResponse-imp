import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import Lead from "./models/Lead.js";
import { sendLeadEmail } from "./services/email.js";
import { analyzeLeadWithGemini } from "./services/gemini.js";

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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "kenny-vapi-agent",
    emailProvider: "brevo-http-api",
    emailConfigured: Boolean(
      process.env.BREVO_API_KEY && process.env.EMAIL_FROM && process.env.EMAIL_TO
    ),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
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

app.post("/api/leads", async (req, res) => {
  try {
    const { name, phone, email } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name and phone are required."
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
      lead.summary = String(data.summary || "No summary generated.").trim();
      lead.nextStep = String(data.next_step || "Review the lead manually.").trim();
      lead.bestFollowUpTime = String(data.best_follow_up_time || "unknown").trim();
      lead.status = "completed";
      lead.processingError = "";
      lead.rawStructuredOutput = {
        source: "gemini",
        model: geminiResult.model,
        finishReason: geminiResult.finishReason,
        usageMetadata: geminiResult.usageMetadata,
        answers,
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
      lead.leadQuality = normalizeEnum(
        req.body?.leadQuality,
        ["hot", "warm", "cold"],
        declinedAtOpening ? "cold" : "warm"
      );
      lead.callerSentiment = normalizeEnum(
        req.body?.callerSentiment,
        ["positive", "neutral", "negative", "busy", "unknown"],
        declinedAtOpening ? "negative" : "neutral"
      );
      lead.summary = buildRecordedSummary(lead);
      lead.nextStep = declinedAtOpening
        ? "Customer declined the qualification at the opening. Follow up only if appropriate."
        : "Gemini analysis was unavailable. Review the transcript and contact the lead manually.";
      lead.bestFollowUpTime = declinedAtOpening ? "Do not call automatically" : "unknown";
      lead.status = "completed";
      lead.processingError = `Gemini analysis failed; local fallback saved: ${geminiError.message}`;
      lead.rawStructuredOutput = {
        source: "local-fallback",
        answers,
        geminiError: geminiError.message
      };
    }

    await lead.save();
    await sendEmailIfNeeded(lead);

    const analysisProvider = lead.rawStructuredOutput?.source || "unknown";
    const analysisLabel = analysisProvider === "gemini" ? "Gemini analysis" : "fallback analysis";

    res.json({
      success: true,
      analysisProvider,
      message: lead.emailSent
        ? `Call complete. ${analysisLabel} saved and email sent.`
        : `Call complete. ${analysisLabel} saved; check email configuration if no email arrived.`,
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

app.get("/api/leads", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const leads = await Lead.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ success: true, leads });
  } catch {
    res.status(500).json({ success: false, message: "Unable to load leads." });
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
