function clean(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9+.'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeResult({
  relevant,
  score,
  normalizedAnswer,
  reason,
  classification = "neutral",
  confidence = 90,
  decisive = true,
  hardNegative = false
}) {
  return {
    handled: decisive,
    relevant: Boolean(relevant),
    relevanceScore: Math.max(0, Math.min(100, Number(score) || 0)),
    normalizedAnswer: String(normalizedAnswer || "unknown").trim() || "unknown",
    reason: String(reason || "Local validation"),
    classification: ["positive", "neutral", "negative", "irrelevant"].includes(classification)
      ? classification
      : "neutral",
    confidence: Math.max(0, Math.min(100, Number(confidence) || 0)),
    hardNegative: hardNegative === true,
    source: "local"
  };
}

const POSITIVE_YES = /\b(yes|yeah|yep|yup|sure|ok|okay|alright|all right|of course|absolutely|certainly|definitely|go ahead|please do|continue|sounds good|no problem|why not|i can talk|i have time|i have a few minutes|that is fine|thats fine|fine by me|happy to|please continue)\b/;
const CLEAR_NO = /\b(no|nope|nah|not now|do not|don't|stop|not interested|busy|can't talk|cannot talk|call later|maybe later|another time|do not call|dont call|remove my number|wrong number|never contact|do not contact|not looking anymore|already bought|already rented|cancelled|canceled my plan)\b/;
const NEUTRAL_UNCERTAIN = /\b(i don't know|dont know|not sure|unsure|haven't decided|have not decided|not decided|still deciding|still considering|open to suggestions|you suggest|anything suitable|flexible|no preference|depends|maybe|possibly|could be|either|both|just exploring|just looking|researching|comparing options|need advice|need guidance)\b/;
const REPEAT_REQUEST = /\b(repeat|say that again|come again|pardon|what was the question|repeat the question|could you repeat|please repeat)\b/;
const OBVIOUSLY_UNRELATED = /\b(google translator|youtube|facebook|instagram|weather|football|cricket|music|movie|random|test test|hello hello|artificial intelligence|chatgpt|gemini|laptop|computer game)\b/;

const ABU_DHABI_AREAS = [
  "abu dhabi", "yas island", "saadiyat", "saadiyat island", "al reem", "reem island",
  "al raha", "al raha beach", "khalifa city", "mohammed bin zayed city", "mbz city",
  "masdar city", "al reef", "al maryah", "maryah island", "corniche", "al bateen",
  "al mushrif", "mushrif", "al shamkha", "shamkha", "al shahama", "shahama",
  "al raha gardens", "baniyas", "al ain", "hudayriyat", "nurai island", "ramhan island",
  "fahid island", "zayed city", "al marina", "marina village", "rabdan", "al maqtaa",
  "khalidiyah", "al khalidiyah", "tourist club area", "tca", "al muroor", "muroor",
  "al nahyan", "al manaseer", "al karamah", "al zahiyah", "electra street", "hamdan street",
  "al ghadeer", "al samha", "al falah", "al shawamekh", "shakhbout city", "al mina",
  "mussafah", "mussafah shabiya", "al wathba", "al hudayriat", "mina zayed"
];

const PROPERTY_TYPES = /\b(apartment|flat|studio|penthouse|duplex|villa|townhouse|house|office|shop|retail|warehouse|commercial|land|plot|building|mansion|compound|farm|one bedroom|two bedroom|three bedroom|four bedroom|five bedroom|1 bedroom|2 bedroom|3 bedroom|4 bedroom|5 bedroom|1 bhk|2 bhk|3 bhk|4 bhk)\b/;

function containsArea(text) {
  return ABU_DHABI_AREAS.some((area) => text.includes(area));
}

