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
const answerPanel = document.getElementById("answerPanel");
const typedAnswer = document.getElementById("typedAnswer");
const submitTypedAnswer = document.getElementById("submitTypedAnswer");
const retryVoiceButton = document.getElementById("retryVoiceButton");
const answerHint = document.getElementById("answerHint");
const accessCodeInput = document.getElementById("accessCode");
const toggleAccessCode = document.getElementById("toggleAccessCode");
const continueTypingOnly = document.getElementById("continueTypingOnly");
const incomingCall = document.getElementById("incomingCall");
const answerIncomingButton = document.getElementById("answerIncomingButton");
const declineIncomingButton = document.getElementById("declineIncomingButton");
const ringtone = document.getElementById("ringtone");
const callTimer = document.getElementById("callTimer");

let currentLeadId = "";
let microphoneReady = false;
let recognition = null;
let recognitionGeneration = 0;
let callRunning = false;
let waitingForAnswer = false;
let activeStepIndex = 0;
let transcriptLines = [];
let answers = {};
let finalizing = false;
let manualEndRequested = false;
let activeAudio = null;
let activeAudioFinish = null;
let audioGeneration = 0;
const liveAudioObjects = new Set();
let pendingAnswer = null;
let savePromise = null;
let microphoneChoiceResolver = null;
let callTimerInterval = null;
let callStartedTimestamp = 0;

const AUDIO = {
  opening: "/audio/01-opening.mp3",
  voicemail: "/audio/02-voicemail.mp3",
  buyLease: "/audio/q-buy-or-lease.mp3",
  purpose: "/audio/q-personal-or-invest.mp3",
  area: "/audio/q-area.mp3",
  budget: "/audio/q-budget.mp3",
  timeline: "/audio/q-timeline.mp3",
  payment: "/audio/q-cash-or-finance.mp3",
  whatsapp: "/audio/q-whatsapp.mp3",
  ackPerfect: "/audio/06-ack-perfect.mp3",
  ackHelpful: "/audio/07-ack-helpful.mp3",
  ackThanks: "/audio/08-ack-understood-thank-you.mp3",
  ackUnderstood: "/audio/09-quick-ack-understood.mp3",
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
  { key: "paymentMethod", audio: AUDIO.payment, label: "Cash or finance", buyOnly: true },
  { key: "whatsappConsent", audio: AUDIO.whatsapp, label: "WhatsApp confirmation" }
];

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function setCallState(message) {
  callState.textContent = message;
}

