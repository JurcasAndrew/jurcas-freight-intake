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

# JurcasAI Freight Intake (MVP 0.1)

**Goal:** Turn a free-text transport message into a reviewed, structured JSON / CSV record for later CRM integration.

## Architecture

- `index.html` — UI structure
- `style.css` — UI appearance
- `engine.js` — regular-expression field extraction, rule-based fallback, priority, missing fields, draft, CSV/JSON
- `index.js` — UI events and optional Hugging Face semantic classification in the browser
- `tests/engine.test.mjs` — automated checks for sample messages
- `.github/workflows/validate.yml` — CI checks when pushed to GitHub

### Real AI versus rules

The **optional AI classifier** uses `Xenova/multilingual-e5-small` through Transformers.js to turn a message and labelled examples into embeddings. It compares their cosine similarity and selects the best matching intent when the margin is meaningful. Cosine similarity is **not** calibrated confidence. This is a prototype, not an evaluated classifier.

The **field extractor is currently rule-based**, not generative AI. It recognizes some route phrases, weights, pallets, dates and equipment types in English, Polish and Lithuanian; Russian has partial coverage. Every output requires human review. No data is sent to Bitrix24 or emailed automatically.

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
