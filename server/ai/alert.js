import Groq from "groq-sdk";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const ALERT_THRESHOLD = 8; // point drop that triggers an alert

export async function generateAlert(storeName, previous, current) {
  const drop = previous.score - current.score;
  if (drop < ALERT_THRESHOLD) return null;

  const weakest = [...current.factors].sort(
    (a, b) => a.points / a.maxPoints - b.points / b.maxPoints
  )[0];

  const msg = await client.chat.completions.create({
    model: "openai/gpt-oss-120b",
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: `Write a 2-sentence credit risk alert for a loan officer. Be specific to these numbers.

Store: ${storeName}
Score dropped: ${previous.score} (${previous.recommendation}) → ${current.score} (${current.recommendation}), a ${drop}-point fall.
Weakest factor now: ${weakest.label} — ${weakest.detail}

Write only the alert text. No headers, no bullet points.`,
      },
    ],
  });

  return msg.choices[0].message.content.trim();
}