function closeCallInterface(message = "Call complete.") {
  stopRingtone();
  stopActiveAudio();
  stopRecognition();
  cancelPendingAnswer();
  stopCallTimer();
  callArea.hidden = true;
  incomingCall.hidden = true;
  answerPanel.hidden = true;
  document.body.style.overflow = "";
  callTimer.textContent = "00:00";
  setCallState("Connected");
  form.hidden = false;
  submitButton.disabled = false;
  currentLeadId = "";
  if (message) setStatus(message);
  window.setTimeout(() => {
    document.getElementById("callCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 80);
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
    if (microphoneChoiceResolver) {
      microphoneChoiceResolver(true);
      microphoneChoiceResolver = null;
    }
    return true;
  } catch (error) {
    console.error("Microphone permission error:", error);
    microphoneReady = false;
    micHelp.textContent = microphoneHelpMessage(error);
    micHelp.hidden = false;
    micPermissionButton.textContent = "Try microphone again";
    return false;
  } finally {
    micPermissionButton.disabled = false;
  }
}

function askForMicrophoneChoice() {
  if (microphoneReady) return Promise.resolve(true);
  micGate.classList.remove("mic-gate-hidden");
  return new Promise((resolve) => {
    microphoneChoiceResolver = resolve;
  });
}

function continueWithoutMicrophone() {
  microphoneReady = false;
  micGate.classList.add("mic-gate-hidden");
  if (microphoneChoiceResolver) {
    microphoneChoiceResolver(false);
    microphoneChoiceResolver = null;
  }
}

function addTranscript(role, text) {
  const line = `${role}: ${text}`;
  transcriptLines.push(line);
  liveTranscript.textContent = transcriptLines.join("\n");
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}

function hardStopAudioObject(audio) {
  if (!audio) return;
  try { audio.muted = true; } catch {}
  try { audio.volume = 0; } catch {}
  try { audio.pause(); } catch {}
  try { audio.currentTime = 0; } catch {}
  audio.onended = null;
  audio.onerror = null;
  audio.onpause = null;
  try {
    audio.removeAttribute("src");
    audio.src = "";
    audio.load();
  } catch {}
  liveAudioObjects.delete(audio);
}

function stopActiveAudio() {
  audioGeneration += 1;

  for (const audio of [...liveAudioObjects]) {
    hardStopAudioObject(audio);
  }

  document.querySelectorAll("audio").forEach((audio) => {
    hardStopAudioObject(audio);
  });

  activeAudio = null;

  if (activeAudioFinish) {
    const finish = activeAudioFinish;
    activeAudioFinish = null;
    finish(false);
  }
}

function playAudio(src, label = "Kenny", { allowWhenStopped = false } = {}) {
  if ((!callRunning && !allowWhenStopped) || manualEndRequested) {
    return Promise.resolve(false);
  }

  stopActiveAudio();
  const myGeneration = audioGeneration;

  return new Promise((resolve, reject) => {
    const audio = new Audio(src);
    let settled = false;

    const finish = (completed) => {
      if (settled) return;
      settled = true;
      liveAudioObjects.delete(audio);
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioFinish === finish) activeAudioFinish = null;
      resolve(completed);
    };

    activeAudio = audio;
    activeAudioFinish = finish;
    liveAudioObjects.add(audio);
    audio.preload = "auto";
    setCallState(`${label} is speaking...`);

    audio.onended = () => {
      if (manualEndRequested || myGeneration !== audioGeneration) {
        finish(false);
        return;
      }
      finish(true);
    };

    audio.onerror = () => {
      if (manualEndRequested || myGeneration !== audioGeneration) {
        finish(false);
        return;
      }
      if (settled) return;
      settled = true;
      liveAudioObjects.delete(audio);
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioFinish === finish) activeAudioFinish = null;
      reject(new Error(`Could not play ${src}`));
    };

    audio.play().catch((error) => {
      if (manualEndRequested || myGeneration !== audioGeneration) {
        finish(false);
        return;
      }
      if (settled) return;
      settled = true;
      liveAudioObjects.delete(audio);
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioFinish === finish) activeAudioFinish = null;
      reject(error);
    });
  });
}

function speechRecognitionSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function stopRecognition() {
  if (!recognition) return;
  const instance = recognition;
  recognition = null;
  try { instance.abort(); } catch {
    try { instance.stop(); } catch {}
  }
}

function showAnswerPanel(message) {
  answerPanel.hidden = false;
  typedAnswer.value = "";
  answerHint.textContent = message || "Type your answer or speak. A submitted typed answer takes priority.";
  typedAnswer.focus({ preventScroll: true });
}

function hideAnswerPanel() {
  answerPanel.hidden = true;
  submitTypedAnswer.onclick = null;
  retryVoiceButton.onclick = null;
}

function cancelPendingAnswer() {
  stopRecognition();
  waitingForAnswer = false;

  if (pendingAnswer && !pendingAnswer.settled) {
    pendingAnswer.settled = true;
    pendingAnswer.reject(new Error("CALL_ENDED"));
  }
  pendingAnswer = null;
  hideAnswerPanel();
}

