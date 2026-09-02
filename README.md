# KiranaLens

> **Razorpay AI Buildathon — AI Risk Manager track**

AI-powered cash-flow credit underwriting for kirana (small Indian retail) stores.
Scores lending risk from UPI + cash transaction patterns instead of formal credit history,
generates streaming AI narratives for lenders and store owners via Groq, and alerts
when a store's financial health degrades — no formal credit history required.

![AI narrative streaming live](docs/demo.png)

## What it does

- Ingests 6–12 months of daily transaction data (synthetic generator, CSV, JSON, or Google Pay PDF export)
- Runs two independent scoring paths: explainable rule-based engine + logistic regression ML model trained at boot
- Streams an AI credit narrative via Groq (openai/gpt-oss-120b): lender brief, plain-language merchant explanation, and 3 specific improvement actions
- Automatically generates alerts when a store's score drops 8+ points between evaluations
- Persists all scores, history, and alerts in MongoDB with fingerprint-based cache invalidation

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express (ESM), Mongoose + MongoDB |
| ML | In-process logistic regression trained on synthetic stores at boot |
| AI | Groq API — openai/gpt-oss-120b — streaming SSE |
| Frontend | Single-file React dashboard (CDN, no build step) |
| Infra | Docker Compose (Express + mongo:7) |

## Run it

### Docker (recommended)

```bash
# Windows PowerShell
$env:GROQ_API_KEY="your_groq_key_here"
docker-compose up --build

# Mac/Linux
GROQ_API_KEY=your_groq_key_here docker-compose up --build
```

Then open `client/index.html` in a browser. Three stores are seeded automatically on first boot.

### Local dev (without Docker)

```bash
cd server
cp .env.example .env    # add your GROQ_API_KEY and set MONGO_URI to localhost
npm install
npm start               # http://localhost:4000
```

Then open `client/index.html` directly in a browser.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/stores` | List all stores |
| POST | `/api/stores/generate` | Generate a synthetic store |
| POST | `/api/stores/upload` | Upload a real export (CSV, JSON, GPay PDF ≤10 MB) |
| GET | `/api/stores/:id` | Raw transaction data |
| GET | `/api/stores/:id/score` | Dual score — rule-based + ML model |
| GET | `/api/stores/:id/narrative` | SSE stream — AI credit narrative via Groq |

### Upload formats supported

- KiranaLens canonical daily-aggregate CSV (`date,upiAmount,cashAmount,upiTxnCount,cashTxnCount`)
- Same schema as JSON
- Google Pay "Get Statement" PDF — direction parsed from statement text ("Received from" vs "Paid to"); only inbound rows count as revenue. Bank names, account digits and UPI IDs are never stored or logged.

### Score response shape

```json
{
  "ruleBasedScore": { "score": 74, "recommendation": "APPROVE", "suggestedLoanRange": [64000, 192000], "factors": [] },
  "modelScore":     { "score": 100, "recommendation": "APPROVE", "suggestedLoanRange": [64000, 192000], "factors": [] },
  "avgDailySales": 4268,
  "avgMonthlyRevenue": 128039,
  "latestAlert": null
}
```

### Narrative SSE format

```
data: {"text": "chunk"}   ← repeated
data: [DONE]              ← stream end
```

## Scoring — two independent paths, same output shape

### Rule-based (explainable baseline)

Five hand-tuned factors, 0–100 total:

| Factor | Range | Signal |
|---|---|---|
| Revenue stability | 0–30 | Lower day-to-day volatility scores higher |
| Sales trend | −10 to +20 | Growing vs shrinking revenue over time |
| Digital payment adoption | 0–20 | UPI share — verifiable and traceable |
| Resilience to disruptions | 0–20 | Frequency of severe low-sales days |
| Inventory/restock consistency | 0–10 | Regularity of restock intervals |

Every factor score is answerable in one sentence — designed for explainability in a judge/underwriter context.

### Model-based (learned pattern)

Logistic regression trained at server boot on ~500 synthetic stores, labeled by the generator's latent parameters (volatility, bad-patch probability, UPI adoption, revenue scale) — independent of the rule engine, so the two scores can legitimately disagree.

Per-feature weights are projected onto the same five factor labels so both breakdowns render identically in the dashboard.

> This model has not been validated against real transaction data. Treat its output as experimental.

### Decision bands (both paths)

**≥ 70** → APPROVE · **45–69** → REVIEW · **< 45** → REJECT

Suggested loan range is sized off estimated monthly revenue.

## Structure

```
kiranalens/
  server/
    models/
      Store.js          Mongoose schema — store profile, transactions[], restocks[]
      StoreScore.js     Mongoose schema — cached scores, history[], latestAlert
    dataGenerator.js    Synthetic daily UPI+cash transactions with seasonal/weekly patterns
    scoring.js          Rule-based scoring (exports computeFeatures for ML reuse)
    ml/
      model.js          Logistic regression — trained at boot, independent of rule engine
    ai/
      narrative.js      Groq streaming SSE narrative (buildPrompt, streamNarrative)
      alert.js          Groq alert generation when score drops 8+ points
    normalizers/
      index.js          CSV/JSON upload router — header detection + daily aggregation
      gpay.js           Google Pay PDF parser (pdfjs-dist, geometric table reconstruction)
    index.js            Express API — all routes, MongoDB connect, ML training at boot
  client/
    index.html          React dashboard — Dashboard / Pitch Summary / AI Analysis tabs
  docker-compose.yml    Express + mongo:7, GROQ_API_KEY wired from host environment
  .env.example          Environment variable template
```