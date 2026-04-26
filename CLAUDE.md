# Vokabeltrainer

Vanilla JS + Vite + Supabase. Heavy logic lives in `app.js`, `homework.js`, `lessons.js`, `vocab_exercises.js`. See `PROJEKT_KONTEXT.md` for domain background (parts are stale — the single-file structure is gone, now Vite + GitHub Pages, not Netlify).

## Debugging — read this first for any bug work
**For any bug — even a one-line one — open `.claude/DEBUGGING.md` and follow the 5 phases. Don't skip phases.** The doc enforces self-testing via Chrome MCP and root-cause discipline (no patching the symptom). After a fix lands, append one line to `.claude/bug-log.md`.

## Environment
- **Test against staging, never prod.** `npm run sync-staging` refreshes staging from prod.
- Dev server: `npm run dev` → http://localhost:5173

## General rules
- If avoiding a question would burn significant effort (long autonomous loops, lots of trial-and-error), **ask first**.
- Don't commit unless asked.
- Don't expand scope mid-task — `spawn_task` for out-of-scope finds.
