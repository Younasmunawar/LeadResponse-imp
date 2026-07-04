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

let currentLeadId = "";
let microphoneReady = false;
let recognition = null;
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
  if (!speechRecognitionSupported() || controller.settled || manualEndRequested) {
    retryVoiceButton.hidden = true;
    answerHint.textContent = "Voice recognition is unavailable. Please type your answer.";
    setCallState("Waiting for your typed answer...");
    return;
  }

  stopRecognition();
  retryVoiceButton.hidden = true;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const instance = new Recognition();
  recognition = instance;
  instance.lang = "en-US";
  instance.interimResults = true;
  instance.continuous = false;
  instance.maxAlternatives = 1;

  let finalText = "";

  instance.onstart = () => {
    if (controller.settled) return;
    waitingForAnswer = true;
    setCallState("Listening... You can also type below. Typed submission has priority.");
  };

  instance.onresult = (event) => {
    if (controller.settled) return;
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i][0].transcript.trim();
      if (event.results[i].isFinal) finalText += `${text} `;
      else interim += `${text} `;
    }

    if (interim.trim()) {
      setCallState(`Listening: ${interim.trim()} — or submit a typed answer.`);
    }
  };

  instance.onerror = (event) => {
    if (controller.settled) return;
    waitingForAnswer = false;
    recognition = null;

    if (event.error === "aborted") return;
    retryVoiceButton.hidden = false;
    answerHint.textContent = "No clear speech was detected. Type your answer, or select Listen again.";
    setCallState("Waiting for a typed answer or another voice attempt...");
  };

  instance.onend = () => {
    if (controller.settled) return;
    waitingForAnswer = false;
    recognition = null;
    const spoken = finalText.trim();

    if (spoken) {
      controller.finish(spoken, "voice");
      return;
    }

    retryVoiceButton.hidden = false;
    answerHint.textContent = "No speech was detected. Type your answer, or select Listen again.";
    setCallState("Waiting for a typed answer or another voice attempt...");
  };

  try {
    instance.start();
  } catch (error) {
    recognition = null;
    retryVoiceButton.hidden = false;
    answerHint.textContent = "Voice listening could not start. Type your answer, or select Listen again.";
    setCallState("Waiting for your answer...");
    console.warn("Speech recognition start error:", error.message);
  }
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
      if (!controller.settled) startVoiceRecognition(controller);
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
  setCallState(`Checking answer relevance with Gemini (${attempt}/3)...`);
  const result = await postJson("/api/validate-answer", {
    questionKey: step.key,
    questionLabel: step.label,
    answer: rawAnswer,
    attempt,
    previousAttempts
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
      reason: String(validation.reason || "")
    };
    attempts.push(candidate);

    addTranscript(
      "System",
      `${step.label} validation: ${candidate.relevant ? "relevant" : "not relevant"} (${candidate.relevanceScore}/100)`
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

function calculateLeadScore() {
  // Property type and follow-up time are deliberately excluded.
  const validated = (key) => answers?._validation?.[key]?.forcedClosestMatch !== true;
  const checks = [
    ["intent", validated("intent") && ["buy", "lease"].includes(String(answers.intent || "").toLowerCase())],
    ["purpose", validated("purpose") && isMeaningfulAnswer(answers.purpose)],
    ["preferredArea", validated("preferredArea") && isMeaningfulAnswer(answers.preferredArea)],
    ["budget", validated("budget") && isMeaningfulAnswer(answers.budget)],
    ["timeline", validated("timeline") && isMeaningfulAnswer(answers.timeline)],
    ["paymentMethod", validated("paymentMethod") && ["cash", "finance"].includes(String(answers.paymentMethod || "").toLowerCase())],
    ["whatsappConsent", validated("whatsappConsent") && String(answers.whatsappConsent || "").toLowerCase() === "yes"]
  ];

  const applicable = checks.filter(([key]) => !(key === "paymentMethod" && answers.intent === "lease"));
  const answeredCount = applicable.filter(([, passed]) => passed).length;

  return {
    answeredCount,
    possibleCount: applicable.length,
    leadQuality: answeredCount >= 5 ? "hot" : answeredCount >= 4 ? "warm" : "cold"
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

    setStatus(result.message || "Call ended and response saved.");
    setCallState("Completed");
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

    setStatus(result.message || "Lead saved and email processed.");
    setCallState("Completed");
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
    setStatus(result.message || "Call ended and available answers were saved.");
    setCallState("Ended");
  } catch (error) {
    setStatus(`Call stopped, but saving failed: ${error.message}`, true);
    setCallState("Save failed");
  } finally {
    startCallButton.disabled = false;
    finalizing = false;
  }
}

micPermissionButton.addEventListener("click", requestMicrophonePermission);
document.addEventListener("DOMContentLoaded", initializeMicrophoneGate);
startCallButton.addEventListener("click", runConversation);
endCallButton.addEventListener("pointerdown", endCallImmediately, { capture: true });
endCallButton.addEventListener("click", endCallImmediately, { capture: true });

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
      setStatus("Voice recognition is unavailable in this browser. You can answer every question by typing.", true);
    }
  } catch (error) {
    setStatus(error.message, true);
    submitButton.disabled = false;
  }
});
