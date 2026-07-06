# V21 microphone reliability and budget clarification update

## Microphone capture fixes
- Accepts stable interim speech when Chrome/Android fails to emit a final result.
- Uses up to three recognition alternatives and selects the highest-confidence transcript.
- Prevents stale recognition callbacks from restarting or completing a newer attempt.
- Avoids overlapping recognition instances.
- Automatically restarts recoverable no-speech, audio-capture, and network failures within the same 7-second window.
- Listen Again starts a completely fresh 7-second session.
- Clearer permission and typed-answer fallback messages.

## Budget scoring change
A stated budget below AED 100,000 for a purchase is now **neutral**, not negative.
It remains relevant, but the next step should clarify whether the amount is:
- total purchase budget,
- down payment/deposit,
- annual rental budget,
- or a speech-recognition misunderstanding.

A genuinely negative budget answer still includes phrases such as:
- no money,
- cannot afford it,
- no funds,
- not buying anymore.
