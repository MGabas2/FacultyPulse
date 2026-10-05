// ============================================================
//  FacultyPulse — System Restore (disaster recovery)
//  Vercel serverless function (CommonJS, matches api/backup.js)
//
//  Runs ONLY server-side with SUPABASE_SERVICE_ROLE_KEY. This writes
//  the ENTIRE database back from a backup file. It is deliberately
//  narrow in scope: restore into an EMPTY database only (disaster
//  recovery / migrating to a fresh project). It refuses to run if the
//  target already has data in any of the restored tables — merging a
//  backup into a live database with newer data is a different, much
//  riskier feature that is NOT what this does. Do not add a "force"
//  option reachable from the UI; if that's ever genuinely needed,
//  build it as its own deliberate feature, not a flag on this one.
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qscvccklksptcvtyzabe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_cyj-6CYVmr2MHsj1CDhowQ_O30bZsIg";
const BUCKET = "backups";

// Insert order matters — each table here is restored only after every
// table it has a foreign key into has already been restored:
//   sections, semesters  → no dependencies
//   users                → students reference sections.id
//   subjects             → references sections, semesters, users(teacher_id)
//   student_subjects     → references users, subjects, semesters
//   evaluation_tracking  → references users, subjects, semesters
//   evaluation_scores    → references subjects, semesters (identity-free)
//   evaluation_comments  → references subjects, semesters (identity-free)
//   report_releases, supervisor_remarks, fedaf → reference users(teacher_id), semesters
const RESTORE_ORDER = [
  "semesters",
  "sections",
  "users",
  "subjects",
  "student_subjects",
  "evaluation_tracking",
  "evaluation_scores",
  "evaluation_comments",
  "report_releases",
  "supervisor_remarks",
  "fedaf",
];

const CHUNK_SIZE = 500;

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
  if (callerRow?.role !== "admin") return { ok: false, status: 403, error: "Only admins can run a restore" };

  return { ok: true };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Add it in Vercel → Settings → Environment Variables, then redeploy."
    });
  }

  const anonClient  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const adminClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const authCheck = await verifyAdmin(req, adminClient, anonClient);
  if (!authCheck.ok) return res.status(authCheck.status).json({ error: authCheck.error });

  try {
    const { fileName, content } = req.body || {};
    if (!fileName && !content) {
      return res.status(400).json({ error: "Provide either fileName (a backup already in Storage) or content (an uploaded backup file's JSON)." });
    }

    // ── Load the backup ──
    let backup = content;
    if (!backup) {
      const { data, error } = await adminClient.storage.from(BUCKET).download(fileName);
      if (error) return res.status(400).json({ error: "Could not read backup from Storage: " + error.message });
      const text = await data.text();
      try {
        backup = JSON.parse(text);
      } catch {
        return res.status(400).json({ error: "That Storage file isn't valid JSON." });
      }
    }

    if (!backup || typeof backup !== "object" || !backup.settings || !backup.data) {
      return res.status(400).json({ error: "This doesn't look like a FacultyPulse backup file (missing settings/data)." });
    }

    // Flatten settings + data into one lookup, independent of how the
    // backup grouped them — RESTORE_ORDER is the only thing that decides
    // insert order here.
    const tables = { ...backup.settings, ...backup.data };

    // ── Safety check: refuse unless the target is actually empty ──
    // This is the one thing standing between "disaster recovery" and
    // "accidentally duplicate/clobber a live database." Do not remove it.
    const countChecks = await Promise.all(
      RESTORE_ORDER.map(t => adminClient.from(t).select("*", { count: "exact", head: true }))
    );
    const nonEmpty = RESTORE_ORDER
      .map((t, i) => ({ table: t, count: countChecks[i].count || 0 }))
      .filter(x => x.count > 0);

    if (nonEmpty.length > 0) {
      return res.status(409).json({
        error: "Restore refused: the database already has data in " +
          nonEmpty.map(x => `${x.table} (${x.count} rows)`).join(", ") +
          ". This endpoint only restores into an EMPTY database (disaster recovery / fresh project), " +
          "to avoid duplicating or clobbering live data. If the current data is meant to be wiped first, " +
          "that has to be a deliberate, separate decision — not something this restore does for you.",
      });
    }

    // ── Restore, in dependency order ──
    const restored = {};
    for (const table of RESTORE_ORDER) {
      const rows = tables[table];
      if (!rows || rows.length === 0) { restored[table] = 0; continue; }

      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await adminClient.from(table).insert(chunk);
        if (error) {
          return res.status(500).json({
            error: `Restore stopped while inserting into "${table}" (${inserted}/${rows.length} rows done for this table): ${error.message}`,
            restored, // what succeeded before the failure, for partial-recovery visibility
          });
        }
        inserted += chunk.length;
      }
      restored[table] = inserted;
    }

    return res.status(200).json({ restored, generatedAt: backup.generated_at });
  } catch (err) {
    return res.status(500).json({ error: "Unexpected error: " + err.message });
  }
};
