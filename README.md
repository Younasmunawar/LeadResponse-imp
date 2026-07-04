# Kenny Original Voice Agent + Gemini Analysis

A browser-based Dubai real-estate qualification agent that plays Kenny's supplied original MP3 recordings, captures customer answers, analyzes the completed call with Gemini, stores the result in MongoDB, sends a Brevo email, and displays leads in a dashboard.

## Current flow

1. Visitor enables microphone access.
2. Visitor submits name, phone, and optional email.
3. Kenny's opening recording plays first.
4. Affirmative responses such as yes, sure, or of course continue the flow.
5. A negative opening response ends the call and saves a cold lead.
6. The remaining original Kenny recordings ask qualification questions.
7. The backend sends transcript + captured answers to Gemini.
8. Gemini returns structured lead analysis.
9. MongoDB stores the result and Brevo emails all configured recipients.

## Main stack

- Plain HTML/CSS/JavaScript
- Browser Web Speech API
- Node.js + Express
- Gemini API (`gemini-2.5-flash` by default)
- MongoDB Atlas
- Brevo Transactional Email API
- Railway or Render

## Setup

```bash
cp .env.example .env
npm install
npm run check
npm start
```

See `GEMINI_SETUP.md` for API-key and deployment instructions.

## Required environment variables

```env
MONGO_URI=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
BREVO_API_KEY=...
EMAIL_FROM=...
EMAIL_FROM_NAME=Kenny Voice Agent
EMAIL_TO=email1@example.com,email2@example.com
```

`VAPI_PUBLIC_KEY` and `VAPI_ASSISTANT_ID` are optional legacy variables and are not required by the prerecorded browser flow.

## Browser support

Chrome and Edge are recommended because the project uses browser speech recognition. Typed-answer fallback appears when recognition fails or is unavailable.

## Security

Never commit `.env`, API keys, MongoDB passwords, or customer records to GitHub.

## v8 interaction improvements

- The End call button now stops the active Kenny audio immediately, aborts speech recognition, and saves answers collected so far.
- Every question supports typing and speaking at the same time.
- A submitted typed answer has priority and immediately stops the active speech-recognition attempt.
- If no speech is detected, the user can keep typing or press Listen again.

## v9 deterministic scoring and dashboard controls

Lead quality is now calculated by completed qualification answers, not by Gemini judgment:

- 5 or more positive/usable answers: **hot**
- 4 positive/usable answers: **warm**
- fewer than 4: **cold**

Property type and follow-up time are excluded from scoring. The dashboard automatically recalculates older Gemini records when opened. It also includes per-lead delete controls and CSV export.

## Per-question Gemini relevance validation (v11)

Every opening/qualification answer is validated by Gemini before the flow advances. A relevant answer receives the normal acknowledgement and the next question. An unrelated answer triggers the clarification recording and the same question again. After three unsuccessful attempts, the closest attempt is stored with low-confidence metadata, does not count as a positive scoring answer, and the flow moves on.


## v12 conversation refinements
- Hot outcome audio now collects the preferred follow-up time and stores it on the dashboard.
- Clarification audios alternate between `11-glue-sorry-clarifier.mp3` and `12-glue-clarifier.mp3`.
- After a clarification clip, the system listens immediately instead of replaying the question.
- The original question is replayed only when the customer explicitly asks for it to be repeated.
- `10-glue-wonderful.mp3` is no longer used anywhere in the conversation flow.
