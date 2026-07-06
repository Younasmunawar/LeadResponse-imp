import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "Unknown" },
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },

    status: {
      type: String,
      enum: [
        "created",
        "calling",
        "awaiting_analysis",
        "completed",
        "failed"
      ],
      default: "created"
    },

    callStartedAt: Date,
    callEndedAt: Date,
    callId: { type: String, default: "", index: true },
    sourceMode: { type: String, default: "vapi" },

    intent: { type: String, default: "unknown" },
    purpose: { type: String, default: "unknown" },
    propertyType: { type: String, default: "unknown" },
    preferredArea: { type: String, default: "unknown" },
    budget: { type: String, default: "unknown" },
    timeline: { type: String, default: "unknown" },
    paymentMethod: { type: String, default: "unknown" },
    whatsappNumber: { type: String, default: "unknown" },
    bestFollowUpTime: { type: String, default: "unknown" },

    leadQuality: {
      type: String,
      enum: ["hot", "warm", "cold", "unknown"],
      default: "unknown"
    },
    answeredQuestionCount: { type: Number, default: 0 },
    possibleQuestionCount: { type: Number, default: 0 },
    positiveMetrics: { type: [String], default: [] },
    neutralMetrics: { type: [String], default: [] },
    negativeMetrics: { type: [String], default: [] },
    positiveAnswerCount: { type: Number, default: 0 },
    neutralAnswerCount: { type: Number, default: 0 },
    negativeAnswerCount: { type: Number, default: 0 },
    effectiveQualificationScore: { type: Number, default: 0 },
    callerSentiment: {
      type: String,
      enum: ["positive", "neutral", "negative", "busy", "unknown"],
      default: "unknown"
    },

    summary: { type: String, default: "" },
    nextStep: { type: String, default: "" },
    transcript: { type: String, default: "" },

    emailSent: { type: Boolean, default: false },
    processingError: { type: String, default: "" },

    rawStructuredOutput: { type: mongoose.Schema.Types.Mixed, default: null },
    rawVapiPayload: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("Lead", leadSchema);
