import Groq from "groq-sdk";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

export function buildPrompt(storeName, scoreData) {
  const { ruleBasedScore, modelScore, avgDailySales, avgMonthlyRevenue } = scoreData;
  const fmt = (n) => Number(n).toLocaleString("en-IN");

  return `You are a credit analyst for KiranaLens, a fintech platform that underwrites kirana (small Indian grocery) stores using cash-flow data instead of formal credit history.

STORE: ${storeName}
Avg daily sales: ₹${fmt(avgDailySales)} | Avg monthly revenue: ₹${fmt(avgMonthlyRevenue)}

SCORES
Rule-based: ${ruleBasedScore.score}/100 → ${ruleBasedScore.recommendation}
ML model:   ${modelScore.score}/100   → ${modelScore.recommendation}
Loan range: ₹${fmt(ruleBasedScore.suggestedLoanRange[0])} – ₹${fmt(ruleBasedScore.suggestedLoanRange[1])}

FACTOR BREAKDOWN
${ruleBasedScore.factors.map((f) => `• ${f.label}: ${f.points}/${f.maxPoints} pts — ${f.detail}`).join("\n")}

Write exactly three sections with these exact headers:

## LENDER BRIEF
2-3 sentences for the credit officer. Reference actual rupee figures. State the recommendation and loan sizing rationale clearly.

## FOR THE STORE OWNER
2-3 sentences in plain language spoken directly to the owner. No jargon. What does this score mean for their loan application?

## 3 ACTIONS TO IMPROVE YOUR SCORE
1. [Specific action targeting their lowest-scoring factor — name the expected point gain]
2. [Second specific action]
3. [Third specific action]

Be specific to this store's actual numbers. Do not give generic advice.`;
}

export async function streamNarrative(storeName, scoreData, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = await client.chat.completions.create({
      model: "openai/gpt-oss-120b",
      max_tokens: 1000,
      messages: [{ role: "user", content: buildPrompt(storeName, scoreData) }],
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.write("data: [DONE]\n\n");
  res.end();
}