function startVoiceRecognition(controller) {
  if (!microphoneReady || !speechRecognitionSupported() || controller.settled || manualEndRequested) {
    retryVoiceButton.hidden = !microphoneReady;
    answerHint.textContent = microphoneReady
      ? "Voice recognition is unavailable. Please type your answer."
      : "Microphone is off. Please type your answer.";
    setCallState("Waiting for your typed answer...");
    return;
  }

  stopRecognition();
  recognitionGeneration += 1;
  const myGeneration = recognitionGeneration;

  retryVoiceButton.hidden = true;
  retryVoiceButton.disabled = true;

  const listenWindowMs = 7000;
  const deadline = Date.now() + listenWindowMs;
  let finalText = "";
  let bestInterimText = "";
  let silenceTimer = null;
  let interimCommitTimer = null;
  let restartTimer = null;
  let instanceRunning = false;

  const clearTimers = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (interimCommitTimer) clearTimeout(interimCommitTimer);
    if (restartTimer) clearTimeout(restartTimer);
    silenceTimer = null;
    interimCommitTimer = null;
    restartTimer = null;
  };

  const isCurrent = () =>
    !controller.settled &&
    !manualEndRequested &&
    myGeneration === recognitionGeneration;

  const acceptBestCapturedSpeech = () => {
    const captured = String(finalText || bestInterimText || "").trim();
    if (!captured) return false;
    clearTimers();
    controller.finish(captured, "voice");
    return true;
  };

  const finishSilenceWindow = () => {
    if (!isCurrent()) return;
    if (acceptBestCapturedSpeech()) return;

    clearTimers();
    stopRecognition();
    waitingForAnswer = false;
    retryVoiceButton.hidden = false;
    retryVoiceButton.disabled = false;
    answerHint.textContent =
      "No clear speech was captured. Type your answer, or select Listen again for a fresh 7-second attempt.";
    setCallState("Waiting for a typed answer or another voice attempt...");
  };

  const scheduleRestart = (delay = 180) => {
    if (!isCurrent() || Date.now() >= deadline || instanceRunning) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startInstance();
    }, delay);
  };

  const startInstance = () => {
    if (!isCurrent()) return;
    if (Date.now() >= deadline) {
      finishSilenceWindow();
      return;
    }
    if (instanceRunning) return;

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const instance = new Recognition();
    recognition = instance;
    instanceRunning = true;

    instance.lang = "en-US";
    instance.interimResults = true;
    instance.continuous = false;
    instance.maxAlternatives = 3;

    instance.onstart = () => {
      if (!isCurrent()) return;
      waitingForAnswer = true;
      const secondsLeft = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
      answerHint.textContent =
        "Speak normally. Your partial speech will also be accepted if the browser does not mark it as final.";
      setCallState(`Listening for up to ${secondsLeft} seconds… You can type at any time.`);
    };

    instance.onspeechstart = () => {
      if (!isCurrent()) return;
      setCallState("Voice detected — listening...");
    };

    instance.onresult = (event) => {
      if (!isCurrent()) return;

      let newFinal = "";
      let newInterim = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        let bestAlternative = result[0];

        for (let j = 1; j < result.length; j += 1) {
          if ((result[j].confidence || 0) > (bestAlternative.confidence || 0)) {
            bestAlternative = result[j];
          }
        }

        const transcript = String(bestAlternative?.transcript || "").trim();
        if (!transcript) continue;

        if (result.isFinal) newFinal += `${transcript} `;
        else newInterim += `${transcript} `;
      }

      if (newFinal.trim()) finalText += `${newFinal.trim()} `;
      if (newInterim.trim()) bestInterimText = newInterim.trim();

      if (finalText.trim()) {
        acceptBestCapturedSpeech();
        return;
      }

      if (bestInterimText) {
        setCallState(`Listening: ${bestInterimText} — or type below.`);

        // Some Chrome/Android sessions produce a good interim transcript but never
        // emit a final result. Accept the stable interim after a short pause.
        if (interimCommitTimer) clearTimeout(interimCommitTimer);
        interimCommitTimer = setTimeout(() => {
          if (isCurrent() && bestInterimText) acceptBestCapturedSpeech();
        }, 1100);
      }
    };

    instance.onerror = (event) => {
      instanceRunning = false;
      if (!isCurrent()) return;

      waitingForAnswer = false;
      if (recognition === instance) recognition = null;

      if (event.error === "aborted") return;

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        clearTimers();
        microphoneReady = false;
        retryVoiceButton.hidden = false;
        retryVoiceButton.disabled = false;
        answerHint.textContent =
          "Microphone permission is blocked. Allow it in browser settings, or type your answer.";
        setCallState("Microphone permission is required for voice answers.");
        return;
      }

      // If any interim speech was heard, keep it instead of losing the answer.
      if (bestInterimText && ["no-speech", "network", "audio-capture"].includes(event.error)) {
        acceptBestCapturedSpeech();
        return;
      }

      if (["no-speech", "audio-capture", "network"].includes(event.error) && Date.now() < deadline) {
        scheduleRestart(event.error === "audio-capture" ? 350 : 180);
        return;
      }

      finishSilenceWindow();
    };

    instance.onend = () => {
      instanceRunning = false;
      if (!isCurrent()) return;

      waitingForAnswer = false;
      if (recognition === instance) recognition = null;

      if (acceptBestCapturedSpeech()) return;

      if (Date.now() < deadline) scheduleRestart(180);
      else finishSilenceWindow();
    };

    try {
      instance.start();
    } catch (error) {
      instanceRunning = false;
      if (recognition === instance) recognition = null;
      console.warn("Speech recognition start error:", error.message);
      if (Date.now() < deadline) scheduleRestart(300);
      else finishSilenceWindow();
    }
  };

  silenceTimer = setTimeout(finishSilenceWindow, listenWindowMs + 300);
  startInstance();
}

