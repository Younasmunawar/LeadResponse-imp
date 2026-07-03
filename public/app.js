const form = document.getElementById("leadForm");
const submitButton = document.getElementById("submitButton");
const callArea = document.getElementById("callArea");
const statusBox = document.getElementById("status");
const micGate = document.getElementById("micGate");
const micGateText = document.getElementById("micGateText");
const micHelp = document.getElementById("micHelp");
const micPermissionButton = document.getElementById("micPermissionButton");
const micReadyBadge = document.getElementById("micReadyBadge");
const startCallButton = document.getElementById("startCallButton");
const endCallButton = document.getElementById("endCallButton");
const callState = document.getElementById("callState");
const liveTranscript = document.getElementById("liveTranscript");
const typedFallback = document.getElementById("typedFallback");
const typedAnswer = document.getElementById("typedAnswer");
const submitTypedAnswer = document.getElementById("submitTypedAnswer");

let currentLeadId = "";
let microphoneReady = false;
let recognition = null;
let callRunning = false;
let waitingForAnswer = false;
let activeStepIndex = 0;
let retryCount = 0;
let transcriptLines = [];
let answers = {};
let finalizing = false;

const AUDIO = {
  voicemail: "/audio/02-voicemail.mp3",
  buyLease: "/audio/q-buy-or-lease.mp3",
  purpose: "/audio/q-personal-or-invest.mp3",
  area: "/audio/q-area.mp3",
  budget: "/audio/q-budget.mp3",
  timeline: "/audio/q-timeline.mp3",
  payment: "/audio/q-cash-or-finance.mp3",
  ackPerfect: "/audio/06-ack-perfect.mp3",
  ackHelpful: "/audio/07-ack-helpful.mp3",
  ackThanks: "/audio/08-ack-understood-thank-you.mp3",
  ackUnderstood: "/audio/09-quick-ack-understood.mp3",
  wonderful: "/audio/10-glue-wonderful.mp3",
  sorryClarifier: "/audio/11-glue-sorry-clarifier.mp3",
  clarifier: "/audio/12-glue-clarifier.mp3",
  hot: "/audio/13-outcome-hot.mp3",
  warm: "/audio/14-outcome-warm.mp3",
  cold: "/audio/15-outcome-cold.mp3",
  offScript: "/audio/16-off-script-outcome.mp3",
  goodbye: "/audio/17-goodbye.mp3",
  callback: "/audio/03-callback-confirmation-closing.mp3"
};

const baseSteps = [
  { key: "intent", audio: AUDIO.buyLease, label: "Buy or lease" },
  { key: "purpose", audio: AUDIO.purpose, label: "Personal use or investment", buyOnly: true },
  { key: "preferredArea", audio: AUDIO.area, label: "Preferred area" },
  { key: "budget", audio: AUDIO.budget, label: "Budget" },
  { key: "timeline", audio: AUDIO.timeline, label: "Timeline" },
  { key: "paymentMethod", audio: AUDIO.payment, label: "Cash or finance", buyOnly: true }
];

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function setCallState(message) {
  callState.textContent = message;
}

