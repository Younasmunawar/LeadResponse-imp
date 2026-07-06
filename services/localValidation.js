function clean(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9+,.'\-\s]/g, " ")
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
  hardNegative = false,
  metadata = {}
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
    source: "local",
    metadata
  };
}

const POSITIVE_YES = /\b(yes|yeah|yea|yep|yup|sure|ok|okay|alright|all right|of course|absolutely|certainly|definitely|go ahead|please do|continue|carry on|sounds good|no problem|why not|i can talk|i am free|im free|i have time|i have a few minutes|i have few minutes|that is fine|thats fine|fine by me|happy to|please continue|you may continue|you can continue|proceed|lets do it|let us do it|yes please|sure thing|go on|i am listening|im listening)\b/;
const CLEAR_NO = /\b(no|nope|nah|not now|do not|don't|dont|stop|not interested|not anymore|busy|can't talk|cannot talk|cant talk|call later|maybe later|another time|do not call|dont call|remove my number|wrong number|never contact|do not contact|not looking anymore|already bought|already purchased|already rented|already leased|cancelled|canceled my plan|changed my mind|leave me alone|unsubscribe|take me off|not required|no requirement)\b/;
const HARD_NEGATIVE = /\b(not interested|do not contact|dont contact|never contact|remove my number|stop calling|stop messaging|wrong number|changed my mind|cancelled|canceled my plan|not looking anymore|already bought|already rented|leave me alone|unsubscribe|take me off)\b/;
const NEUTRAL_UNCERTAIN = /\b(i don't know|i dont know|dont know|not sure|unsure|haven't decided|have not decided|not decided|still deciding|still considering|open to suggestions|you suggest|anything suitable|flexible|no preference|depends|maybe|possibly|could be|either|both|just exploring|just looking|researching|comparing options|need advice|need guidance|i will decide|will decide|not fixed|undecided|let me see|show me options|open minded|open-minded)\b/;
const REPEAT_REQUEST = /\b(repeat|say that again|come again|pardon|what was the question|repeat the question|could you repeat|please repeat|can you repeat|ask again|sorry what|sorry i did not hear|i did not hear|didn't hear|could not hear)\b/;
const OBVIOUSLY_UNRELATED = /\b(google translator|google translate|youtube|facebook|instagram|tiktok|weather|football|cricket|music|movie|random|test test|hello hello|artificial intelligence|chatgpt|gemini|laptop|computer game|whatsapp status|news today|stock market|bitcoin|crypto|recipe|song|television|camera|browser|internet speed)\b/;

const ABU_DHABI_AREAS = [
  "abu dhabi", "abu dhabi city", "yas", "yas island", "saadiyat", "saadiyat island",
  "al reem", "reem", "reem island", "al raha", "al raha beach", "al raha gardens",
  "khalifa city", "khalifa a", "khalifa b", "mohammed bin zayed city", "mbz", "mbz city",
  "masdar", "masdar city", "al reef", "reef", "al maryah", "maryah island", "corniche",
  "al bateen", "bateen", "al mushrif", "mushrif", "al shamkha", "shamkha",
  "al shahama", "shahama", "baniyas", "al ain", "hudayriyat", "hudayriyat island",
  "nurai island", "ramhan island", "fahid island", "zayed city", "zayed sports city",
  "al marina", "marina village", "rabdan", "al maqtaa", "maqtaa", "khalidiyah",
  "al khalidiyah", "tourist club area", "tca", "al muroor", "muroor", "al nahyan",
  "al manaseer", "al karamah", "al zahiyah", "electra", "electra street", "hamdan",
  "hamdan street", "al ghadeer", "ghadeer", "al samha", "samha", "al falah",
  "al shawamekh", "shawamekh", "shakhbout city", "shakhbout", "al mina", "mina zayed",
  "mussafah", "mussafah shabiya", "shabiya", "al wathba", "wathba", "al raha",
  "al bandar", "al muneera", "al zeina", "sowwah square", "al qurm", "al rawdah",
  "al maqtah", "danet abu dhabi", "capital centre", "hydra village", "bloom gardens",
  "bloom living", "al jubail island", "jubail island", "al sederah", "al reef villas"
];

const PROPERTY_TYPES = /\b(apartment|apartments|flat|flats|studio|studios|penthouse|penthouses|duplex|duplexes|villa|villas|townhouse|townhouses|house|houses|office|offices|shop|shops|retail|warehouse|warehouses|commercial|commercial unit|land|plot|plots|building|buildings|mansion|mansions|compound|compounds|farm|farms|hotel apartment|serviced apartment|one bedroom|two bedroom|three bedroom|four bedroom|five bedroom|1 bedroom|2 bedroom|3 bedroom|4 bedroom|5 bedroom|1 bhk|2 bhk|3 bhk|4 bhk|single bedroom|double bedroom)\b/;

const TIMELINE_POSITIVE = /\b(immediately|asap|a s a p|right away|straight away|now|ready now|urgent|urgently|near term|near time|short term|very soon|soon|as soon as possible|this week|next week|within a week|in a week|this month|next month|within a month|in one month|within two months|in two months|within three months|in three months|two to three months|couple of months|a couple months|few months|a few months|this quarter|next quarter|this year|later this year|before year end|before the end of the year|before december|before summer|before ramadan|before eid|within six months|in six months)\b/;
const TIMELINE_NEUTRAL = /\b(next year|early next year|later next year|long term|longer term|later|sometime later|after summer|after ramadan|after eid|after the holidays|when ready|when i am ready|when i find the right property|no rush|not urgent|six months or more|more than six months|one year|two years|future|eventually|no fixed timeline|no timeline|still exploring|just looking|planning stage|research stage)\b/;

function containsArea(text) {
  return ABU_DHABI_AREAS.some((area) => text.includes(area));
}

function containsNumberishBudget(text) {
  return /\d/.test(text) || /\b(aed|dh|dhs|dirham|dirhams|thousand|million|half a million|quarter million|one point|one and a half|hundred thousand|hundred k|lakh|lac|crore)\b/.test(text);
}

function parseBudgetValue(raw) {
  const text = clean(raw);
  const rangeMatch = text.match(/(?:aed|dh|dhs|dirham|dirhams)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|m|mn|million)?\s*(?:to|-|and)\s*(?:aed|dh|dhs|dirham|dirhams)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|m|mn|million)?/i);

  const convert = (number, suffix) => {
    let value = Number(String(number).replace(/,/g, ""));
    const unit = String(suffix || "").toLowerCase();
    if (["k", "thousand"].includes(unit)) value *= 1_000;
    if (["m", "mn", "million"].includes(unit)) value *= 1_000_000;
    return Number.isFinite(value) ? value : null;
  };

  if (rangeMatch) {
    const first = convert(rangeMatch[1], rangeMatch[2]);
    const second = convert(rangeMatch[3], rangeMatch[4]);
    if (first && second) return { min: Math.min(first, second), max: Math.max(first, second) };
  }

  const numberMatch = text.match(/(?:aed|dh|dhs|dirham|dirhams)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|m|mn|million)?/i);
  if (numberMatch) {
    const value = convert(numberMatch[1], numberMatch[2]);
    if (value && value > 0) return { min: value, max: value };
  }

  const words = {
    "quarter million": 250000,
    "half a million": 500000,
    "half million": 500000,
    "one million": 1000000,
    "one point one million": 1100000,
    "one point two million": 1200000,
    "one point three million": 1300000,
    "one point four million": 1400000,
    "one point five million": 1500000,
    "one and a half million": 1500000,
    "one point six million": 1600000,
    "one point seven million": 1700000,
    "one point eight million": 1800000,
    "one point nine million": 1900000,
    "two million": 2000000,
    "two point five million": 2500000,
    "three million": 3000000,
    "four million": 4000000,
    "five million": 5000000,
    "six million": 6000000,
    "seven million": 7000000,
    "eight million": 8000000,
    "nine million": 9000000,
    "ten million": 10000000,
    "fifty thousand": 50000,
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
    if (text.includes(phrase)) return { min: value, max: value };
  }

  return null;
}

