// ============================================================
//  FacultyPulse — Vite build config (multi-page, no framework)
//  Every HTML page is its own entry; Vite bundles + minifies the
//  JS/CSS, hashes the filenames (so browsers can cache them for a
//  year), and bundles @supabase/supabase-js from npm instead of
//  fetching it from a CDN at runtime.
//  NOTE: package.json deliberately has NO "type":"module" — the
//  Vercel functions in /api are CommonJS and would break.
// ============================================================
import { defineConfig } from "vite";
import { resolve } from "node:path";

const page = (p) => resolve(import.meta.dirname, p);

export default defineConfig({
  // public/ is copied to the build output untouched (vendor libs that are
  // loaded with a <script> tag or on demand live in public/js/vendor).
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      input: {
        index:             page("index.html"),
        student:           page("pages/student.html"),
        teacher:           page("pages/teacher.html"),
        supervisor:        page("pages/supervisor.html"),
        executive:         page("pages/executive.html"),
        admin:             page("pages/admin.html"),
        "admin-users":      page("pages/admin-users.html"),
        "admin-monitoring": page("pages/admin-monitoring.html"),
      },
    },
  },
});