function normalizeBudget(raw) {
  const text = clean(raw);
  const numberMatch = text.match(/(?:aed|dh|dirham|dirhams)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|m|mn|million)?/i);
  if (numberMatch) {
    let value = Number(numberMatch[1].replace(/,/g, ""));
    const suffix = String(numberMatch[2] || "").toLowerCase();
    if (["k", "thousand"].includes(suffix)) value *= 1_000;
    if (["m", "mn", "million"].includes(suffix)) value *= 1_000_000;
    if (Number.isFinite(value) && value > 0) return `AED ${Math.round(value).toLocaleString("en-US")}`;
  }

  const words = {
    "quarter million": 250000,
    "half a million": 500000,
    "one million": 1000000,
    "one point two million": 1200000,
    "one point three million": 1300000,
    "one point four million": 1400000,
    "one point five million": 1500000,
    "one and a half million": 1500000,
    "one point eight million": 1800000,
    "two million": 2000000,
    "two point five million": 2500000,
    "three million": 3000000,
    "four million": 4000000,
    "five million": 5000000,
    "ten million": 10000000,
    "one hundred thousand": 100000,
    "two hundred thousand": 200000,
    "three hundred thousand": 300000,
    "four hundred thousand": 400000,
    "five hundred thousand": 500000,
    "six hundred thousand": 600000,
    "seven hundred thousand": 700000,
    "eight hundred thousand": 800000,
    "nine hundred thousand": 900000
  };
  for (const [phrase, value] of Object.entries(words)) {
    if (text.includes(phrase)) return `AED ${value.toLocaleString("en-US")}`;
  }
  return raw.trim();
}

function unrelated(raw, text) {
  if (!text || text.length < 2) {
    return makeResult({ relevant: false, score: 0, normalizedAnswer: "unknown", reason: "No usable answer was provided.", classification: "irrelevant", confidence: 100 });
  }
  if (REPEAT_REQUEST.test(text)) {
    return makeResult({ relevant: false, score: 5, normalizedAnswer: raw, reason: "The customer asked for the question to be repeated.", classification: "irrelevant", confidence: 100 });
  }
  if (OBVIOUSLY_UNRELATED.test(text)) {
    return makeResult({ relevant: false, score: 2, normalizedAnswer: raw, reason: "The answer is clearly unrelated to the question.", classification: "irrelevant", confidence: 100 });
  }
  return null;
}

