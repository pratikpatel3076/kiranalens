# KiranaLens — AI Advisor Context

## What this project is
Fintech cash-flow underwriting tool for kirana (small Indian grocery) stores.
Submitted to Razorpay AI Buildathon under the AI Risk Manager track.
Solo submission by Pratik Patel.

## Stack
- server/: Node.js + Express + Mongoose (ESM, "type": "module")
- client/: Single index.html, CDN React 18, no build step
- DB: MongoDB via Mongoose
- AI: Groq API (openai/gpt-oss-120b) for LLM narrative + alerts
- ML: In-process logistic regression (ml-logistic-regression) trained at boot on synthetic data

## Key files
- server/index.js         — Express app, all routes, MongoDB connect, model training at boot
- server/scoring.js       — Rule-based 5-factor scoring (exports computeFeatures, scoreStore, recommendationFor)
- server/ml/model.js      — Logistic regression scoring path (exports trainModel, scoreWithModel)
- server/dataGenerator.js — Synthetic store data generator
- server/models/Store.js  — Mongoose schema for store + transactions
- server/models/StoreScore.js — Mongoose schema for cached scores + history + latestAlert
- server/ai/narrative.js  — Groq streaming SSE narrative (streamNarrative, buildPrompt)
- server/ai/alert.js      — Groq alert generation when score drops 8+ points (generateAlert)
- server/normalizers/     — CSV/JSON/GPay PDF upload normalizers
- client/index.html       — Full React dashboard (583 lines), tabs: Dashboard / Pitch Summary / AI Analysis

## API routes
GET  /api/stores                    — list all stores
POST /api/stores/generate           — generate synthetic store
POST /api/stores/upload             — upload CSV/JSON/PDF export
GET  /api/stores/:id                — raw store data
GET  /api/stores/:id/score          — dual score (rule-based + ML), triggers alert if score dropped 8+ pts
GET  /api/stores/:id/narrative      — SSE stream: AI credit narrative (Groq)

## Environment variables needed
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/kiranalens
GROQ_API_KEY=<real key>

## Score response shape
{
  storeId, storeName, avgDailySales, avgMonthlyRevenue,
  ruleBasedScore: { score, recommendation, suggestedLoanRange, factors[] },
  modelScore: { score, recommendation, suggestedLoanRange, factors[], note },
  latestAlert: string | null
}

## Narrative SSE format
data: {"text": "chunk"}   — repeated until done
data: [DONE]              — stream end

## What is complete
- MongoDB storage working
- Dual scoring (rule-based + ML logistic regression) working
- File upload (CSV, JSON, GPay PDF) working
- Score caching with fingerprint invalidation working
- Score history + alert generation on score drop working
- AI narrative SSE endpoint working
- Frontend: Dashboard tab, Pitch Summary tab, AI Analysis tab with streaming display
- Alert banner on Dashboard tab when latestAlert is present

## What still needs doing (if anything)
- Verify end-to-end: npm start → /score → /narrative streams in browser
- Commit and push everything
- Submit repo link to Razorpay buildathon Google Form

## Advisor notes
- Do NOT use set() for deduplication in any new Python code (unrelated exam constraint)
- LLM choice is Groq (free tier) for demo; Anthropic Claude is the production target
- The ML model trains at boot on synthetic data — MODEL_SCORE_NOTE in model.js warns judges it is not validated on real data
- StoreScore.js history[] is capped at 30 entries
- client/index.html uses dangerouslySetInnerHTML for markdown rendering — acceptable for a demo