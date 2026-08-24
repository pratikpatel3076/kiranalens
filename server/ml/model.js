// ml/model.js
// Second scoring path: an in-process logistic regression (ml.js) trained at
// boot on synthetic KiranaLens stores from dataGenerator.js.
//
// Ground truth comes from the generator's latent parameters (volatility,
// bad-patch probability, UPI adoption, revenue scale) — NOT from the rule
// engine — so this is a genuinely independent second opinion that can
// disagree with the rule-based score.
//
// The model itself is a black box to the UI, so its per-feature weights are
// projected onto the same five factor labels/maxPoints as the rule-based
// breakdown as pseudo-factors (points scaled to sum exactly to the score).

import { Matrix } from "ml-matrix";
import mlLogisticRegression from "ml-logistic-regression";
import { generateStoreData } from "../dataGenerator.js";
import { computeFeatures, recommendationFor } from "../scoring.js";

// ml-logistic-regression ships CJS; pull the class off the default interop.
const LogisticRegression = mlLogisticRegression.LogisticRegression ?? mlLogisticRegression;

const FEATURE_NAMES = [
  "Sales volatility",
  "Sales trend",
  "UPI adoption",
  "Bad-patch frequency",
  "Restock regularity",
];

// Same labels/maxPoints as scoring.js so both breakdowns render identically.
const FACTOR_SLOTS = [
  { label: "Revenue stability", featureIndex: 0, maxPoints: 30 },
  { label: "Sales trend", featureIndex: 1, maxPoints: 20 },
  { label: "Digital payment adoption", featureIndex: 2, maxPoints: 20 },
  { label: "Resilience to disruptions", featureIndex: 3, maxPoints: 20 },
  { label: "Inventory/restock consistency", featureIndex: 4, maxPoints: 10 },
];

const TRAINING_DAYS = 240;
const TARGET_PER_CLASS = 250;
const MAX_GENERATION_ATTEMPTS = 20000;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Latent creditworthiness in [0,1] implied by the generator parameters.
function groundTruthQuality(params) {
  const volTerm = 0.35 * (1 - Math.min(1, params.volatility / 0.8));
  const patchTerm = 0.25 * (1 - Math.min(1, params.badPatchProbability / 0.15));
  const upiTerm = 0.25 * clamp(params.upiAdoption, 0, 1);
  const scaleTerm = 0.15 * Math.min(1, params.baseDailySales / 8000);
  return volTerm + patchTerm + upiTerm + scaleTerm;
}

function randomParams() {
  return {
    baseDailySales: 800 + Math.random() * 11200,
    upiAdoption: 0.05 + Math.random() * 0.9,
    volatility: 0.05 + Math.random() * 0.55,
    badPatchProbability: Math.random() * 0.18,
    storeName: "training-store",
    days: TRAINING_DAYS,
  };
}

// Build a labeled dataset: quality >= 0.58 -> creditworthy (1),
// quality <= 0.42 -> risky (0), ambiguous middle dropped so the decision
// boundary trains on clear-cut cases. A held-out slice tracks accuracy.
function buildTrainingSet() {
  const good = [];
  const bad = [];
  let attempts = 0;
  while ((good.length < TARGET_PER_CLASS || bad.length < TARGET_PER_CLASS) && attempts < MAX_GENERATION_ATTEMPTS) {
    attempts++;
    const params = randomParams();
    const q = groundTruthQuality(params);
    if (q > 0.42 && q < 0.58) continue;
    const store = generateStoreData(params);
    const feats = computeFeatures(store);
    const row = { features: feats.featureVector, label: q >= 0.58 ? 1 : 0 };
    if (row.label === 1 && good.length < TARGET_PER_CLASS) good.push(row);
    else if (row.label === 0 && bad.length < TARGET_PER_CLASS) bad.push(row);
  }
  if (good.length < TARGET_PER_CLASS || bad.length < TARGET_PER_CLASS) {
    throw new Error("Failed to generate enough training stores for the ML model");
  }
  // Interleave classes, then hold out every 7th row for validation.
  const all = [];
  for (let i = 0; i < TARGET_PER_CLASS; i++) {
    all.push(good[i], bad[i]);
  }
  const heldOut = all.filter((_, i) => i % 7 === 6);
  const train = all.filter((_, i) => i % 7 !== 6);
  return { train, heldOut };
}

let trained = null;

export const MODEL_SCORE_NOTE =
  "Logistic regression trained in-process on synthetic KiranaLens cash-flow data; factor points are weight-derived approximations, not hand-tuned rules.";

