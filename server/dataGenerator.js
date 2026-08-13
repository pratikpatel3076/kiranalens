// dataGenerator.js
// Generates synthetic 6-12 month daily transaction data for a kirana store.
// Mixes UPI + cash, seasonal variance, and occasional bad-patch dips to
// simulate realistic informal-retail cash flow.

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function seasonalMultiplier(dayIndex) {
  // Simulate festive spikes (~every 90 days) and a mild weekly cycle.
  const festiveBoost = 1 + 0.6 * Math.exp(-(((dayIndex % 90) - 45) ** 2) / 200);
  const weekday = dayIndex % 7;
  const weeklyBoost = weekday === 0 || weekday === 6 ? 1.25 : 1.0; // weekends busier
  return festiveBoost * weeklyBoost;
}

export function generateStoreData({
  storeId = "STORE-" + Math.floor(Math.random() * 100000),
  storeName = "Sri Lakshmi Kirana Store",
  days = 270, // ~9 months
  baseDailySales = 3500, // INR
  upiAdoption = 0.55, // fraction of sales via UPI vs cash
  volatility = 0.25, // day-to-day noise
  badPatchProbability = 0.06, // chance any given day is a "bad" low-sales day
} = {}) {
  const transactions = [];
  const today = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dayIndex = days - i;

    let dailySales = baseDailySales * seasonalMultiplier(dayIndex);
    dailySales *= 1 + randRange(-volatility, volatility);

    // Occasional bad patch (illness, supply issue, local disruption)
    if (Math.random() < badPatchProbability) {
      dailySales *= randRange(0.15, 0.45);
    }

    dailySales = Math.max(300, Math.round(dailySales));

    const upiShare = Math.min(0.95, Math.max(0.1, upiAdoption + randRange(-0.1, 0.1)));
    const upiAmount = Math.round(dailySales * upiShare);
    const cashAmount = dailySales - upiAmount;

    const upiTxnCount = Math.max(1, Math.round(upiAmount / randRange(80, 220)));
    const cashTxnCount = Math.max(1, Math.round(cashAmount / randRange(60, 180)));

    transactions.push({
      date: date.toISOString().slice(0, 10),
      upiAmount,
      cashAmount,
      totalAmount: upiAmount + cashAmount,
      upiTxnCount,
      cashTxnCount,
    });
  }

  // Simple inventory turnover proxy: restock events roughly every 5-9 days
  const restocks = [];
  for (let i = days; i >= 0; ) {
    restocks.push({
      date: new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10),
      restockValue: Math.round(randRange(8000, 22000)),
    });
    i -= Math.round(randRange(5, 9));
  }

  return {
    storeId,
    storeName,
    generatedAt: new Date().toISOString(),
    transactions,
    restocks,
  };
}
