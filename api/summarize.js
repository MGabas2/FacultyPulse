// ============================================================
//  FacultyPulse — AI Comment Summarization (Vercel Serverless)
//  Proxies Groq API so the key stays server-side.
//
//  Setup:
//    1. Put this file at: api/summarize.js (repo root)
//    2. In Vercel Dashboard → Settings → Environment Variables:
//       Name:  GROQ_KEY
//       Value: gsk_3tr5BMoc...  (your full Groq API key)
//    3. Redeploy. That's it.
// ============================================================

export const config = { runtime: "edge" };

export default async function handler(req) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) {
    return new Response(
      JSON.stringify({ error: "GROQ_KEY not configured in Vercel environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const { comments, instruction } = await req.json();

    if (!comments || !Array.isArray(comments) || comments.length === 0) {
      return new Response(
        JSON.stringify({ error: "No comments provided." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt =
      "You are helping a Quality Assurance Office of a Philippine Higher Education Institution " +
      "summarize student faculty evaluation comments. Respond ONLY with numbered points " +
      "(1. 2. 3. ...), one per line. No preamble, no closing, no extra text.";

    const userPrompt =
      `${instruction}\n\nStudent Comments:\n` +
      comments.map((c, i) => `${i + 1}. ${c}`).join("\n");

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await groqResponse.json();

    if (!groqResponse.ok) {
      return new Response(
        JSON.stringify({ error: data?.error?.message || "Groq API error" }),
        { status: groqResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const summary = data.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ summary }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error: " + err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}