export function trainModel() {
  const { train, heldOut } = buildTrainingSet();

  const Xraw = train.map((r) => r.features);
  const dim = Xraw[0].length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  for (const f of Xraw) for (let j = 0; j < dim; j++) mean[j] += f[j];
  for (let j = 0; j < dim; j++) mean[j] /= Xraw.length;
  for (const f of Xraw) for (let j = 0; j < dim; j++) std[j] += (f[j] - mean[j]) ** 2;
  for (let j = 0; j < dim; j++) std[j] = Math.sqrt(std[j] / Xraw.length) || 1;

  const standardize = (features) => features.map((v, j) => (v - mean[j]) / std[j]);
  const X = new Matrix(train.map((r) => standardize(r.features)));
  const Y = Matrix.columnVector(train.map((r) => r.label));

  const lr = new LogisticRegression({ numSteps: 12000, learningRate: 0.5 });
  lr.train(X, Y);

  if (lr.numberClasses !== 2) {
    throw new Error("ML model training produced unexpected number of classes");
  }

  // classifiers[0] was trained one-vs-all with target 1 == "not class 0",
  // i.e. its testScores() outputs P(creditworthy) directly.
  const weights = lr.classifiers[0].weights.to1DArray();

  let correct = 0;
  for (const row of heldOut) {
    const p = predictProbability(lr, standardize(row.features));
    const predicted = p >= 0.5 ? 1 : 0;
    if (predicted === row.label) correct++;
  }

  trained = { lr, weights, mean, std, standardize };
  return {
    trainingRows: train.length,
    heldOutRows: heldOut.length,
    accuracy: heldOut.length ? correct / heldOut.length : null,
    weights,
    featureNames: FEATURE_NAMES,
  };
}

function predictProbability(lr, standardizedFeatures) {
  return lr.classifiers[0].testScores(Matrix.rowVector(standardizedFeatures))[0];
}

export function assertTrained() {
  if (!trained) throw new Error("ML model not trained yet");
  return trained;
}

// Score a store through the learned model. Output mirrors scoreStore()'s
// shape: { score, recommendation, suggestedLoanRange, factors[], ... } plus
// a `note` flagging that factors are model-derived approximations.
export function scoreWithModel(storeData) {
  const { lr, weights, standardize } = assertTrained();
  const feats = computeFeatures(storeData);
  const z = standardize(feats.featureVector);
  const pGood = predictProbability(lr, z);

  const score = Math.round(clamp(pGood, 0, 1) * 100);
  const { recommendation, suggestedLoanRange } = recommendationFor(score, feats.avgDailySales);

  // Per-feature signed contributions (weight x standardized value) mapped
  // into each factor slot, then rescaled so points sum exactly to `score`.
  const contributions = FACTOR_SLOTS.map((slot) => {
    const d = weights[slot.featureIndex] * z[slot.featureIndex];
    return { slot, d, raw: slot.maxPoints / (1 + Math.exp(-d)) };
  });
  const rawSum = contributions.reduce((s, c) => s + c.raw, 0) || 1;
  const scale = score / rawSum;

  const factors = contributions.map(({ slot, d, raw }) => ({
    label: slot.label,
    detail: `Learned sensitivity ${weights[slot.featureIndex] >= 0 ? "+" : ""}${weights[
      slot.featureIndex
    ].toFixed(2)} × standardized ${FEATURE_NAMES[slot.featureIndex]} (${z[slot.featureIndex] >= 0 ? "+" : ""}${z[
      slot.featureIndex
    ].toFixed(2)}) — ${d >= 0 ? "pushed" : "pulled"} the model score ${d >= 0 ? "up" : "down"}`,
    points: Math.round(raw * scale),
    maxPoints: slot.maxPoints,
  }));

  // Clamp to bounds, then absorb rounding/clamp drift into whichever factor
  // has slack so the displayed points still sum to the headline score.
  for (const f of factors) f.points = clamp(f.points, 0, f.maxPoints);
  let drift = score - factors.reduce((s, f) => s + f.points, 0);
  while (drift !== 0) {
    const movable = factors.find((f) =>
      drift > 0 ? f.points < f.maxPoints : f.points > 0
    );
    if (!movable) break;
    movable.points += drift > 0 ? 1 : -1;
    drift += drift > 0 ? -1 : 1;
  }

  return {
    score,
    recommendation,
    suggestedLoanRange,
    avgDailySales: Math.round(feats.avgDailySales),
    avgMonthlyRevenue: Math.round(feats.avgDailySales * 30),
    factors,
    note: MODEL_SCORE_NOTE,
  };
}
