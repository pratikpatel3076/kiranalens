# KiranaLens

Fintech cash-flow underwriting tool for kirana (small Indian retail) stores.
Estimates lending risk from transaction patterns instead of formal credit
history, and explains the score factor-by-factor.

## Structure

```
kiranalens/
  server/
    models/
      Store.js          Mongoose schema — store profile, transactions[], restocks[]
                         (subdocuments have _id suppressed)
      StoreScore.js     Mongoose schema — cached score output, factors[], fingerprint
                         (subdocuments have _id suppressed; top-level _id stripped from responses)
    dataGenerator.js    Synthetic daily UPI+cash transactions, seasonal/weekly patterns
    scoring.js          Explainable scoring: stability, trend, UPI adoption, resilience, restock consistency
    index.js            REST API — persists to MongoDB via Mongoose, score caching with fingerprint + TTL
  client/
    index.html          React dashboard (CDN React, no build step) — sales chart, score
                         breakdown, pitch-summary tab for judge presentations
  docker-compose.yml    Starts Express server + mongo:7 container, wires MONGO_URI automatically
  .env.example          Template for local dev environment variables
```

## Run it

### Docker (recommended)

```bash
docker-compose up --build
```

Starts both the Express API (`http://localhost:4000`) and a `mongo:7`
container. `MONGO_URI` is wired automatically. Mongo data persists in the
named `mongo-data` volume. No manual DB setup required.

### Local dev (without Docker)

```bash
cp .env.example .env        # fill in MONGO_URI and PORT
cd server
npm install
npm start                   # http://localhost:4000
```

Then open `client/index.html` directly in a browser.

`server/index.js` loads `.env` via `dotenv`, so `PORT` and `MONGO_URI` from
`.env` apply when running outside Docker. Without a `.env`, defaults are
`PORT=4000` and `mongodb://127.0.0.1:27017/kiranalens`.

On first boot with an empty database, the server seeds three preset stores
automatically.

## API

- `GET  /api/stores` — list stores
- `POST /api/stores/generate` — generate a new synthetic store
  (body: `storeName`, `baseDailySales`, `upiAdoption`, `volatility`, `badPatchProbability`)
- `GET  /api/stores/:id` — raw transaction data
- `GET  /api/stores/:id/score` — risk score + factor breakdown + lending recommendation

## Data layer

Two MongoDB collections managed via Mongoose:

- **`stores`** — store profiles with daily transaction arrays
  (`upiAmount`, `cashAmount`, `totalAmount`, `upiTxnCount`, `cashTxnCount`)
  and restock events. Modeled in `server/models/Store.js`.
- **`storescores`** — cached scoring output keyed by `storeId`. Modeled in
  `server/models/StoreScore.js`. Scores are computed by `scoring.js` on first
  access and reused so the rule engine doesn't rerun on every
  `GET /api/stores/:id/score`.

Cache invalidation triggers when either condition is met:

1. The store's transactions/restocks changed — detected via `dataFingerprint`
   stored with each cached score.
2. The cached score is older than 1 hour (TTL).

## Scoring model (rule-based, explainable)

Five factors, 0–100 total:

| Factor | Range | Signal |
|---|---|---|
| Revenue stability | 0–30 | Lower day-to-day volatility scores higher |
| Sales trend | −10 to +20 | Growing vs shrinking revenue over time |
| Digital payment adoption | 0–20 | UPI share — verifiable and traceable |
| Resilience to disruptions | 0–20 | Frequency of severe low-sales days |
| Inventory/restock consistency | 0–10 | Regularity of restock intervals |

**Score ≥ 70** → APPROVE · **45–69** → REVIEW · **< 45** → REJECT

Suggested loan range is sized off estimated monthly revenue.

Intentionally rule-based rather than a black-box ML model — every factor
score is answerable in one sentence. To swap in a trained model later, keep
the `factors[]` output shape so the dashboard doesn't need to change.