# FacultyPulse → Vite: what to do (safe, branch-only)

Nothing here touches `main` until you merge. Do ALL of this on a new branch.

1. Make the branch (in your repo folder):
   git checkout main && git pull
   git checkout -b vite-migration

2. Copy this zip's contents over your repo (same folder structure; say yes to overwrite).
   Then delete the old files this replaces:
   - delete the folder  js/vendor   (it now lives in public/js/vendor)
   - delete  img/campus-building.png   (replaced by campus-building.webp)
   - optional cleanup, not needed for Vite:  js/*.bak, js/*.bak2, patch-admin.mjs, patch-admin-pdf.mjs, img/bgimage.png (unused)

3. Install and test locally:
   npm install
   npm run build      (must say "built", no errors)
   npm run dev        (opens the site; log in with each role and click around)

4. Commit and push the BRANCH (not main):
   git add -A
   git commit -m "Switch to Vite build; bundle Supabase; optimize images"
   git push -u origin vite-migration

5. Vercel makes a Preview link for the branch automatically
   (Vercel dashboard → your project → Deployments → the one labelled "Preview" for vite-migration).
   Open it and run the test checklist. `main` / the live site stay unchanged.
   If no preview appears: Project → Settings → Git → make sure the GitHub repo is connected,
   and that "Ignored Build Step" is not set to skip non-main branches.

6. Before testing, check Vercel → Project → Settings → General → Node.js Version = 22.x
   (the Supabase library needs Node 22+).

7. Only when everything passes: merge the branch into main (GitHub pull request → Merge).
   To undo later: revert the merge commit.

IMPORTANT: the Preview uses your REAL database. Use a test student/teacher account.
Optional: to point previews at a separate test Supabase project, set
VITE_SUPABASE_URL and VITE_SUPABASE_KEY in Vercel → Settings → Environment Variables
(tick "Preview" only). If you don't set them, the real values from js/supabase.js are used.

Also: .env.local in your project folder contains a Vercel token. It's gitignored (good),
but don't share the folder/zip with it inside.
