# Kenny Original-Voice Lead Agent

This build uses Kenny's supplied MP3 recordings for the live qualification flow. It does not synthesize or clone Kenny's voice.

## Flow

1. Visitor grants microphone permission.
2. Visitor submits name, phone, and optional email.
3. The browser plays Kenny's original question clips.
4. Chrome Speech Recognition captures each customer answer.
5. If speech recognition is unavailable or unclear, a typed-answer fallback appears.
6. The browser sends structured answers and the transcript to the Node.js backend.
7. MongoDB stores the completed lead.
8. Brevo sends the lead email to all addresses in `EMAIL_TO`.
9. The dashboard displays the saved lead.

## Audio sequence

- Buy or lease
- Personal use or investment (buying flow only)
- Preferred area
- Budget
- Timeline
- Cash or finance (buying flow only)
- Hot/warm/cold outcome
- Callback confirmation
- Goodbye

Acknowledgement and clarification clips are inserted between questions. The supplied voicemail recording is also included in `public/audio/02-voicemail.mp3` for future telephone/voicemail use.

## Browser support

Google Chrome or Microsoft Edge is recommended because the build uses the browser Web Speech API for customer transcription. A typed fallback is built in.

## Environment variables

```env
MONGO_URI=
BREVO_API_KEY=
EMAIL_FROM=
EMAIL_FROM_NAME=Kenny Response Agent
EMAIL_TO=first@example.com,second@example.com
NODE_ENV=production
```

The old Vapi variables and webhook remain supported for the legacy Vapi flow, but they are not required for the original-recordings browser flow.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.
