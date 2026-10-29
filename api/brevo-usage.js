// ============================================================
//  FacultyPulse — Brevo email usage (admin only)
//  Vercel serverless function (CommonJS, same style as create-teacher-auth.js)
//
//  Needs these Vercel environment variables:
//    BREVO_API_KEY               a Brevo *API key* (Brevo → SMTP & API → API Keys).
//                                NOT the SMTP key that Supabase uses. Server-side only.
//    SUPABASE_SERVICE_ROLE_KEY   already set for create-teacher-auth
//    BREVO_DAILY_LIMIT           optional, default 300 (the free plan's daily cap)
// ============================================================
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL      = "https://qscvccklksptcvtyzabe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg"; // public key, same as js/supabase.js

let cache = { at: 0, body: null };      // 30 s cache so a refresh-happy admin can't burn Brevo's API quota
const CACHE_MS = 30 * 1000;

async function brevo(path) {
  const r = await fetch("https://api.brevo.com/v3" + path, {
    headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" },
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(json && json.message) || text.slice(0, 120)}`);
  return json;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." });
  }
  if (!process.env.BREVO_API_KEY) {
    return res.status(503).json({ error: "not_configured", message: "BREVO_API_KEY is not set in Vercel → Settings → Environment Variables." });
  }

  // 1) caller must be logged in …
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing Authorization header" });
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: auth, error: authErr } = await anon.auth.getUser(token);
  if (authErr || !auth?.user?.email) return res.status(401).json({ error: "Invalid or expired session" });

  // 2) … and an admin
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: row, error: rowErr } = await admin
    .from("users").select("role").eq("email", auth.user.email.toLowerCase()).maybeSingle();
  if (rowErr) return res.status(500).json({ error: "Could not verify role: " + rowErr.message });
  if (row?.role !== "admin") return res.status(403).json({ error: "Admins only" });

  if (cache.body && Date.now() - cache.at < CACHE_MS) return res.status(200).json(cache.body);

  try {
    // emails sent today ("days=1" = today only, so no timezone guesswork on our side)
    const report = await brevo("/smtp/statistics/aggregatedReport?days=1");
    const sent = Number(report.requests || 0);

    // plan type, best effort (a failure here must not hide the sent count)
    let planType = null;
    try {
      const acc = await brevo("/account");
      const plans = (acc.plan || []).filter(p => p.creditsType === "sendLimit");
      planType = (plans.find(p => p.type === "free") || plans[0] || {}).type || null;
    } catch (_) {}

    const envLimit = parseInt(process.env.BREVO_DAILY_LIMIT, 10);
    const paid = planType === "subscription" || planType === "payAsYouGo";
    const limit = Number.isFinite(envLimit) ? envLimit : (paid ? null : 300);

    const body = {
      sent,
      limit,                                         // null = paid plan, no daily cap
      remaining: limit == null ? null : Math.max(limit - sent, 0),
      planType,
      delivered: Number(report.delivered || 0),
      bounced: Number(report.hardBounces || 0) + Number(report.softBounces || 0) + Number(report.blocked || 0) + Number(report.invalid || 0),
      updatedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), body };
    return res.status(200).json(body);
  } catch (e) {
    return res.status(502).json({ error: "brevo_failed", message: e.message });
  }
};