function normalizeBudget(raw) {
  const parsed = parseBudgetValue(raw);
  if (!parsed) return String(raw || "").trim();
  if (parsed.min !== parsed.max) {
    return `AED ${Math.round(parsed.min).toLocaleString("en-US")} - ${Math.round(parsed.max).toLocaleString("en-US")}`;
  }
  return `AED ${Math.round(parsed.min).toLocaleString("en-US")}`;
}

function unrelated(raw, text) {
  if (!text || text.length < 2) {
    return makeResult({
      relevant: false,
      score: 0,
      normalizedAnswer: "unknown",
      reason: "No usable answer was provided.",
      classification: "irrelevant",
      confidence: 100
    });
  }

  if (REPEAT_REQUEST.test(text)) {
    return makeResult({
      relevant: false,
      score: 5,
      normalizedAnswer: raw,
      reason: "The customer asked for the question to be repeated.",
      classification: "irrelevant",
      confidence: 100
    });
  }

  if (OBVIOUSLY_UNRELATED.test(text)) {
    return makeResult({
      relevant: false,
      score: 2,
      normalizedAnswer: raw,
      reason: "The answer is clearly unrelated to the question.",
      classification: "irrelevant",
      confidence: 100
    });
  }

  return null;
}

function hardNegativeResult(raw, reason) {
  return makeResult({
    relevant: true,
    score: 100,
    normalizedAnswer: raw,
    reason,
    classification: "negative",
    confidence: 100,
    hardNegative: true
  });
}

