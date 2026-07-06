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
