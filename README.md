---
title: JurcasAI Freight Intake
emoji: 🚛
colorFrom: indigo
colorTo: blue
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Logistics message analyzer with AI and export
---

# JurcasAI Freight Intake (MVP 0.3)

**Update v0.2:** Separates the latest message from quoted prior email, handles structured multi-stop unloadings, prioritizes total pallets, flags unverified ADR / missing addresses / relative quotation deadlines, and includes operational warnings in export. This is still a rules-based extractor that requires human review.

**Goal:** Turn a free-text transport message into a reviewed, structured JSON / CSV record for later CRM integration.


## MVP 0.3 — Quality Gate

Extraction is a proposal, never a human confirmation. The browser-local review panel tracks each field and unloading point as `extracted`, `confirmed`, `missing`, `conflict`, or `requires_review`. It preserves the existing visual layout and optional local Hugging Face classifier.

- `engine.js`: deterministic extraction plus Quality Gate evaluation, evidence spans, manual confirmations and approval invalidation. No backend or CRM requests.
- `index.js`: review controls and source-change guard; edited source text must be analyzed again before review or export.
- `tests/quality-gate.test.mjs`: gate regressions; the original 13 tests in `tests/engine.test.mjs` are retained unchanged.
- The existing deployment allowlist still contains every runtime file; no extra JavaScript module is required.

### Review and readiness

Use **Potwierdz** for individual values, then **Zatwierdz dane** for the record. CRM readiness currently supports RFQ records only. Every required value, extracted cargo and operational requirements, full loading/delivery address, ADR decision and its review basis must be present and confirmed. Each unloading point has separate order, place, date, pallets and time-window review (required when a window was present in the source). Destination and delivery-date summaries are derived from those points.

Dates require an explicit year. A relative quotation deadline requires an ISO timestamp with timezone. Invalid quantities, inconsistent pallet totals, duplicate stop order and reversed dates block approval. Conflicting explicit source declarations require a written human resolution; arithmetic conflicts must be corrected rather than dismissed. Other natural-language contradictions may remain undetected: this is a rules-based MVP, not a guarantee of transport or regulatory compliance.

Numbered stop declarations use one shared recognizer for extraction and validation: `Delivery`, `Unloading`, `Drop-off`, `Drop off`, `Dropoff`, `Rozładunek`, `Rozladunek`, and `Pristatymas` (case-insensitive). Expected stop counts come from the current source message, including empty headers; deleting a stop or moving its pallets cannot hide that obligation. Empty/placeholder stops, duplicate or missing numbers, and contradictory count declarations block approval until the source is clarified and analyzed again. Source edits clear all confirmations; adding/removing/reordering stops or changing their places clears stop/address confirmations and record approval. Source evidence and required time windows are matched by stop number, not array position.

Regression coverage in `tests/numbered-stops.test.mjs` calls the engine and JSON export directly, without relying on disabled UI buttons. The original 37 tests remain unchanged.

Evidence contains exact text and offsets relative to `active_message`. Quoted historical mail is excluded. Manual values or ambiguous matches have no invented source quotation. Confirmation records have timestamps and optional resolution notes, but no authenticated reviewer identity: this is a local session record, not a signed audit trail. Refreshing the page clears it.

### Test the two-unloading email

1. Run `python -m http.server 8000` in this repository and open `http://localhost:8000`.
2. Select **Stress test** and find **Weryfikacja danych**. Hamburg and Bremen are reviewed independently; ADR remains unresolved and **Zatwierdz dane** is disabled.
3. Check source quotes and the 12 + 6 = 18 pallet total. The email does not provide complete addresses or years for the delivery dates. Obtain these details from a follow-up before using the record operationally.
4. For a synthetic demonstration only, enter delivery dates `2026-10-19` and `2026-10-20`, fictional full addresses, and an explicitly fictional review basis for a selected ADR classification. This example does not establish the actual ADR status of lithium batteries. Set a test quotation deadline such as `2026-10-13T10:00+03:00` only as a fixture; the app does not infer the sender's date or timezone.
5. Confirm each required field (including the optional time windows when present), then click **Zatwierdz dane**. Editing any value invalidates record approval. Changing a route also invalidates the related address confirmation.
6. Export JSON before and after approval. Inspect `verification`, its `entries` and `issues`, `ready_for_crm`, `human_review_required`, and `freight.review_details`. A draft can be exported for review but has `ready_for_crm: false`. CSV includes the same gate state.

