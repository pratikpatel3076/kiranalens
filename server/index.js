import express from "express";
import cors from "cors";
import { generateStoreData } from "./dataGenerator.js";
import { scoreStore } from "./scoring.js";

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store registry (swap for MongoDB/Mongoose in production —
// see README for the schema this maps onto).
const stores = new Map();

function seedDefaultStores() {
  const presets = [
    { storeName: "Sri Lakshmi Kirana Store", baseDailySales: 3500, upiAdoption: 0.55, volatility: 0.22, badPatchProbability: 0.05 },
    { storeName: "New Ganesh General Stores", baseDailySales: 1800, upiAdoption: 0.3, volatility: 0.4, badPatchProbability: 0.1 },
    { storeName: "Annapurna Provision Mart", baseDailySales: 6200, upiAdoption: 0.7, volatility: 0.15, badPatchProbability: 0.03 },
  ];
  presets.forEach((p) => {
    const data = generateStoreData(p);
    stores.set(data.storeId, data);
  });
}
seedDefaultStores();

app.get("/api/stores", (req, res) => {
  const list = Array.from(stores.values()).map((s) => ({
    storeId: s.storeId,
    storeName: s.storeName,
  }));
  res.json(list);
});

app.post("/api/stores/generate", (req, res) => {
  const data = generateStoreData(req.body || {});
  stores.set(data.storeId, data);
  res.json({ storeId: data.storeId, storeName: data.storeName });
});

app.get("/api/stores/:id", (req, res) => {
  const data = stores.get(req.params.id);
  if (!data) return res.status(404).json({ error: "Store not found" });
  res.json(data);
});

app.get("/api/stores/:id/score", (req, res) => {
  const data = stores.get(req.params.id);
  if (!data) return res.status(404).json({ error: "Store not found" });
  const result = scoreStore(data);
  res.json(result);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`KiranaLens API running on http://localhost:${PORT}`);
});
