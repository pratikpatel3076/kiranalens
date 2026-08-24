// scoring.js
// Explainable rule-based credit risk scoring for kirana stores.
// Every factor contributes a labeled point delta so the dashboard/pitch
// screen can show "why this score" — a judge/underwriter requirement.

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
}

function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

function linearTrendSlope(values) {
  // Simple least-squares slope over index vs value, normalized by mean.
  const n = values.length;
  const xs = values.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return yMean === 0 ? 0 : slope / yMean; // normalized trend
}

// Shared signal extraction used by BOTH scoring paths: the rule engine
// below and the trained model in ml/model.js consume the same five signals
// so their outputs stay comparable factor-by-factor.
// Returns the raw metrics plus a featureVector ordered:
// [volatility, trend, avgUpiShare, badPatchRate, restockRegularity]
export function computeFeatures(storeData) {
  const { transactions, restocks } = storeData;
  const totals = transactions.map((t) => t.totalAmount);
  const upiShares = transactions.map((t) =>
    t.totalAmount === 0 ? 0 : t.upiAmount / t.totalAmount
  );

  const avgDailySales = mean(totals);
  const volatility = stdDev(totals) / (avgDailySales || 1); // coefficient of variation
  const trend = linearTrendSlope(totals); // >0 growing, <0 shrinking
  const avgUpiShare = mean(upiShares);

  // Bad-patch frequency: days where sales dropped below 40% of trailing avg
  let badPatchDays = 0;
  for (let i = 10; i < totals.length; i++) {
    const trailingAvg = mean(totals.slice(Math.max(0, i - 10), i));
    if (totals[i] < 0.4 * trailingAvg) badPatchDays++;
  }
  const badPatchRate = badPatchDays / totals.length;

  // Inventory/restock consistency: lower variance in restock gaps = more stable operations
  const restockDates = restocks.map((r) => new Date(r.date).getTime());
  const gaps = [];
  for (let i = 1; i < restockDates.length; i++) {
    gaps.push((restockDates[i] - restockDates[i - 1]) / 86400000);
  }
  const restockRegularity = gaps.length ? 1 - Math.min(1, stdDev(gaps) / (mean(gaps) || 1)) : 0.5;

  return {
    avgDailySales,
    dayCount: totals.length,
    volatility,
    trend,
    avgUpiShare,
    badPatchDays,
    badPatchRate,
    restockRegularity,
    featureVector: [volatility, trend, avgUpiShare, badPatchRate, restockRegularity],
  };
}

// Shared decision bands so both paths label stores identically.
export function recommendationFor(score, avgDailySales) {
  const monthlyRevenue = avgDailySales * 30;
  if (score >= 70) {
    return {
      recommendation: "APPROVE",
      suggestedLoanRange: [Math.round(monthlyRevenue * 1.5), Math.round(monthlyRevenue * 3)],
    };
  } else if (score >= 45) {
    return {
      recommendation: "REVIEW",
      suggestedLoanRange: [Math.round(monthlyRevenue * 0.5), Math.round(monthlyRevenue * 1.5)],
    };
  }
  return {
    recommendation: "REJECT",
    suggestedLoanRange: [0, Math.round(monthlyRevenue * 0.3)],
  };
}

export function scoreStore(storeData) {
  const feats = computeFeatures(storeData);
  const {
    volatility,
    trend,
    avgUpiShare,
    badPatchDays,
    badPatchRate,
    restockRegularity,
    avgDailySales,
    dayCount,
  } = feats;

  // --- Scoring factors (each explainable, sums to 0-100 base then clamped) ---
  const factors = [];

  // 1. Revenue stability (0-30 pts): lower volatility -> higher score
  const stabilityPts = Math.round(Math.max(0, 30 * (1 - Math.min(1, volatility / 0.8))));
  factors.push({
    label: "Revenue stability",
    detail: `Day-to-day sales volatility (coefficient of variation) is ${volatility.toFixed(2)}`,
    points: stabilityPts,
    maxPoints: 30,
  });

  // 2. Growth trend (0-20 pts, can go negative down to -10)
  const trendPts = Math.round(Math.max(-10, Math.min(20, trend * 400)));
  factors.push({
    label: "Sales trend",
    detail:
      trend >= 0
        ? `Sales trending up (~${(trend * 100).toFixed(1)}% normalized slope)`
        : `Sales trending down (~${(trend * 100).toFixed(1)}% normalized slope)`,
    points: trendPts,
    maxPoints: 20,
  });

  // 3. Digital footprint / UPI adoption (0-20 pts): more traceable revenue = lower info asymmetry
  const upiPts = Math.round(avgUpiShare * 20);
  factors.push({
    label: "Digital payment adoption",
    detail: `${(avgUpiShare * 100).toFixed(0)}% of sales are via UPI (traceable, verifiable)`,
    points: upiPts,
    maxPoints: 20,
  });

  // 4. Resilience / bad-patch frequency (0-20 pts): fewer severe dips = better
  const resiliencePts = Math.round(Math.max(0, 20 * (1 - Math.min(1, badPatchRate / 0.15))));
  factors.push({
    label: "Resilience to disruptions",
    detail: `${badPatchDays} severe low-sales day(s) out of ${dayCount} (${(
      badPatchRate * 100
    ).toFixed(1)}%)`,
    points: resiliencePts,
    maxPoints: 20,
  });

  // 5. Operational consistency / restock regularity (0-10 pts)
  const restockPts = Math.round(Math.max(0, restockRegularity * 10));
  factors.push({
    label: "Inventory/restock consistency",
    detail: `Restock interval regularity score: ${(restockRegularity * 100).toFixed(0)}%`,
    points: restockPts,
    maxPoints: 10,
  });

  const rawScore = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  const { recommendation, suggestedLoanRange } = recommendationFor(score, avgDailySales);
  const monthlyRevenue = avgDailySales * 30;

  return {
    storeId: storeData.storeId,
    storeName: storeData.storeName,
    score,
    recommendation,
    suggestedLoanRange,
    avgDailySales: Math.round(avgDailySales),
    avgMonthlyRevenue: Math.round(monthlyRevenue),
    factors,
  };
}
