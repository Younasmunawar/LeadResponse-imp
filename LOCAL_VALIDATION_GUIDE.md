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


## v20 expanded local directory

The local validator now includes broader phrase libraries for:

- permission, cautious consent, refusal, busy and do-not-contact responses;
- purchase, leasing and undecided intent;
- personal, family, business and investment purposes;
- Abu Dhabi location aliases and residential/commercial property types;
- numeric, ranged and spoken-word budgets;
- near-term, medium-term, long-term and cancelled timelines;
- cash, mortgage, finance, installments and mixed funding;
- WhatsApp confirmation, alternate numbers and alternate contact channels;
- follow-up days, dayparts, exact times and no-contact requests;
- repeat-question phrases and clearly unrelated answers.

The validator also receives existing call context. For example, a budget can be interpreted differently for a purchase lead and a leasing lead.