export function validateAnswerLocally(questionKey, answer) {
  const raw = String(answer || "").trim();
  const text = clean(raw);
  const invalid = unrelated(raw, text);
  if (invalid) return invalid;

  if (questionKey === "consent") {
    if (POSITIVE_YES.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "yes", reason: "Clear permission to continue.", classification: "positive", confidence: 100 });
    if (CLEAR_NO.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "no", reason: "Clear refusal or request not to continue.", classification: "negative", confidence: 100, hardNegative: true });
    if (/\b(make it quick|be brief|what is this about|who are you|how long|few seconds|one minute|tell me quickly)\b/.test(text)) return makeResult({ relevant: true, score: 82, normalizedAnswer: raw, reason: "The customer is cautious but permits a brief continuation.", classification: "neutral", confidence: 88 });
    return makeResult({ relevant: false, score: 25, normalizedAnswer: raw, reason: "Consent was not clear.", classification: "irrelevant", confidence: 35, decisive: false });
  }

  if (questionKey === "intent") {
    if (CLEAR_NO.test(text) || /\b(neither|no property|not looking|already purchased|already rented)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "The customer stated there is no active property requirement.", classification: "negative", confidence: 98, hardNegative: /not interested|do not contact|not looking/.test(text) });
    if (/\b(buy|buying|purchase|purchasing|own|ownership|for sale|become owner|acquire)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "buy", reason: "Clear purchase intent.", classification: "positive", confidence: 100 });
    if (/\b(lease|leasing|rent|renting|rental|tenant|take on rent)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "lease", reason: "Clear leasing intent.", classification: "positive", confidence: 100 });
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(depends on price|maybe buy|maybe rent|buy or rent)\b/.test(text)) return makeResult({ relevant: true, score: 85, normalizedAnswer: raw, reason: "The customer is considering options but has not committed to buy or lease.", classification: "neutral", confidence: 90 });
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "Purchase or lease intent was not identified.", classification: "irrelevant", confidence: 35, decisive: false });
  }

  if (questionKey === "purpose") {
    if (CLEAR_NO.test(text) || /\b(neither|no purpose|no requirement)\b/.test(text)) return makeResult({ relevant: true, score: 95, normalizedAnswer: raw, reason: "The customer stated there is no current purpose or requirement.", classification: "negative", confidence: 95 });
    if (/\b(invest|investment|roi|return|rental income|capital appreciation|resale|flip|portfolio)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "investment", reason: "Clear investment purpose.", classification: "positive", confidence: 100 });
    if (/\b(personal|myself|own use|to live|living|home|residence|residential use|primary home|holiday home)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "personal", reason: "Clear personal-use purpose.", classification: "positive", confidence: 100 });
    if (/\b(family|parents|children|wife|husband|relatives)\b/.test(text)) return makeResult({ relevant: true, score: 98, normalizedAnswer: "family", reason: "Clear family-use purpose.", classification: "positive", confidence: 98 });
    if (/\b(business|office|company|commercial use|staff accommodation)\b/.test(text)) return makeResult({ relevant: true, score: 98, normalizedAnswer: "business", reason: "Clear business purpose.", classification: "positive", confidence: 98 });
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(could be either|personal or investment)\b/.test(text)) return makeResult({ relevant: true, score: 82, normalizedAnswer: raw, reason: "The customer is still deciding the purpose.", classification: "neutral", confidence: 88 });
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "The intended use was not identified.", classification: "irrelevant", confidence: 35, decisive: false });
  }

  if (questionKey === "preferredArea") {
    if (CLEAR_NO.test(text) || /\b(no property|not looking anymore|nothing in mind)\b/.test(text)) return makeResult({ relevant: true, score: 92, normalizedAnswer: raw, reason: "The customer has no current area/property requirement.", classification: "negative", confidence: 92 });
    const areaFound = containsArea(text);
    const propertyFound = PROPERTY_TYPES.test(text);
    if (areaFound || propertyFound) return makeResult({ relevant: true, score: areaFound && propertyFound ? 100 : 92, normalizedAnswer: raw, reason: "A location and/or property type was provided.", classification: "positive", confidence: areaFound && propertyFound ? 100 : 94 });
    if (/\b(any area|anywhere|open to suggestions|you suggest|no preference|flexible location|near city|city center|waterfront|beachfront|near airport|near school|near work|good community|best area|family area|investment area)\b/.test(text) || NEUTRAL_UNCERTAIN.test(text)) return makeResult({ relevant: true, score: 84, normalizedAnswer: raw, reason: "The customer is flexible or needs recommendations for area/property type.", classification: "neutral", confidence: 88 });
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "No recognizable area or property preference was provided.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  if (questionKey === "budget") {
    if (/\b(no money|no funds|cannot afford|can't afford|zero budget|no budget at all|not spending|not buying anymore)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "The customer stated there is no workable budget.", classification: "negative", confidence: 98, hardNegative: /not buying anymore|cannot afford|can't afford/.test(text) });
    const hasMoney = /\d/.test(text) || /\b(aed|dirham|dirhams|thousand|million|half a million|quarter million|one point|one and a half|hundred thousand)\b/.test(text);
    if (hasMoney) return makeResult({ relevant: true, score: 100, normalizedAnswer: normalizeBudget(raw), reason: "A budget amount or range was provided.", classification: "positive", confidence: 100 });
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(depends on options|show me options|not fixed|negotiable|market price|reasonable price|need to see first|within market)\b/.test(text)) return makeResult({ relevant: true, score: 84, normalizedAnswer: raw, reason: "The customer directly stated that the budget is undecided or flexible.", classification: "neutral", confidence: 90 });
    return makeResult({ relevant: false, score: 15, normalizedAnswer: raw, reason: "No budget amount, range, or direct budget response was found.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  if (questionKey === "timeline") {
    if (/\b(cancelled|canceled|not planning|never|no longer moving|not moving|not buying anymore|not renting anymore)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "The customer stated the property plan is no longer active.", classification: "negative", confidence: 98, hardNegative: true });
    if (/\b(immediately|asap|right away|now|ready now|urgent|near term|short term|soon|this week|next week|this month|next month|within a month|within two months|within three months|couple of months|few months|this quarter|next quarter|this year|before year end|before december)\b/.test(text) || /\b(today|tomorrow|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(text) || /\b\d+\s*(day|days|week|weeks|month|months)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "A clear near or medium-term timeline was provided.", classification: "positive", confidence: 100 });
    if (/\b(next year|long term|later|after summer|after ramadan|after eid|when ready|no rush|sometime later|six months|more than six months|one year|two years)\b/.test(text) || /\b\d+\s*(year|years)\b/.test(text) || NEUTRAL_UNCERTAIN.test(text) || /\b(no timeline|not urgent|still exploring|just looking)\b/.test(text)) return makeResult({ relevant: true, score: 84, normalizedAnswer: raw, reason: "The customer provided a longer-term or flexible timeline.", classification: "neutral", confidence: 90 });
    return makeResult({ relevant: false, score: 10, normalizedAnswer: raw, reason: "The answer does not describe a timeline.", classification: "irrelevant", confidence: 25, decisive: false });
  }

  if (questionKey === "paymentMethod") {
    if (/\b(no funds|cannot arrange finance|can't arrange finance|loan rejected|mortgage rejected|not purchasing anymore)\b/.test(text)) return makeResult({ relevant: true, score: 98, normalizedAnswer: raw, reason: "The customer cannot currently fund the purchase.", classification: "negative", confidence: 96 });
    if (/\b(cash|cash buyer|full cash|outright|self funded|self-funded|own funds)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "cash", reason: "Clear cash-purchase method.", classification: "positive", confidence: 100 });
    if (/\b(finance|financing|mortgage|loan|bank|installment|instalment|payment plan|developer plan)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "finance", reason: "Clear finance or mortgage method.", classification: "positive", confidence: 100 });
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(depends|either|both options|part cash part finance|need pre approval|need pre-approval|arranging funds)\b/.test(text)) return makeResult({ relevant: true, score: 82, normalizedAnswer: raw, reason: "The customer is undecided or open to multiple funding options.", classification: "neutral", confidence: 88 });
    return makeResult({ relevant: false, score: 15, normalizedAnswer: raw, reason: "Cash or finance was not identified.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  if (questionKey === "whatsappConsent") {
    if (/\b(do not message|don't message|dont message|do not contact|no whatsapp|not on whatsapp|remove my number|stop messaging)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "no", reason: "WhatsApp contact was clearly declined.", classification: "negative", confidence: 100, hardNegative: /do not contact|remove my number|stop messaging/.test(text) });
    if (POSITIVE_YES.test(text) || /\b(same number|this number|use this|whatsapp me|send on whatsapp|message me|whatsapp is fine|send it there)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: "yes", reason: "WhatsApp contact was confirmed.", classification: "positive", confidence: 100 });
    if (/\+?\d[\d\s()\-]{6,}/.test(raw) || /\b(another number|different number|alternate number)\b/.test(text)) return makeResult({ relevant: true, score: 96, normalizedAnswer: raw, reason: "An alternate WhatsApp number was provided.", classification: "positive", confidence: 96 });
    if (/\b(email is better|email me|call me instead|phone call|sms|send later|maybe whatsapp|maybe later)\b/.test(text) || NEUTRAL_UNCERTAIN.test(text)) return makeResult({ relevant: true, score: 82, normalizedAnswer: raw, reason: "The customer prefers another channel or is undecided about WhatsApp.", classification: "neutral", confidence: 88 });
    if (CLEAR_NO.test(text)) return makeResult({ relevant: true, score: 95, normalizedAnswer: "no", reason: "WhatsApp contact was declined.", classification: "negative", confidence: 95 });
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "WhatsApp preference was not clear.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  if (questionKey === "followUpTime") {
    if (/\b(do not call|don't call|dont call|no follow up|no follow-up|do not contact|never call)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "The customer declined further contact.", classification: "negative", confidence: 100, hardNegative: true });
    if (/\b(anytime|any time|morning|afternoon|evening|night|weekend|weekday|business hours|after work|after office|lunch time|before noon|after noon|after \d|before \d|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text) || /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(text)) return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "A preferred follow-up time was provided.", classification: "positive", confidence: 100 });
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(call whenever|no preference|whenever convenient)\b/.test(text)) return makeResult({ relevant: true, score: 84, normalizedAnswer: raw, reason: "The customer has no specific follow-up preference.", classification: "neutral", confidence: 90 });
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "No follow-up time was identified.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "The answer needs AI validation.", classification: "irrelevant", confidence: 25, decisive: false });
}
