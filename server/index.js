import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import { generateStoreData } from "./dataGenerator.js";
import { scoreStore } from "./scoring.js";
import { trainModel, scoreWithModel, MODEL_SCORE_NOTE } from "./ml/model.js";
import Store from "./models/Store.js";
import StoreScore from "./models/StoreScore.js";
import { normalizeRows, aggregateDaily, UploadError } from "./normalizers/index.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

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

function parseJsonUpload(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UploadError(400, "Invalid JSON in uploaded file");
  }
  const rows = Array.isArray(parsed) ? parsed : parsed.transactions;
  if (!Array.isArray(rows)) {
    throw new UploadError(400, 'JSON upload must be an array of daily rows or {"transactions": [...]}');
  }
  return aggregateDaily(rows);
}

function parseCsvUpload(text) {
  let records;
  try {
    records = csvParse(text.trim(), { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    throw new UploadError(400, `Could not parse CSV: ${err.message}`);
  }
  if (!records.length) throw new UploadError(400, "CSV file contains no data rows");
  return normalizeRows(Object.keys(records[0]), records);
}

// Accepts a real UPI/POS export (CSV) or pre-normalized daily rows (JSON),
// normalizes it into KiranaLens daily transactions and stores it as a NEW
// store. Vendor formats (PhonePe, GPay) plug into normalizers/.
app.post("/api/stores/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new UploadError(400, 'Multipart file field "file" is required');

    const text = req.file.buffer.toString("utf8");
    const isJson =
      /\.json$/i.test(req.file.originalname) || String(req.file.mimetype || "").includes("json");
    const transactions = isJson ? parseJsonUpload(text) : parseCsvUpload(text);

    const storeId = "UP-" + Math.floor(Math.random() * 100000);
    const fallbackName = req.file.originalname.replace(/\.[^.]+$/, "") || "Uploaded store";
    const storeName = String(req.body.storeName || fallbackName).slice(0, 80);

    await Store.create({
      storeId,
      storeName,
      generatedAt: new Date(),
      transactions,
      restocks: [], // real exports carry no restock events
    });

    res.json({ storeId, storeName, days: transactions.length });
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

function scoreResponse(storeName, cached) {
  return {
    storeId: cached.storeId,
    storeName,
    avgDailySales: cached.avgDailySales,
    avgMonthlyRevenue: cached.avgMonthlyRevenue,
    ruleBasedScore: {
      score: cached.score,
      recommendation: cached.recommendation,
      suggestedLoanRange: cached.suggestedLoanRange,
      factors: cached.factors,
    },
    modelScore: {
      score: cached.model.score,
      recommendation: cached.model.recommendation,
      suggestedLoanRange: cached.model.suggestedLoanRange,
      factors: cached.model.factors,
      note: MODEL_SCORE_NOTE,
    },
  };
}

app.get("/api/stores/:id/score", async (req, res, next) => {
  try {
    const store = await Store.findOne({ storeId: req.params.id });
    if (!store) return res.status(404).json({ error: "Store not found" });

    const fingerprint = transactionFingerprint(store);
    const cached = await StoreScore.findOne({ storeId: store.storeId });
    const cacheFresh =
      cached &&
      cached.model && // pre-dual-score cache entries are treated as stale
      cached.dataFingerprint === fingerprint &&
      Date.now() - new Date(cached.computedAt).getTime() < SCORE_CACHE_TTL_MS;

    if (cacheFresh) {
      return res.json(scoreResponse(store.storeName, cached));
    }

    const result = scoreStore(store.toObject());
    const modelResult = scoreWithModel(store.toObject());

    const doc = cached || new StoreScore({ storeId: store.storeId });
    doc.score = result.score;
    doc.recommendation = result.recommendation;
    doc.suggestedLoanRange = result.suggestedLoanRange;
    doc.factors = result.factors;
    doc.avgDailySales = result.avgDailySales;
    doc.avgMonthlyRevenue = result.avgMonthlyRevenue;
    doc.model = {
      score: modelResult.score,
      recommendation: modelResult.recommendation,
      suggestedLoanRange: modelResult.suggestedLoanRange,
      factors: modelResult.factors,
      computedAt: new Date(),
    };
    doc.dataFingerprint = fingerprint;
    doc.computedAt = new Date();
    await doc.save();

    res.json({
      storeId: store.storeId,
      storeName: store.storeName,
      avgDailySales: result.avgDailySales,
      avgMonthlyRevenue: result.avgMonthlyRevenue,
      ruleBasedScore: {
        score: result.score,
        recommendation: result.recommendation,
        suggestedLoanRange: result.suggestedLoanRange,
        factors: result.factors,
      },
      modelScore: {
        score: modelResult.score,
        recommendation: modelResult.recommendation,
        suggestedLoanRange: modelResult.suggestedLoanRange,
        factors: modelResult.factors,
        note: modelResult.note,
      },
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: `Upload rejected: ${err.message}` });
  }
  if (err instanceof UploadError || err.expose) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await mongoose.connect(MONGO_URI);
  await seedDefaultStores();
  const summary = trainModel();
  console.log(
    `ML score model trained on ${summary.trainingRows} synthetic stores ` +
      `(held-out accuracy ${(summary.accuracy * 100).toFixed(1)}%)`
  );
  app.listen(PORT, () => {
    console.log(`KiranaLens API running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start KiranaLens API:", err);
  process.exit(1);
});