function captureAnswer() {
  cancelPendingAnswer();

  return new Promise((resolve, reject) => {
    const controller = {
      settled: false,
      resolve,
      reject,
      finish(value, source) {
        if (controller.settled || manualEndRequested) return;
        const answer = String(value || "").trim();
        if (!answer) return;

        controller.settled = true;
        stopRecognition();
        waitingForAnswer = false;
        pendingAnswer = null;
        hideAnswerPanel();
        setCallState(source === "typed" ? "Typed answer received." : "Voice answer received.");
        resolve(answer);
      }
    };

    pendingAnswer = controller;
    showAnswerPanel("Type your answer or speak. A submitted typed answer takes priority.");

    submitTypedAnswer.onclick = () => {
      controller.finish(typedAnswer.value, "typed");
    };

    retryVoiceButton.onclick = () => {
      if (controller.settled) return;
      retryVoiceButton.disabled = true;
      answerHint.textContent = "Restarting microphone… Speak after the Listening message appears.";
      setCallState("Preparing a fresh voice attempt...");
      setTimeout(() => startVoiceRecognition(controller), 250);
    };

    startVoiceRecognition(controller);
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

function normalizeConsent(text) {
  const t = String(text || "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

  if (/\b(no problem|sure thing|of course|go ahead|sounds good)\b/.test(t)) return "yes";
  if (/\b(yes|yeah|yep|yup|sure|okay|ok|absolutely|certainly|definitely|please do|continue|go ahead|of course)\b/.test(t)) return "yes";
  if (/\b(no|nope|nah|not now|do not|don't|stop|not interested|busy|can't|cannot)\b/.test(t)) return "no";
  return "unknown";
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
  if (step.key === "whatsappConsent") return normalizeConsent(text);
  return text.trim() || "unknown";
}


function isRepeatQuestionRequest(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /\b(please repeat|repeat the question|repeat question|say that again|can you repeat|could you repeat|what was the question|ask again|pardon|come again)\b/.test(normalized);
}

function clarificationAudioFor(attempt) {
  return attempt % 2 === 0 ? AUDIO.sorryClarifier : AUDIO.clarifier;
}

async function validateAnswerForStep(step, rawAnswer, attempt, previousAttempts = []) {
  setCallState(`Checking your answer (${attempt}/3)...`);
  const result = await postJson("/api/validate-answer", {
    questionKey: step.key,
    questionLabel: step.label,
    answer: rawAnswer,
    attempt,
    previousAttempts,
    context: {
      intent: answers.intent || "unknown",
      purpose: answers.purpose || "unknown",
      preferredArea: answers.preferredArea || "unknown",
      budget: answers.budget || "unknown",
      timeline: answers.timeline || "unknown"
    }
  });
  return result.validation;
}

async function collectValidatedAnswer(step) {
  const attempts = [];

  for (let attempt = 1; attempt <= 3 && callRunning; attempt += 1) {
    if (attempt > 1) {
      const clarificationAudio = clarificationAudioFor(attempt);
      addTranscript("Kenny", `Clarification requested for ${step.label}`);
      await playAudio(clarificationAudio, "Kenny");
      if (!callRunning) throw new Error("CALL_ENDED");
    }

    let rawAnswer = await captureAnswer();
    if (!callRunning) throw new Error("CALL_ENDED");
    addTranscript("Customer", rawAnswer);

    if (isRepeatQuestionRequest(rawAnswer)) {
      addTranscript("System", `${step.label}: customer requested the question again.`);
      await playAudio(step.audio, "Kenny");
      if (!callRunning) throw new Error("CALL_ENDED");
      rawAnswer = await captureAnswer();
      if (!callRunning) throw new Error("CALL_ENDED");
      addTranscript("Customer", rawAnswer);
    }

    const validation = await validateAnswerForStep(
      step,
      rawAnswer,
      attempt,
      attempts.map((item) => ({
        answer: item.rawAnswer,
        relevanceScore: item.relevanceScore,
        relevant: item.relevant
      }))
    );

    const candidate = {
      rawAnswer,
      relevant: validation.relevant === true,
      relevanceScore: Number(validation.relevanceScore) || 0,
      normalizedAnswer: String(validation.normalizedAnswer || rawAnswer).trim() || "unknown",
      classification: ["positive", "neutral", "negative", "irrelevant"].includes(validation.classification)
        ? validation.classification
        : (validation.relevant === true ? "neutral" : "irrelevant"),
      confidence: Number(validation.confidence) || 0,
      hardNegative: validation.hardNegative === true,
      reason: String(validation.reason || "")
    };
    attempts.push(candidate);

    addTranscript(
      "System",
      `${step.label} validation: ${candidate.classification} / ${candidate.relevant ? "relevant" : "not relevant"} (${candidate.relevanceScore}/100)`
    );

    if (candidate.relevant) {
      return {
        value: parseAnswer(step, candidate.normalizedAnswer),
        rawAnswer: candidate.rawAnswer,
        validation: candidate,
        attempts,
        forcedClosestMatch: false
      };
    }

    if (attempt < 3) {
      setStatus(`That answer did not match the ${step.label.toLowerCase()} question. Kenny will clarify and ask again.`);
    }
  }

  const closest = attempts.sort((a, b) => b.relevanceScore - a.relevanceScore)[0] || {
    rawAnswer: "unknown",
    normalizedAnswer: "unknown",
    relevanceScore: 0,
    relevant: false,
    reason: "No usable answer"
  };

  addTranscript(
    "System",
    `${step.label}: three attempts were not relevant. Closest answer selected (${closest.relevanceScore}/100): ${closest.normalizedAnswer}`
  );

  return {
    value: parseAnswer(step, closest.normalizedAnswer),
    rawAnswer: closest.rawAnswer,
    validation: closest,
    attempts,
    forcedClosestMatch: true
  };
}

function isValidAnswer(step, parsed) {
  if (["intent", "paymentMethod", "whatsappConsent"].includes(step.key)) return parsed !== "unknown";
  return String(parsed || "").trim().length >= 2;
}

function currentSteps() {
  return baseSteps.filter((step) => !step.buyOnly || answers.intent === "buy");
}

function acknowledgementFor(index) {
  return [AUDIO.ackPerfect, AUDIO.ackHelpful, AUDIO.ackThanks, AUDIO.ackUnderstood][index % 4];
}

function isMeaningfulAnswer(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
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

function validationClassification(key) {
  const entry = answers?._validation?.[key];
  const candidate = entry?.validation || entry;
  const classification = String(candidate?.classification || "").toLowerCase();
  if (["positive", "neutral", "negative", "irrelevant"].includes(classification)) return classification;
  if (entry?.forcedClosestMatch === true) return "irrelevant";
  return "irrelevant";
}

function calculateLeadScore() {
  const metricKeys = ["intent", "purpose", "preferredArea", "budget", "timeline", "paymentMethod", "whatsappConsent"]
    .filter((key) => !(key === "paymentMethod" && answers.intent === "lease"));
  const classifications = metricKeys.map((key) => [key, validationClassification(key)]);
  const positiveCount = classifications.filter(([, value]) => value === "positive").length;
  const neutralCount = classifications.filter(([, value]) => value === "neutral").length;
  const negativeCount = classifications.filter(([, value]) => value === "negative").length;
  const answeredCount = classifications.filter(([, value]) => value !== "irrelevant").length;
  const effectiveScore = positiveCount + (neutralCount * 0.5) - negativeCount;
  const hardNegative = metricKeys.some((key) => {
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
    hardNegative,
    leadQuality
  };
}

function calculateLeadQuality() {
  return calculateLeadScore().leadQuality;
}

function saveRecordedLead(payload) {
  if (!savePromise) {
    savePromise = postJson(`/api/leads/${currentLeadId}/recorded-complete`, payload);
  }
  return savePromise;
}

function stopRingtone() {
  try { ringtone.pause(); ringtone.currentTime = 0; } catch {}
}

function startRingtone() {
  stopRingtone();
  ringtone.volume = 0.7;
  ringtone.play().catch((error) => console.warn("Ringtone playback blocked:", error.message));
}

function startCallTimer() {
  stopCallTimer();
  callStartedTimestamp = Date.now();
  callTimer.textContent = "00:00";
  callTimerInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - callStartedTimestamp) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    callTimer.textContent = `${mm}:${ss}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = null;
}

function showIncomingCall() {
  incomingCall.hidden = false;
  document.body.style.overflow = "hidden";
  startRingtone();
}

async function answerIncomingCall() {
  stopRingtone();
  incomingCall.hidden = true;
  callArea.hidden = false;
  startCallTimer();
  await runConversation();
}

async function declineIncomingCall() {
  stopRingtone();
  incomingCall.hidden = true;
  document.body.style.overflow = "";
  if (currentLeadId) {
    try { await fetch(`/api/leads/${currentLeadId}`, { method: "DELETE" }); } catch {}
  }
  currentLeadId = "";
  form.hidden = false;
  submitButton.disabled = false;
  setStatus("Incoming call declined. No lead was kept.");
}

async function runConversation() {
  if (callRunning || finalizing) return;

  callRunning = true;
  finalizing = false;
  manualEndRequested = false;
  savePromise = null;
  answers = {};
  transcriptLines = [];
  liveTranscript.textContent = "";
  activeStepIndex = 0;

  startCallButton.disabled = true;
  endCallButton.disabled = false;
  setStatus("Original Kenny recordings are being used. Answer by typing or speaking after each question.");

  try {
    await postJson(`/api/leads/${currentLeadId}/call-start`, { callId: `recorded-${Date.now()}` }, "PATCH");

    addTranscript("Kenny", "Opening and permission to continue");
    await playAudio(AUDIO.opening);
    if (!callRunning) return;

    const consentStep = { key: "consent", audio: AUDIO.opening, label: "Permission to continue" };
    const consentResult = await collectValidatedAnswer(consentStep);
    const consent = normalizeConsent(consentResult.value);
    answers.consent = consent;
    answers._validation = answers._validation || {};
    answers._validation.consent = consentResult;

    if (consent !== "yes") {
      await finishDeclinedCall(consent === "no" ? "Customer declined to continue." : "Customer did not confirm consent after three attempts.");
      return;
    }

    while (callRunning) {
      const steps = currentSteps();
      if (activeStepIndex >= steps.length) break;

      const step = steps[activeStepIndex];
      addTranscript("Kenny", step.label);
      await playAudio(step.audio);
      if (!callRunning) return;

      const answerResult = await collectValidatedAnswer(step);
      if (!callRunning) return;

      answers[step.key] = answerResult.value;
      answers._validation = answers._validation || {};
      answers._validation[step.key] = answerResult;

      if (!answerResult.forcedClosestMatch) {
        await playAudio(acknowledgementFor(activeStepIndex), "Kenny");
        if (!callRunning) return;
      } else {
        setStatus(`Three answers did not clearly match ${step.label.toLowerCase()}. The closest answer was saved and the call continued.`);
      }

      activeStepIndex += 1;
    }

    if (callRunning) await finishRecordedCall();
  } catch (error) {
    if (error.message === "CALL_ENDED" || manualEndRequested) return;
    console.error(error);
    setStatus(`Call flow error: ${error.message}`, true);
    await finishRecordedCall(true);
  }
}

async function finishDeclinedCall(reason) {
  if (finalizing) return;
  finalizing = true;
  callRunning = false;
  cancelPendingAnswer();
  addTranscript("System", reason);

  try {
    await playAudio(AUDIO.goodbye, "Kenny", { allowWhenStopped: true });
  } catch (error) {
    console.warn("Goodbye audio error:", error.message);
  }

  if (manualEndRequested) return;
  setCallState("Call ended. Saving the response...");

  try {
    const result = await saveRecordedLead({
      transcript: transcriptLines.join("\n"),
      answers,
      leadQuality: "cold",
      callerSentiment: "negative",
      declinedAtOpening: true
    });

    closeCallInterface(result.message || "Call ended and response saved.");
  } catch (error) {
    setStatus(`Call ended, but saving failed: ${error.message}`, true);
    setCallState("Save failed");
  } finally {
    endCallButton.disabled = true;
    startCallButton.disabled = false;
    finalizing = false;
  }
}

async function finishRecordedCall(offScript = false) {
  if (finalizing) return;
  finalizing = true;
  cancelPendingAnswer();
  const leadQuality = calculateLeadQuality();

  try {
    if (offScript) {
      await playAudio(AUDIO.offScript, "Kenny", { allowWhenStopped: true });
    } else if (leadQuality === "hot") {
      addTranscript("Kenny", "Hot lead outcome and preferred follow-up time");
      await playAudio(AUDIO.hot, "Kenny", { allowWhenStopped: true });

      if (!manualEndRequested) {
        // The hot outcome recording itself asks the customer for a preferred follow-up time.
        // Keep the call active so an answer can be collected and validated.
        callRunning = true;
        const followUpStep = {
          key: "followUpTime",
          audio: AUDIO.hot,
          label: "Preferred follow-up time"
        };
        const followUpResult = await collectValidatedAnswer(followUpStep);
        answers.followUpTime = followUpResult.value;
        answers._validation = answers._validation || {};
        answers._validation.followUpTime = followUpResult;
        addTranscript("System", `Preferred follow-up time saved: ${followUpResult.value}`);
        callRunning = false;
      }
    } else {
      await playAudio(AUDIO[leadQuality], "Kenny", { allowWhenStopped: true });
    }

    if (!manualEndRequested) await playAudio(AUDIO.callback, "Kenny", { allowWhenStopped: true });
    if (!manualEndRequested) await playAudio(AUDIO.goodbye, "Kenny", { allowWhenStopped: true });
  } catch (error) {
    if (error.message !== "CALL_ENDED") {
      console.warn("Closing audio error:", error.message);
    }
  }

  callRunning = false;
  if (manualEndRequested) return;
  setCallState("Call complete. Saving the lead...");

  try {
    const result = await saveRecordedLead({
      transcript: transcriptLines.join("\n"),
      answers,
      leadQuality,
      callerSentiment: offScript ? "neutral" : "positive"
    });

    closeCallInterface(result.message || "Lead saved and email processed.");
  } catch (error) {
    setStatus(`Call ended, but saving failed: ${error.message}`, true);
    setCallState("Save failed");
  } finally {
    endCallButton.disabled = true;
    startCallButton.disabled = false;
    finalizing = false;
  }
}

async function endCallImmediately(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if ((!callRunning && !finalizing) || manualEndRequested) return;

  manualEndRequested = true;
  callRunning = false;
  finalizing = true;
  endCallButton.disabled = true;

  // Stop sound before doing any async work. This also invalidates every older audio promise.
  stopActiveAudio();
  stopRecognition();
  cancelPendingAnswer();
  addTranscript("System", "Customer ended the call manually.");
  setCallState("Call ended. Saving available answers...");
  setStatus("The call was stopped immediately. Kenny will not continue speaking.");
  endCallButton.disabled = true;

  try {
    const result = await saveRecordedLead({
      transcript: transcriptLines.join("\n"),
      answers,
      leadQuality: calculateLeadQuality(),
      callerSentiment: "neutral",
      manuallyEnded: true
    });
    closeCallInterface(result.message || "Call ended and available answers were saved.");
  } catch (error) {
    setStatus(`Call stopped, but saving failed: ${error.message}`, true);
    setCallState("Save failed");
  } finally {
    startCallButton.disabled = false;
    finalizing = false;
  }
}

micPermissionButton.addEventListener("click", requestMicrophonePermission);
continueTypingOnly.addEventListener("click", continueWithoutMicrophone);
answerIncomingButton.addEventListener("click", answerIncomingCall);
declineIncomingButton.addEventListener("click", declineIncomingCall);
startCallButton.addEventListener("click", runConversation);
endCallButton.addEventListener("pointerdown", endCallImmediately, { capture: true });
endCallButton.addEventListener("click", endCallImmediately, { capture: true });

typedAnswer.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitTypedAnswer.click();
  }
});

toggleAccessCode.addEventListener("click", () => {
  const showing = accessCodeInput.type === "text";
  accessCodeInput.type = showing ? "password" : "text";
  toggleAccessCode.textContent = showing ? "Show" : "Hide";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const email = document.getElementById("email").value.trim();
  const accessCode = accessCodeInput.value.trim();

  if (!name || !phone || !accessCode) {
    setStatus("Full name, phone number, and access code are required.", true);
    return;
  }

  submitButton.disabled = true;
  setStatus("Checking secure access…");

  try {
    await postJson("/api/demo-access", { accessCode });
    setStatus("Access approved. Choose how you would like to answer…");
    await askForMicrophoneChoice();
    setStatus("Preparing your private incoming call…");

    const result = await postJson("/api/leads", { name, phone, email, accessCode });
    currentLeadId = result.lead._id;
    localStorage.setItem("kennyLeadId", currentLeadId);
    form.hidden = true;
    showIncomingCall();
    setStatus("Access approved. Kenny is calling now.");
  } catch (error) {
    micGate.classList.add("mic-gate-hidden");
    setStatus(error.message, true);
    submitButton.disabled = false;
  }
});
