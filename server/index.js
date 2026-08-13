import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { generateStoreData } from "./dataGenerator.js";
import { scoreStore } from "./scoring.js";
import Store from "./models/Store.js";
import StoreScore from "./models/StoreScore.js";

const app = express();
app.use(cors());
app.use(express.json());

const SCORE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/kiranalens";
const PORT = process.env.PORT || 4000;

// Lightweight fingerprint of the data a score depends on, so the cache
// can detect "transactions changed" without deep-comparing full docs.
function transactionFingerprint(store) {
  const txs = store.transactions || [];
  const last = txs.length ? txs[txs.length - 1] : null;
  const total = txs.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
  return `${txs.length}|${last ? last.date : ""}|${total}|${(store.restocks || []).length}`;
}

async function seedDefaultStores() {
  if ((await Store.countDocuments()) > 0) return;
  const presets = [
    { storeName: "Sri Lakshmi Kirana Store", baseDailySales: 3500, upiAdoption: 0.55, volatility: 0.22, badPatchProbability: 0.05 },
    { storeName: "New Ganesh General Stores", baseDailySales: 1800, upiAdoption: 0.3, volatility: 0.4, badPatchProbability: 0.1 },
    { storeName: "Annapurna Provision Mart", baseDailySales: 6200, upiAdoption: 0.7, volatility: 0.15, badPatchProbability: 0.03 },
  ];
  await Store.insertMany(
    presets.map((p) => {
      const data = generateStoreData(p);
      return {
        storeId: data.storeId,
        storeName: data.storeName,
        generatedAt: data.generatedAt,
        transactions: data.transactions,
        restocks: data.restocks,
      };
    })
  );
}

app.get("/api/stores", async (_req, res, next) => {
  try {
    const stores = await Store.find({}, { _id: 0, storeId: 1, storeName: 1 });
    res.json(stores);
  } catch (err) {
    next(err);
  }
});

app.post("/api/stores/generate", async (req, res, next) => {
  try {
    const data = generateStoreData(req.body || {});
    await Store.create({
      storeId: data.storeId,
      storeName: data.storeName,
      generatedAt: data.generatedAt,
      transactions: data.transactions,
      restocks: data.restocks,
    });
    res.json({ storeId: data.storeId, storeName: data.storeName });
  } catch (err) {
    next(err);
  }
});

app.get("/api/stores/:id", async (req, res, next) => {
  try {
    const store = await Store.findOne({ storeId: req.params.id });
    if (!store) return res.status(404).json({ error: "Store not found" });
    res.json(store);
  } catch (err) {
    next(err);
  }
});

app.get("/api/stores/:id/score", async (req, res, next) => {
  try {
    const store = await Store.findOne({ storeId: req.params.id });
    if (!store) return res.status(404).json({ error: "Store not found" });

    const fingerprint = transactionFingerprint(store);
    const cached = await StoreScore.findOne({ storeId: store.storeId });
    const cacheFresh =
      cached &&
      cached.dataFingerprint === fingerprint &&
      Date.now() - new Date(cached.computedAt).getTime() < SCORE_CACHE_TTL_MS;

    if (cacheFresh) {
      return res.json({
        storeId: cached.storeId,
        storeName: store.storeName,
        score: cached.score,
        recommendation: cached.recommendation,
        suggestedLoanRange: cached.suggestedLoanRange,
        avgDailySales: cached.avgDailySales,
        avgMonthlyRevenue: cached.avgMonthlyRevenue,
        factors: cached.factors,
      });
    }

    const result = scoreStore(store.toObject());
    const doc = cached || new StoreScore({ storeId: store.storeId });
    doc.score = result.score;
    doc.recommendation = result.recommendation;
    doc.suggestedLoanRange = result.suggestedLoanRange;
    doc.factors = result.factors;
    doc.avgDailySales = result.avgDailySales;
    doc.avgMonthlyRevenue = result.avgMonthlyRevenue;
    doc.dataFingerprint = fingerprint;
    doc.computedAt = new Date();
    await doc.save();

    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await mongoose.connect(MONGO_URI);
  await seedDefaultStores();
  app.listen(PORT, () => {
    console.log(`KiranaLens API running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start KiranaLens API:", err);
  process.exit(1);
});
