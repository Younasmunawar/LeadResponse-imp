# Local validation and Gemini review

The live call checks local patterns first so common answers are accepted immediately. The library covers consent/refusal, purchase or lease, purpose, Abu Dhabi locations and property types, numeric and spoken budgets, near/long-term timelines, cash/finance, WhatsApp consent, alternative contact channels, and follow-up preferences.

Every result carries:

- `relevant`
- `classification`: positive, neutral, negative, or irrelevant
- `confidence`
- `hardNegative`
- normalized answer

Ambiguous results are sent to Gemini validation keys 1–3, each with a 2-second cap. Final transcript review uses finalization keys 1–2.

Gemini is used as a bounded expert reviewer, not ignored: it validates unknown phrasing and can adjust a borderline final quality classification when confidence is at least 80%. Local hard-negative safety rules always win.
