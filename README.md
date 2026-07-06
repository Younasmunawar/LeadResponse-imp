# Kenny Original Voice Agent v18

## v18: Local-first validation and 3+2 Gemini routing

The live call now validates common answers locally before contacting Gemini. This keeps clear answers fast and reduces quota usage.

- Local rules cover consent, buy/lease, purpose, Abu Dhabi areas and property types, budget formats, timelines, cash/finance, WhatsApp preference, and follow-up times.
- Ambiguous answers only: Gemini validation key 1, then key 2, then key 3.
- Each validation key has a 2-second hard timeout; maximum AI validation delay is 6 seconds.
- If all three validation keys fail, strict local fallback is used and the call continues.
- Final call analysis uses two separate finalization keys, up to 5 seconds each.
- If both finalization keys fail, MongoDB/dashboard/email still use the captured local answers.
- Gemini provider errors remain in server logs and are not shown to the caller.

### Recommended environment variables

```env
GEMINI_VALIDATION_KEY_1=
GEMINI_VALIDATION_KEY_2=
GEMINI_VALIDATION_KEY_3=
GEMINI_FINALIZATION_KEY_1=
GEMINI_FINALIZATION_KEY_2=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_VALIDATION_TIMEOUT_MS=2000
GEMINI_FINALIZATION_TIMEOUT_MS=5000
```

# Kenny Original Voice Agent v15

A responsive Falcon Heights Abu Dhabi private demo with an incoming-call experience, Kenny original recordings, typed and spoken replies, Gemini analysis, MongoDB, Brevo, dashboard, delete, and CSV export.

## New in v15
- Polished mobile and desktop landing page with complete feature and call-flow explanation.
- Server-enforced private access code. Default: `LEAD2026`; configure `DEMO_ACCESS_CODE` in production.
- Invalid or missing code creates no lead and starts no call.
- Incoming mobile-call interface with generated ringtone, Answer, and Decline controls.
- Answering connects directly to Kenny; no confusing second start button.
- New Falcon Heights Abu Dhabi opening recording replaces the previous opening.
- Voice listening remains available for up to seven seconds and processes speech as soon as a final result arrives.
- Typed answers remain available at every question and have priority when submitted.
- Immediate End Call behavior is preserved.

## Required environment variables
See `.env.example`. Do not manually set `PORT` on Render or Railway.

## Run
```bash
npm install
npm run check
npm start
```

## v16 interface fixes
- Restored complete responsive dashboard styling.
- Active call interface now closes automatically after a completed call, declined flow, or manual End Call save.
- Expanded the public feature explanation for accessible voice and typed responses.

## v17 mobile End Call fix
The active call screen now uses the dynamic mobile viewport height (`100dvh`), safe-area padding, internal scrolling, and a sticky End Call control so the button remains fully visible on small phones and devices with browser/navigation bars.

## v19 qualification scoring

This build classifies each locally recognized answer as **positive**, **neutral**, **negative**, or **irrelevant**.

- Positive = clear actionable property interest/readiness.
- Neutral = relevant but undecided, flexible, long-term, or preferring another contact channel.
- Negative = refusal, no active requirement, no workable funds, cancelled plan, or do-not-contact instruction.
- Irrelevant = does not answer the question and triggers clarification.

Scoring excludes property type and follow-up time:

```text
effective score = positive + (neutral × 0.5) - negative
hot  = score >= 5, at least 4 positive answers, and no hard negative
warm = score >= 3 and no hard negative
cold = otherwise
```

Gemini still has meaningful authority:

1. It validates locally ambiguous answers using the three validation keys.
2. It classifies ambiguous answers as positive/neutral/negative/irrelevant.
3. During finalization, it reviews the full transcript, recommends quality, and supplies a confidence score.
4. A high-confidence Gemini recommendation can move a borderline lead by one band, but cannot override a hard negative such as “do not contact”.