The application version is 0.3.0. The additive export retains `schema: jurcasai.freight-intake.v0.2` for compatibility with the existing contract/tests and declares `app_version: 0.3.0` and `verification.version: 0.3`. Original ADR extraction and warnings remain available; the manually verified classification is exported separately. This does not configure Bitrix24 mapping or send anything to CRM.

## Architecture

- `index.html` — UI structure
- `style.css` — UI appearance
- `engine.js` — regular-expression field extraction, rule-based fallback, priority, missing fields, draft, CSV/JSON
- `index.js` — UI events and optional Hugging Face semantic classification in the browser
- `tests/engine.test.mjs` — automated checks for sample messages
- `.github/workflows/validate.yml` — CI checks when pushed to GitHub

### Real AI versus rules

The **optional AI classifier** uses `Xenova/multilingual-e5-small` through Transformers.js to turn a message and labelled examples into embeddings. It compares their cosine similarity and selects the best matching intent when the margin is meaningful. Cosine similarity is **not** calibrated confidence. This is a prototype, not an evaluated classifier.

The **field extractor is currently rule-based**, not generative AI. It recognizes some route phrases, labelled loading, numbered delivery stops, total pallets, weights, dates and equipment. Polish and Lithuanian have partial coverage and Russian is very limited. This does not amount to full contextual AI extraction. Every output requires human review. No data is sent to Bitrix24 or emailed automatically.

## Try it

1. Open the Space app. `Nowy ladunek`, `Opoznienie`, `Po polsku`, `Po litewsku` provide synthetic samples.
2. Click **Analizuj wiadomosc**. It works immediately using local rules.
3. Click **Wlacz model HF** to load multilingual E5 model into the browser. Initial download can take time and requires internet, memory and browser support. The model is downloaded from Hugging Face, and inference runs locally.
4. Correct editable fields, inspect missing information, and export JSON or CSV.

## Safety

**Use fictitious test messages only** until a privacy/security review. A public Space hosts public application code; local inference is not a security certification. No server-side data storage is implemented; the on-screen session log is in memory only and disappears on refresh. The model and JS modules are downloaded from remote third-party hosts. The exported payload includes the original message and must be handled securely.

**No paid Hugging Face Inference Providers or tokens are used by this app.** Browser model downloads may consume significant bandwidth and CPU/RAM. The application is not connected to Bitrix24.

## Run locally (for learning GitHub + Codex)

Python 3 installed:

```sh
python -m http.server 8000
```

Open http://localhost:8000 (serve from this folder). The rule-based analysis works immediately; enabling AI needs internet.

Node 22 installed:

```sh
npm run check
npm test
```

## Deployment to Hugging Face Spaces

Create a new **Static > Blank** Space, then upload the extracted project files (not a ZIP). Keep the README front matter above with `sdk: static` and `app_file: index.html`. No server or build step is required.

## Next steps / business pilot

1. Gather 30-50 **anonymized, permission-cleared** messages across RFQ/status/issues/documents.
2. Assess intent accuracy and field extraction accuracy independently.
3. Add a reviewer approval step and integrate through authenticated server-side API, not client-side Bitrix credentials.
4. Define Bitrix24 Self-Hosted Smart Process field mappings and permissions with IT.

**License:** MIT for the app code. Third-party model and library licensing must be reviewed separately.