async function postJson(url, payload, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed with ${response.status}`);
  }
  return data;
}

function microphoneHelpMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "Microphone access was blocked. Open the site settings beside the address bar, set Microphone to Allow, then reload.";
  }
  if (error?.name === "NotFoundError") return "No microphone was found.";
  if (error?.name === "NotReadableError") return "Your microphone is being used by another app.";
  return "We could not access the microphone. Check browser microphone settings and try again.";
}

async function requestMicrophonePermission() {
  micPermissionButton.disabled = true;
  micGateText.textContent = "Choose Allow when your browser asks for microphone access.";
  micHelp.hidden = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone access.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    stream.getTracks().forEach((track) => track.stop());

    microphoneReady = true;
    micReadyBadge.hidden = false;
    micGate.classList.add("mic-gate-hidden");
    setStatus("Microphone is ready. Complete the form to continue.");
  } catch (error) {
    console.error(error);
    microphoneReady = false;
    micHelp.textContent = microphoneHelpMessage(error);
    micHelp.hidden = false;
    micPermissionButton.textContent = "Try microphone again";
  } finally {
    micPermissionButton.disabled = false;
  }
}

async function initializeMicrophoneGate() {
  try {
    if (navigator.permissions?.query) {
      const permission = await navigator.permissions.query({ name: "microphone" });
      if (permission.state === "granted") {
        await requestMicrophonePermission();
        return;
      }
    }
  } catch {
    // Permission query is not supported in all browsers.
  }
  await requestMicrophonePermission();
}

function addTranscript(role, text) {
  const line = `${role}: ${text}`;
  transcriptLines.push(line);
  liveTranscript.textContent = transcriptLines.join("\n");
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}

function playAudio(src, label = "Kenny") {
  return new Promise((resolve, reject) => {
    const audio = new Audio(src);
    audio.preload = "auto";
    setCallState(`${label} is speaking...`);
    audio.onended = resolve;
    audio.onerror = () => reject(new Error(`Could not play ${src}`));
    audio.play().catch(reject);
  });
}

function speechRecognitionSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function listenOnce() {
  return new Promise((resolve, reject) => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      reject(new Error("Speech recognition is not available in this browser."));
      return;
    }

    recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalText = "";
    let settled = false;

    recognition.onstart = () => {
      waitingForAnswer = true;
      setCallState("Listening... Speak now.");
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) finalText += `${text} `;
        else interim += `${text} `;
      }
      if (interim.trim()) setCallState(`Listening: ${interim.trim()}`);
    };

    recognition.onerror = (event) => {
      if (settled) return;
      settled = true;
      waitingForAnswer = false;
      reject(new Error(event.error || "Speech recognition failed."));
    };

    recognition.onend = () => {
      if (settled) return;
      settled = true;
      waitingForAnswer = false;
      const answer = finalText.trim();
      if (answer) resolve(answer);
      else reject(new Error("No speech was detected."));
    };

    recognition.start();
  });
}

function normalizeIntent(text) {
  const t = text.toLowerCase();
  if (/\b(buy|purchase|invest|buying)\b/.test(t)) return "buy";
  if (/\b(lease|rent|rental|renting)\b/.test(t)) return "lease";
  return "unknown";
}

function normalizePurpose(text) {
  const t = text.toLowerCase();
  if (/\b(invest|investment|roi|return)\b/.test(t)) return "investment";
  if (/\b(personal|myself|own use|live|living|family|home)\b/.test(t)) return /family/.test(t) ? "family" : "personal";
  if (/\b(business|office|commercial)\b/.test(t)) return "business";
  return text.trim() || "unknown";
}

function normalizePayment(text) {
  const t = text.toLowerCase();
  if (/\b(cash|full payment|outright)\b/.test(t)) return "cash";
  if (/\b(finance|mortgage|loan|installment|instalment)\b/.test(t)) return "finance";
  return "unknown";
}

function parseAnswer(step, text) {
  if (step.key === "intent") return normalizeIntent(text);
  if (step.key === "purpose") return normalizePurpose(text);
  if (step.key === "paymentMethod") return normalizePayment(text);
  return text.trim() || "unknown";
}

function isValidAnswer(step, parsed) {
  if (["intent", "paymentMethod"].includes(step.key)) return parsed !== "unknown";
  return String(parsed || "").trim().length >= 2;
}

function currentSteps() {
  return baseSteps.filter((step) => !step.buyOnly || answers.intent === "buy");
}

function acknowledgementFor(index) {
  return [AUDIO.ackPerfect, AUDIO.ackHelpful, AUDIO.ackThanks, AUDIO.ackUnderstood, AUDIO.wonderful][index % 5];
}

function calculateLeadQuality() {
  const timeline = String(answers.timeline || "").toLowerCase();
  const budgetKnown = answers.budget && answers.budget !== "unknown";
  const urgent = /immediate|as soon|asap|now|this month|1 month|one month|2 month|two month|3 month|three month|30 day|60 day|90 day/.test(timeline);
  const medium = /3|4|5|6|few month|quarter/.test(timeline);

  if (answers.intent === "buy" && budgetKnown && urgent) return "hot";
  if (budgetKnown && (urgent || medium || answers.timeline !== "unknown")) return "warm";
  return "cold";
}

function showTypedFallback(message) {
  typedFallback.hidden = false;
  typedAnswer.value = "";
  typedAnswer.focus();
  setCallState(message || "Type your answer below.");
}

function hideTypedFallback() {
  typedFallback.hidden = true;
}

async function captureAnswer(step) {
  hideTypedFallback();

  try {
    const spoken = await listenOnce();
    return spoken;
  } catch (error) {
    console.warn("Speech capture error:", error.message);
    if (!callRunning) throw error;

    if (retryCount < 1 && speechRecognitionSupported()) {
      retryCount += 1;
      await playAudio(AUDIO.sorryClarifier);
      return listenOnce();
    }

    return new Promise((resolve) => {
      showTypedFallback("I could not hear that clearly. Type your answer and continue.");
      submitTypedAnswer.onclick = () => {
        const value = typedAnswer.value.trim();
        if (!value) return;
        hideTypedFallback();
        resolve(value);
      };
    });
  }
}

async function runConversation() {
  if (callRunning) return;
  callRunning = true;
  finalizing = false;
  answers = {};
  transcriptLines = [];
  liveTranscript.textContent = "";
  activeStepIndex = 0;
  retryCount = 0;

  startCallButton.disabled = true;
  endCallButton.disabled = false;
  setStatus("Original Kenny recordings are being used. Please answer after each question.");

  try {
    await postJson(`/api/leads/${currentLeadId}/call-start`, { callId: `recorded-${Date.now()}` }, "PATCH");

    while (callRunning) {
      const steps = currentSteps();
      if (activeStepIndex >= steps.length) break;

      const step = steps[activeStepIndex];
      addTranscript("Kenny", step.label);
      await playAudio(step.audio);
      if (!callRunning) break;

      retryCount = 0;
      const rawAnswer = await captureAnswer(step);
      if (!callRunning) break;

      addTranscript("Customer", rawAnswer);
      const parsed = parseAnswer(step, rawAnswer);

      if (!isValidAnswer(step, parsed)) {
        await playAudio(AUDIO.clarifier);
        const secondAnswer = await captureAnswer(step);
        addTranscript("Customer", secondAnswer);
        const secondParsed = parseAnswer(step, secondAnswer);
        answers[step.key] = isValidAnswer(step, secondParsed) ? secondParsed : "unknown";
      } else {
        answers[step.key] = parsed;
      }

      await playAudio(acknowledgementFor(activeStepIndex), "Kenny");
      activeStepIndex += 1;
    }

    if (callRunning) await finishRecordedCall();
  } catch (error) {
    console.error(error);
    setStatus(`Call flow error: ${error.message}`, true);
    await finishRecordedCall(true);
  }
}

async function finishRecordedCall(offScript = false) {
  if (finalizing) return;
  finalizing = true;
  callRunning = false;
  waitingForAnswer = false;
  try { recognition?.stop?.(); } catch {}

  const leadQuality = calculateLeadQuality();

  try {
    if (offScript) {
      await playAudio(AUDIO.offScript);
    } else {
      await playAudio(AUDIO[leadQuality]);
      await playAudio(AUDIO.callback);
    }
    await playAudio(AUDIO.goodbye);
  } catch (error) {
    console.warn("Closing audio error:", error.message);
  }

  setCallState("Call complete. Saving the lead...");

  try {
    const result = await postJson(`/api/leads/${currentLeadId}/recorded-complete`, {
      transcript: transcriptLines.join("\n"),
      answers,
      leadQuality,
      callerSentiment: offScript ? "neutral" : "positive"
    });

    setStatus(result.message || "Lead saved and email processed.");
    setCallState("Completed");
  } catch (error) {
    setStatus(`Call ended, but saving failed: ${error.message}`, true);
    setCallState("Save failed");
  } finally {
    endCallButton.disabled = true;
    startCallButton.disabled = false;
  }
}

micPermissionButton.addEventListener("click", requestMicrophonePermission);
document.addEventListener("DOMContentLoaded", initializeMicrophoneGate);

startCallButton.addEventListener("click", runConversation);
endCallButton.addEventListener("click", () => finishRecordedCall(true));

typedAnswer.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitTypedAnswer.click();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!microphoneReady) {
    micGate.classList.remove("mic-gate-hidden");
    setStatus("Please enable microphone access before continuing.", true);
    return;
  }

  submitButton.disabled = true;
  setStatus("Saving your details...");

  try {
    const result = await postJson("/api/leads", {
      name: document.getElementById("name").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      email: document.getElementById("email").value.trim()
    });

    currentLeadId = result.lead._id;
    localStorage.setItem("kennyLeadId", currentLeadId);
    form.hidden = true;
    callArea.hidden = false;
    setStatus("Step 1 completed. Press Start call when you are ready.");
    callArea.scrollIntoView({ behavior: "smooth", block: "center" });

    if (!speechRecognitionSupported()) {
      setStatus("Voice recognition is unavailable in this browser. Chrome is recommended; typed fallback will be used.", true);
    }
  } catch (error) {
    setStatus(error.message, true);
    submitButton.disabled = false;
  }
});