export function validateAnswerLocally(questionKey, answer, context = {}) {
  const raw = String(answer || "").trim();
  const text = clean(raw);
  const invalid = unrelated(raw, text);
  if (invalid) return invalid;

  if (questionKey === "consent") {
    if (POSITIVE_YES.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "yes", reason: "Clear permission to continue.", classification: "positive", confidence: 100 });
    }
    if (CLEAR_NO.test(text)) {
      return hardNegativeResult(raw, "Clear refusal or request not to continue.");
    }
    if (/\b(make it quick|be brief|what is this about|who are you|how long|few seconds|one minute|tell me quickly|only a minute|i am in a hurry|short call)\b/.test(text)) {
      return makeResult({ relevant: true, score: 84, normalizedAnswer: raw, reason: "The customer is cautious but permits a brief continuation.", classification: "neutral", confidence: 92 });
    }
    return makeResult({ relevant: false, score: 25, normalizedAnswer: raw, reason: "Consent was not clear.", classification: "irrelevant", confidence: 35, decisive: false });
  }

  if (questionKey === "intent") {
    if (HARD_NEGATIVE.test(text) || /\b(neither|no property|not looking|already purchased|already rented|already leased|no longer need one)\b/.test(text)) {
      return hardNegativeResult(raw, "The customer stated there is no active property requirement.");
    }
    if (/\b(buy|buying|purchase|purchasing|own|ownership|for sale|become owner|acquire|acquisition|looking to buy|want to buy|want ownership|home ownership)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "buy", reason: "Clear purchase intent.", classification: "positive", confidence: 100 });
    }
    if (/\b(lease|leasing|rent|renting|rental|tenant|take on rent|looking to rent|want to rent|short term rental|long term rental)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "lease", reason: "Clear leasing intent.", classification: "positive", confidence: 100 });
    }
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(depends on price|maybe buy|maybe rent|buy or rent|rent or buy|open to both|whichever is better|not decided between buying and renting)\b/.test(text)) {
      return makeResult({ relevant: true, score: 86, normalizedAnswer: raw, reason: "The customer is considering options but has not committed to buy or lease.", classification: "neutral", confidence: 92 });
    }
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "Purchase or lease intent was not identified.", classification: "irrelevant", confidence: 35, decisive: false });
  }

  if (questionKey === "purpose") {
    if (HARD_NEGATIVE.test(text) || /\b(neither|no purpose|no requirement|nothing now|not needed)\b/.test(text)) {
      return hardNegativeResult(raw, "The customer stated there is no current purpose or requirement.");
    }
    if (/\b(invest|investment|investing|roi|return on investment|rental income|capital appreciation|resale|resell|flip|portfolio|wealth|income generating|passive income|future profit|profit)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "investment", reason: "Clear investment purpose.", classification: "positive", confidence: 100 });
    }
    if (/\b(personal|myself|my own|own use|for me|to live|living|live there|home|residence|residential use|primary home|holiday home|vacation home|second home|move in|self use)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "personal", reason: "Clear personal-use purpose.", classification: "positive", confidence: 100 });
    }
    if (/\b(family|parents|children|kids|wife|husband|spouse|relatives|family home|for my family|family residence)\b/.test(text)) {
      return makeResult({ relevant: true, score: 98, normalizedAnswer: "family", reason: "Clear family-use purpose.", classification: "positive", confidence: 98 });
    }
    if (/\b(business|office|company|commercial use|staff accommodation|employee accommodation|corporate use|shop|warehouse|business premises)\b/.test(text)) {
      return makeResult({ relevant: true, score: 98, normalizedAnswer: "business", reason: "Clear business purpose.", classification: "positive", confidence: 98 });
    }
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(could be either|personal or investment|investment or personal|both personal and investment|maybe for family|depends on options)\b/.test(text)) {
      return makeResult({ relevant: true, score: 84, normalizedAnswer: raw, reason: "The customer is still deciding the purpose.", classification: "neutral", confidence: 90 });
    }
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "The intended use was not identified.", classification: "irrelevant", confidence: 35, decisive: false });
  }

  if (questionKey === "preferredArea") {
    if (HARD_NEGATIVE.test(text) || /\b(no property|not looking anymore|nothing in mind|no longer interested)\b/.test(text)) {
      return hardNegativeResult(raw, "The customer has no current area or property requirement.");
    }

    const areaFound = containsArea(text);
    const propertyFound = PROPERTY_TYPES.test(text);

    if (areaFound || propertyFound) {
      return makeResult({
        relevant: true,
        score: areaFound && propertyFound ? 100 : 94,
        normalizedAnswer: raw,
        reason: areaFound && propertyFound
          ? "A specific Abu Dhabi area and property type were provided."
          : "A recognizable location or property type was provided.",
        classification: "positive",
        confidence: areaFound && propertyFound ? 100 : 95,
        metadata: { areaFound, propertyFound }
      });
    }

    if (/\b(any area|anywhere|any location|open to suggestions|you suggest|no preference|flexible location|location flexible|near city|city center|city centre|waterfront|beachfront|near airport|near school|near work|good community|best area|family area|investment area|prime area|good location|wherever suitable)\b/.test(text) || NEUTRAL_UNCERTAIN.test(text)) {
      return makeResult({ relevant: true, score: 85, normalizedAnswer: raw, reason: "The customer is flexible or needs recommendations for area/property type.", classification: "neutral", confidence: 90 });
    }

    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "No recognizable area or property preference was provided.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  if (questionKey === "budget") {
    if (/\b(no money|no funds|cannot afford|can't afford|cant afford|zero budget|no budget at all|not spending|not buying anymore|cannot pay|no financial capacity)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "The customer stated there is no workable budget.", classification: "negative", confidence: 98, hardNegative: /not buying anymore|cannot afford|can't afford|cant afford/.test(text) });
    }

    if (containsNumberishBudget(text)) {
      const parsed = parseBudgetValue(raw);
      const intent = clean(context?.intent || "");
      let classification = "positive";
      let reason = "A budget amount or range was provided.";
      let confidence = 100;

      if (parsed?.max) {
        if (intent === "buy" && parsed.max < 100000) {
          classification = "negative";
          reason = "A purchase budget was provided, but it appears unlikely to be workable for the stated market.";
          confidence = 88;
        } else if (intent === "buy" && parsed.max < 300000) {
          classification = "neutral";
          reason = "A purchase budget was provided, but it may significantly limit available options.";
          confidence = 88;
        } else if (intent === "lease" && parsed.max < 20000) {
          classification = "neutral";
          reason = "A leasing budget was provided, but it may significantly limit available options.";
          confidence = 86;
        }
      }

      return makeResult({
        relevant: true,
        score: 100,
        normalizedAnswer: normalizeBudget(raw),
        reason,
        classification,
        confidence,
        metadata: parsed || {}
      });
    }

    if (NEUTRAL_UNCERTAIN.test(text) || /\b(depends on options|depends on property|show me options|not fixed|negotiable|market price|reasonable price|need to see first|within market|open budget|budget flexible|can stretch|depends on deal|best possible price|not aware of prices)\b/.test(text)) {
      return makeResult({ relevant: true, score: 85, normalizedAnswer: raw, reason: "The customer directly stated that the budget is undecided or flexible.", classification: "neutral", confidence: 92 });
    }

    return makeResult({ relevant: false, score: 15, normalizedAnswer: raw, reason: "No budget amount, range, or direct budget response was found.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  if (questionKey === "timeline") {
    if (/\b(cancelled|canceled|not planning|never|no longer moving|not moving|not buying anymore|not renting anymore|plan is off|dropped the plan|changed my mind)\b/.test(text)) {
      return hardNegativeResult(raw, "The customer stated the property plan is no longer active.");
    }

    if (
      TIMELINE_POSITIVE.test(text) ||
      /\b(today|tomorrow|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(text) ||
      /\b\d+\s*(day|days|week|weeks|month|months)\b/.test(text) ||
      /\b(in|within|after)\s+(one|two|three|four|five|six|seven|eight|nine|ten|a couple|a few)\s+(day|days|week|weeks|month|months)\b/.test(text)
    ) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "A clear near or medium-term timeline was provided.", classification: "positive", confidence: 100 });
    }

    if (
      TIMELINE_NEUTRAL.test(text) ||
      /\b\d+\s*(year|years)\b/.test(text) ||
      /\b(in|within|after)\s+(one|two|three|four|five)\s+(year|years)\b/.test(text) ||
      NEUTRAL_UNCERTAIN.test(text)
    ) {
      return makeResult({ relevant: true, score: 86, normalizedAnswer: raw, reason: "The customer provided a longer-term or flexible timeline.", classification: "neutral", confidence: 92 });
    }

    return makeResult({ relevant: false, score: 10, normalizedAnswer: raw, reason: "The answer does not describe a timeline.", classification: "irrelevant", confidence: 25, decisive: false });
  }

  if (questionKey === "paymentMethod") {
    if (/\b(no funds|cannot arrange finance|can't arrange finance|cant arrange finance|loan rejected|mortgage rejected|not purchasing anymore|no down payment|cannot qualify|cant qualify)\b/.test(text)) {
      return makeResult({ relevant: true, score: 98, normalizedAnswer: raw, reason: "The customer cannot currently fund the purchase.", classification: "negative", confidence: 96, hardNegative: /not purchasing anymore/.test(text) });
    }
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(depends|either|both options|part cash part finance|part cash and part finance|cash and finance|mix of cash and finance|need pre approval|need pre-approval|arranging funds|checking mortgage|need to speak to bank|open to finance)\b/.test(text)) {
      return makeResult({ relevant: true, score: 84, normalizedAnswer: raw, reason: "The customer is undecided or open to multiple funding options.", classification: "neutral", confidence: 90 });
    }
    if (/\b(cash|cash buyer|full cash|all cash|outright|self funded|self-funded|own funds|pay cash|cash payment|without mortgage)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "cash", reason: "Clear cash-purchase method.", classification: "positive", confidence: 100 });
    }
    if (/\b(finance|financing|mortgage|loan|bank loan|home loan|bank finance|installment|instalment|installments|instalments|payment plan|developer plan|mortgage facility|pre approval|pre-approval)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "finance", reason: "Clear finance or mortgage method.", classification: "positive", confidence: 100 });
    }
    return makeResult({ relevant: false, score: 15, normalizedAnswer: raw, reason: "Cash or finance was not identified.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  if (questionKey === "whatsappConsent") {
    if (/\b(do not message|don't message|dont message|do not contact|dont contact|no whatsapp|not on whatsapp|remove my number|stop messaging|never message)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "no", reason: "WhatsApp contact was clearly declined.", classification: "negative", confidence: 100, hardNegative: /do not contact|dont contact|remove my number|stop messaging|never message/.test(text) });
    }
    if (POSITIVE_YES.test(text) || /\b(same number|this number|use this|use this number|whatsapp me|send on whatsapp|message me|whatsapp is fine|send it there|you can whatsapp|contact me on whatsapp|whatsapp works|whatsapp is best)\b/.test(text)) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: "yes", reason: "WhatsApp contact was confirmed.", classification: "positive", confidence: 100 });
    }
    if (/\+?\d[\d\s()\-]{6,}/.test(raw) || /\b(another number|different number|alternate number|other number|new number)\b/.test(text)) {
      return makeResult({ relevant: true, score: 96, normalizedAnswer: raw, reason: "An alternate WhatsApp number was provided.", classification: "positive", confidence: 96 });
    }
    if (/\b(email is better|email me|call me instead|phone call|normal call|sms|text message|send later|maybe whatsapp|maybe later|prefer email|prefer call)\b/.test(text) || NEUTRAL_UNCERTAIN.test(text)) {
      return makeResult({ relevant: true, score: 84, normalizedAnswer: raw, reason: "The customer prefers another channel or is undecided about WhatsApp.", classification: "neutral", confidence: 90 });
    }
    if (/\b(no thanks|no thank you|not on whatsapp|i do not use whatsapp|dont use whatsapp)\b/.test(text)) {
      return makeResult({ relevant: true, score: 96, normalizedAnswer: "no", reason: "WhatsApp contact was declined.", classification: "negative", confidence: 96 });
    }
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "WhatsApp preference was not clear.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  if (questionKey === "followUpTime") {
    if (/\b(do not call|don't call|dont call|no follow up|no follow-up|do not contact|dont contact|never call|stop calling)\b/.test(text)) {
      return hardNegativeResult(raw, "The customer declined further contact.");
    }
    if (
      /\b(anytime|any time|morning|early morning|late morning|afternoon|evening|night|weekend|weekends|weekday|weekdays|business hours|office hours|after work|after office|lunch time|before noon|after noon|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month)\b/.test(text) ||
      /\b(after|before|around|at)\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/.test(text) ||
      /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(text)
    ) {
      return makeResult({ relevant: true, score: 100, normalizedAnswer: raw, reason: "A preferred follow-up time was provided.", classification: "positive", confidence: 100 });
    }
    if (NEUTRAL_UNCERTAIN.test(text) || /\b(call whenever|no preference|whenever convenient|any suitable time|when free|whenever you are free)\b/.test(text)) {
      return makeResult({ relevant: true, score: 86, normalizedAnswer: raw, reason: "The customer has no specific follow-up preference.", classification: "neutral", confidence: 92 });
    }
    return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "No follow-up time was identified.", classification: "irrelevant", confidence: 30, decisive: false });
  }

  return makeResult({ relevant: false, score: 20, normalizedAnswer: raw, reason: "The answer needs AI validation.", classification: "irrelevant", confidence: 25, decisive: false });
}
