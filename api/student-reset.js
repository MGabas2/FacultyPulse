// ============================================================
//  FacultyPulse — Student "Forgot password" (server side)
//  Vercel serverless function (CommonJS, same style as the other api/ files)
//
//  Why this exists: the browser used to look up a student's email by ID and
//  then talk to Supabase Auth itself. That meant anyone could harvest student
//  emails. Now the email never leaves the server:
//
//    POST { action: "request", student_id }
//         -> looks up the email, sends the login code, returns only a MASKED hint.
//    POST { action: "confirm", student_id, code, new_password }
//         -> checks the code and sets the new password.
//
//  Needs SUPABASE_SERVICE_ROLE_KEY (already set in Vercel for the other routes).
//  Throttling is stored in public.student_reset_events so it cannot be bypassed
//  by editing the page or calling the API directly.
// ============================================================

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
// Public (publishable) key. Override with the SUPABASE_ANON_KEY env var in Vercel to rotate it
// without editing code; the fallback keeps the API working if the var is not set.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";

const STUDENT_ID_FORMAT = /^\d{4}-\d{4}-[A-Z]{2}$/;
const CODE_FORMAT       = /^\d{4,10}$/;

const REQUEST_COOLDOWN_SEC = 5 * 60;   // one code per student per 5 minutes
const REQUEST_IP_PER_HOUR  = 15;       // code requests per IP per hour
const CONFIRM_FAILS_MAX    = 5;        // wrong codes per student per 15 minutes
const CONFIRM_IP_PER_HOUR  = 30;       // confirm attempts per IP per hour

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return "your email";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 3))}@${domain}`;
}

function clientIpHash(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip  = fwd || (req.socket && req.socket.remoteAddress) || "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function sinceIso(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

async function countEvents(admin, filters) {
  let q = admin.from("student_reset_events").select("id", { count: "exact", head: true });
  for (const [col, op, val] of filters) q = q[op](col, val);
  const { count, error } = await q;
  if (error) throw new Error("throttle lookup failed: " + error.message);
  return count || 0;
}

async function logEvent(admin, studentId, ipHash, kind) {
  await admin.from("student_reset_events").insert({ student_id: studentId, ip_hash: ipHash, kind });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "server_not_configured" });
  }

  const body       = req.body || {};
  const action     = body.action;
  const studentId  = String(body.student_id || "").trim().toUpperCase();
  if (!STUDENT_ID_FORMAT.test(studentId)) return res.status(400).json({ error: "bad_student_id" });

  const admin  = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon   = createClient(SUPABASE_URL, SUPABASE_ANON_KEY,                      { auth: { persistSession: false, autoRefreshToken: false } });
  const ipHash = clientIpHash(req);

  try {
    // ───────────── request a code ─────────────
    if (action === "request") {
      // Tidy old throttle rows now and then (keeps the table tiny).
      if (Math.random() < 0.05) {
        await admin.from("student_reset_events").delete().lt("created_at", sinceIso(2 * 24 * 3600));
      }

      const recent = await countEvents(admin, [
        ["student_id", "eq", studentId], ["kind", "eq", "request"], ["created_at", "gte", sinceIso(REQUEST_COOLDOWN_SEC)],
      ]);
      if (recent > 0) {
        // Work out how long is left from the newest request.
        const { data: last } = await admin.from("student_reset_events").select("created_at")
          .eq("student_id", studentId).eq("kind", "request").order("created_at", { ascending: false }).limit(1);
        const elapsed = last && last[0] ? (Date.now() - new Date(last[0].created_at).getTime()) / 1000 : 0;
        return res.status(429).json({ error: "throttled", retryAfterSec: Math.max(1, Math.ceil(REQUEST_COOLDOWN_SEC - elapsed)) });
      }
      const ipCount = await countEvents(admin, [
        ["ip_hash", "eq", ipHash], ["kind", "eq", "request"], ["created_at", "gte", sinceIso(3600)],
      ]);
      if (ipCount >= REQUEST_IP_PER_HOUR) return res.status(429).json({ error: "too_many", retryAfterSec: 600 });

      await logEvent(admin, studentId, ipHash, "request");

      const { data: user, error: lookupErr } = await admin.from("users")
        .select("email").eq("student_id", studentId).eq("role", "student").neq("is_active", false).maybeSingle();
      if (lookupErr) return res.status(500).json({ error: "lookup_failed" });

      const email = user && user.email ? String(user.email).trim() : "";
      if (!email) return res.status(200).json({ ok: false, reason: "no_email" });

      const { error: otpErr } = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (otpErr) return res.status(502).json({ error: "send_failed" });

      return res.status(200).json({ ok: true, hint: maskEmail(email), cooldownSec: REQUEST_COOLDOWN_SEC });
    }

    // ───────────── confirm code + set new password ─────────────
    if (action === "confirm") {
      const code        = String(body.code || "").trim();
      const newPassword = String(body.new_password || "");
      if (!CODE_FORMAT.test(code))                              return res.status(400).json({ error: "bad_code_format" });
      if (newPassword.length < 4 || newPassword.length > 128)   return res.status(400).json({ error: "bad_password" });
      if (newPassword === studentId.split("-")[1])              return res.status(400).json({ error: "default_password" });

      const fails = await countEvents(admin, [
        ["student_id", "eq", studentId], ["kind", "eq", "confirm_fail"], ["created_at", "gte", sinceIso(15 * 60)],
      ]);
      if (fails >= CONFIRM_FAILS_MAX) return res.status(429).json({ error: "too_many", retryAfterSec: 15 * 60 });
      const ipCount = await countEvents(admin, [
        ["ip_hash", "eq", ipHash], ["kind", "in", ["confirm_fail", "confirm_ok"]], ["created_at", "gte", sinceIso(3600)],
      ]);
      if (ipCount >= CONFIRM_IP_PER_HOUR) return res.status(429).json({ error: "too_many", retryAfterSec: 600 });

      const { data: user } = await admin.from("users")
        .select("email").eq("student_id", studentId).eq("role", "student").neq("is_active", false).maybeSingle();
      const email = user && user.email ? String(user.email).trim() : "";
      if (!email) { await logEvent(admin, studentId, ipHash, "confirm_fail"); return res.status(400).json({ error: "bad_code" }); }

      const { error: verifyErr } = await anon.auth.verifyOtp({ email, token: code, type: "email" });
      if (verifyErr) {
        await logEvent(admin, studentId, ipHash, "confirm_fail");
        return res.status(400).json({ error: "bad_code" });
      }

      const { data: ok, error: rpcErr } = await admin.rpc("fp_server_reset_student_password", {
        p_student_id: studentId, p_new_password: newPassword,
      });
      if (rpcErr || !ok) return res.status(400).json({ error: "reset_failed", message: rpcErr ? rpcErr.message : undefined });

      await logEvent(admin, studentId, ipHash, "confirm_ok");
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("student-reset error:", e && e.message);
    return res.status(500).json({ error: "server_error" });
  }
};
