# KiranaLens

Fintech cash-flow underwriting tool for kirana (small Indian retail) stores.
Estimates lending risk from transaction patterns instead of formal credit
history, and explains the score factor-by-factor.

## Structure

```
kiranalens/
  server/           Express API — mock data generator + rule-based scoring engine
    dataGenerator.js  Synthetic daily UPI+cash transactions, seasonal/weekly patterns
    scoring.js         Explainable scoring: stability, trend, UPI adoption, resilience, restock consistency
    index.js           REST API (in-memory store; swap for MongoDB/Mongoose for production)
  client/
    index.html        React dashboard (CDN React, no build step) — sales chart, score
                       breakdown, pitch-summary tab for judge presentations
```

## Run it

```bash
cd server
npm install
npm start          # http://localhost:4000
```

Then open `client/index.html` directly in a browser (double-click it, or
`open client/index.html`). It talks to the API at `http://localhost:4000`.

## API

- `GET  /api/stores` — list stores
- `POST /api/stores/generate` — generate a new synthetic store (body: storeName, baseDailySales, upiAdoption, volatility, badPatchProbability)
- `GET  /api/stores/:id` — raw transaction data
- `GET  /api/stores/:id/score` — risk score + factor breakdown + lending recommendation

## Going to production (MERN → real M)

`server/index.js` uses an in-memory `Map` as the store registry so this runs
with zero external dependencies. To swap in real MongoDB:

1. Define a Mongoose schema mirroring the `generateStoreData` output shape
   (storeId, storeName, transactions[], restocks[]).
2. Replace the `Map` reads/writes in `index.js` with Mongoose queries.
3. Point transaction ingestion at a real UPI/POS data source instead of
   `dataGenerator.js`.

`mongoose` is already in `package.json` for this reason.

## Scoring model (v1, rule-based)

Five explainable factors, 0–100 total:
1. Revenue stability (0–30) — lower day-to-day volatility scores higher
2. Sales trend (−10 to +20) — growing vs shrinking revenue
3. Digital payment adoption (0–20) — UPI share, since it's verifiable/traceable
4. Resilience to disruptions (0–20) — frequency of severe low-sales days
5. Inventory/restock consistency (0–10) — regularity of restock intervals

Score ≥70 → APPROVE, 45–69 → REVIEW, <45 → REJECT, with a suggested loan
range sized off estimated monthly revenue.

This is intentionally rule-based rather than a black-box ML model — for a
pitch/judge context, "why this score" needs to be answerable in one sentence
per factor. If you want to swap in a trained model later, keep the factor
breakdown output shape so the UI doesn't need to change.
