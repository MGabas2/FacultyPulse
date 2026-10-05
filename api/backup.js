// ============================================================
//  FacultyPulse — System Backup
//  Vercel serverless function (CommonJS, matches api/create-teacher-auth.js)
//
//  Runs ONLY server-side. SUPABASE_SERVICE_ROLE_KEY must be set as a
//  Vercel environment variable and must NEVER appear in any file that
//  ships to the browser. This endpoint exports the ENTIRE database —
//  every student's scores and personal info — so the admin check below
//  is not optional polish, it's the only thing standing between the
//  public anon key and a full data dump. Do not relax it.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
// Same public/anon key already hardcoded in js/supabase.js — fine to be public.
// Only the service_role key below (from process.env) is the secret half.
const SUPABASE_ANON_KEY = "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";

const BUCKET = "backups";

// Tables included in the full data export. "email_change_requests" is
// deliberately left out — that feature was removed from the app; the
// table may still exist but a dead feature doesn't belong in new backups.
const DATA_TABLES = [
  "users",
  "sections",
  "student_subjects",
  "evaluation_scores",
  "evaluation_comments",
  "evaluation_tracking",
  "report_releases",
  "supervisor_remarks",
  "fedaf",
];

// Config-only tables, kept in their own "settings" section of the export
// so a restore of just the setup (semesters/subjects/sections) is easy
// without wading through the full data dump.
const SETTINGS_TABLES = ["semesters", "subjects", "sections"];

async function verifyAdmin(req, adminClient, anonClient) {
  const authHeader  = req.headers.authorization || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return { ok: false, status: 401, error: "Missing Authorization header" };

  const { data: callerAuth, error: callerAuthError } = await anonClient.auth.getUser(callerToken);
  if (callerAuthError || !callerAuth?.user) {
    return { ok: false, status: 401, error: "Invalid or expired session — please log in again" };
  }

  const { data: callerRow, error: callerRowError } = await adminClient
    .from("users")
    .select("role")
    .eq("email", callerAuth.user.email)
    .maybeSingle();

  if (callerRowError) return { ok: false, status: 500, error: "Could not verify caller role: " + callerRowError.message };
  if (callerRow?.role !== "admin") return { ok: false, status: 403, error: "Only admins can run or view backups" };

  return { ok: true };
}

module.exports = async (req, res) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Add it in Vercel → Settings → Environment Variables, then redeploy."
    });
  }

  const anonClient  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const adminClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const authCheck = await verifyAdmin(req, adminClient, anonClient);
  if (!authCheck.ok) return res.status(authCheck.status).json({ error: authCheck.error });

  // ── GET: list previous backups, or get a signed download URL for one ──
  if (req.method === "GET") {
    const { download } = req.query || {};

    if (download) {
      const { data, error } = await adminClient.storage.from(BUCKET).createSignedUrl(download, 60);
      if (error) return res.status(400).json({ error: "Could not create download link: " + error.message });
      return res.status(200).json({ url: data.signedUrl });
    }

    const { data, error } = await adminClient.storage.from(BUCKET).list("", {
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) {
      return res.status(400).json({
        error: "Could not list backups: " + error.message +
          ` — does the "${BUCKET}" bucket exist yet in Supabase Storage?`,
      });
    }
    return res.status(200).json({
      backups: (data || [])
        .filter(f => f.name.endsWith(".json"))
        .map(f => ({ name: f.name, createdAt: f.created_at, sizeBytes: f.metadata?.size || null })),
    });
  }

  // ── POST: run a new backup ──
  if (req.method === "POST") {
    try {
      const [settingsResults, dataResults] = await Promise.all([
        Promise.all(SETTINGS_TABLES.map(t => adminClient.from(t).select("*"))),
        Promise.all(DATA_TABLES.map(t => adminClient.from(t).select("*"))),
      ]);

      const failed = [...settingsResults, ...dataResults]
        .map((r, i) => ({ r, table: [...SETTINGS_TABLES, ...DATA_TABLES][i] }))
        .filter(x => x.r.error);
      if (failed.length > 0) {
        return res.status(500).json({
          error: "Failed to read: " + failed.map(f => `${f.table} (${f.r.error.message})`).join(", "),
        });
      }

      const settings = {};
      SETTINGS_TABLES.forEach((t, i) => { settings[t] = settingsResults[i].data; });

      const data = {};
      DATA_TABLES.forEach((t, i) => { data[t] = dataResults[i].data; });

      const generatedAt = new Date().toISOString();
      const backup = { generated_at: generatedAt, settings, data };
      const fileName = `backup-${generatedAt.replace(/[:.]/g, "-")}.json`;
      const jsonStr = JSON.stringify(backup, null, 2);

      const { error: uploadError } = await adminClient.storage
        .from(BUCKET)
        .upload(fileName, jsonStr, { contentType: "application/json", upsert: false });

      if (uploadError) {
        // Still return the backup so the admin can download it even if
        // Storage isn't configured yet — e.g. the "backups" bucket doesn't exist.
        return res.status(200).json({
          fileName,
          generatedAt,
          sizeBytes: jsonStr.length,
          content: backup,
          storageWarning: `Backup generated but NOT saved to Storage: ${uploadError.message}. ` +
            `Create a private "${BUCKET}" bucket in Supabase → Storage and try again — ` +
            `for now, only the download you get right now exists.`,
        });
      }

      return res.status(200).json({
        fileName,
        generatedAt,
        sizeBytes: jsonStr.length,
        content: backup,
      });
    } catch (err) {
      return res.status(500).json({ error: "Unexpected error: " + err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
