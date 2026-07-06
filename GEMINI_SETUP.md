# Gemini Setup

## What Gemini does

The browser still plays Kenny's original MP3 recordings. Customer answers are captured by browser speech recognition. When the call ends, the Node.js backend sends the transcript and captured answers to Gemini for structured lead analysis.

Gemini returns:

- intent
- purpose
- property type
- preferred area
- budget
- timeline
- payment method
- WhatsApp number/consent result
- hot/warm/cold lead quality
- caller sentiment
- summary
- next step
- best follow-up time

The result is saved in MongoDB, shown on the dashboard, and included in the Brevo email.

## Create the API key

1. Open Google AI Studio.
2. Open **API Keys**.
3. Create an API key in a new or existing Google Cloud project.
4. Copy the key.
5. Restrict it to the Gemini API where available.
6. Add it only to your server/deployment environment variables.

## Required deployment variables

```env
NODE_ENV=production
MONGO_URI=your_complete_mongodb_atlas_uri
GEMINI_API_KEY_PRIMARY=your_primary_gemini_key
GEMINI_API_KEY_SECONDARY=your_secondary_gemini_key
GEMINI_MODEL=gemini-2.5-flash
BREVO_API_KEY=your_brevo_key
EMAIL_FROM=your_verified_brevo_sender
EMAIL_FROM_NAME=Kenny Voice Agent
EMAIL_TO=email1@example.com,email2@example.com
```

Do not manually set `PORT` on Railway or Render. The host supplies it.

## Local run

```bash
cp .env.example .env
npm install
npm run check
npm start
```

Open `http://localhost:3000`.

## Health check

Open `/health`. It should show:

```json
{
  "ok": true,
  "geminiConfigured": true,
  "geminiModel": "gemini-2.5-flash"
}
```

## Failure behavior

If Gemini is temporarily unavailable, the backend still saves the transcript and deterministic browser answers using a local fallback. The dashboard record will contain a `processingError` explaining that Gemini failed, so the lead is not lost.

## Two-key failover

This build supports two server-side Gemini API keys:

```env
GEMINI_API_KEY_PRIMARY=first_key
GEMINI_API_KEY_SECONDARY=second_key
```

Requests start in round-robin order. If one key returns HTTP 429, a network error, or a temporary 5xx error, the backend automatically tries the other key. A rate-limited key is placed on a temporary cooldown based on Gemini's retry message. API keys are never returned to the browser or printed in logs.

Both keys must be used in accordance with the applicable Google account/project terms and quotas. Two keys improve availability but do not guarantee unlimited requests.

## Automatic retry when both keys fail

The backend tries both keys. If both are temporarily unavailable, it waits for the provider cooldown (or an exponential delay) and retries. Detailed Gemini errors appear only in Render/Railway logs and are not displayed to website users.

Optional settings:

```env
GEMINI_RETRY_ROUNDS=3
GEMINI_RETRY_DELAY_MS=5000
```


## v20 live answer validation policy

1. Local validation runs first.
2. Only ambiguous answers call Gemini.
3. Validation key 1 receives up to 3.5 seconds.
4. On timeout/network/invalid response, validation key 2 receives up to 3.5 seconds.
5. On HTTP 429 from either validation key, the chain stops immediately and strict local fallback is returned.
6. The browser never receives provider error details.
7. Final analysis still uses two separate finalization keys.
