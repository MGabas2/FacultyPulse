// ============================================================
//  FacultyPulse — AI Comment Summarization (Vercel Serverless)
//  CommonJS format — works with Vercel's default Node.js runtime.
//
//  Setup:
//    Vercel Dashboard → Settings → Environment Variables:
//      Name:  GROQ_KEY
//      Value: your full Groq API key
// ============================================================

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) {
    return res.status(500).json({
      error: "GROQ_KEY not set. Go to Vercel Dashboard → Settings → Environment Variables and add it."
    });
  }

  const { comments, instruction } = req.body || {};

  if (!comments || !Array.isArray(comments) || comments.length === 0) {
    return res.status(400).json({ error: "No comments provided." });
  }

  const systemPrompt =
    "You are helping a Quality Assurance Office of a Philippine Higher Education Institution " +
    "summarize student faculty evaluation comments. Respond ONLY with numbered points " +
    "(1. 2. 3. ...), one per line. No preamble, no closing, no extra text.";

  const userPrompt =
    `${instruction}\n\nStudent Comments:\n` +
    comments.map((c, i) => `${i + 1}. ${c}`).join("\n");

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 1000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
      }),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      return res.status(groqRes.status).json({
        error: data?.error?.message || "Groq API error"
      });
    }

    const summary = data.choices?.[0]?.message?.content || "";
    return res.status(200).json({ summary });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};