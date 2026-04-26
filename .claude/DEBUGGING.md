# Debugging Workflow

**Use this for every bug, even tiny ones.** The point is discipline, not ceremony — the phases are gates, not paperwork. Skipping a phase to "save time" is the failure mode this doc exists to prevent.

Track progress with `TodoWrite` — one todo per phase. Mark complete only when the phase's gate is met.

---

## Phase 0 — Frame

Write down, before anything else:
- **Observed:** what's actually happening (≤2 sentences)
- **Expected:** what should happen instead (≤2 sentences)
- **Scope:** which view / file / user role is affected

If the user's report is vague ("X is weird"), ask one clarifying question before proceeding. Don't guess what they meant.

**Gate:** observed + expected are written down.

---

## Phase 1 — Reproduce (you do this, not the user)

You must trigger the bug yourself before touching code.

**Setup (do once per session):**
1. Check if a Preview server is already running: `mcp__Claude_Preview__preview_list`. If yes, reuse its `serverId` — do NOT start a second one.
2. If not running: `mcp__Claude_Preview__preview_start` with `name: "vokabeltrainer"` (defined in `.claude/launch.json`). Save the returned `serverId` for the rest of the session.
3. Read test credentials from `.claude/credentials.local.md` (gitignored).

**Repro loop with Preview MCP:**
1. `preview_snapshot` — get the accessibility tree to find selectors for the login form
2. `preview_fill` email + password, `preview_click` the login button
3. `preview_console_logs` — grab baseline after login (should be clean)
4. Click through to the broken state via `preview_click` / `preview_fill`
5. `preview_console_logs level: "error"` — capture errors
6. `preview_network filter: "failed"` — capture failed requests
7. `preview_screenshot` if the bug is visual; `preview_inspect` for specific style/layout values

**If you can't reproduce:**
- If a few more attempts with light variation might catch it → try, max 3 attempts
- If reliably reproducing would need user-specific data, special account state, or a long autonomous exploration → **stop and ask the user**. Don't burn 20 tool calls guessing.

**Gate:** you can trigger the bug on demand and have console + network evidence captured. Write the exact repro steps in your response so they're recoverable.

---

## Phase 2 — Root cause (the discipline phase)

This is where most bugs get patched instead of fixed. Resist.

**Step 1 — Hypotheses before code reading.**  
Write 2–3 candidate causes. For each, write what evidence would prove or disprove it. Doing this *before* opening files keeps you from anchoring on the first plausible-looking line of code.

**Step 2 — Trace, don't skim.**  
Use Grep to find the symptom site, then trace data flow *backwards*: where did this value come from? Who wrote it? When? Read the actual code paths, not just the function the error points at.

**Step 3 — The causal chain gate.**  
Before writing any fix, you must be able to write a chain of at least 3 steps:

> "Symptom **X** happens because **Y**. **Y** happens because **Z**. **Z** is the root cause because [reason that doesn't bottom out in 'the code does this' — it should bottom out in a wrong assumption, missing case, race, schema mismatch, etc.]"

If you can't write that chain, **keep investigating**. A 2-step chain ("X happens because the code does Y") means you've found the symptom site, not the cause.

**Common root-cause categories** (use as a checklist if stuck):
- Wrong assumption about data shape (Supabase returns `null` vs `[]` vs missing column)
- Race / order-of-operations (two async things, no await)
- State leak between views (global state not reset on navigation)
- RLS policy hides rows you expected
- Stale cache / closure capturing old value
- Schema drift between staging and prod
- Browser quirk (event ordering, focus, autofill)

**Gate:** the 3+ step causal chain is written.

---

## Phase 3 — Fix

- **Smallest change** that addresses the root cause. Not the cause + adjacent cleanup.
- Write one sentence: "this fix does NOT address [X, Y]" — forces honest scope.

**Forbidden patterns** (re-read every time):
- Adding `?.` or `??` to silence an undefined without finding *why* it's undefined
- `try/catch` wrapped around the symptom to swallow the error
- "Defensive" null checks where the value should never be null — if it's null, that's the bug
- Commenting out broken code "for now"
- Leaving `console.log` debug spam in the committed code
- Adding a feature flag to hide the bug
- "Fixing" by retry / setTimeout — these are race-condition patches, not fixes

If you find yourself reaching for one of these, go back to Phase 2 — the root cause isn't actually known yet.

---

## Phase 4 — Verify (you do this, not the user)

The fix is not done until *you* re-run the Phase 1 repro and it no longer reproduces.

1. Reload the Chrome MCP tab (`navigate` to same URL, or `javascript_tool` → `location.reload()`)
2. Run the **exact** repro steps from Phase 1
3. `read_console_messages` — must be clean of the original error
4. `read_network_requests` — must show the previously-failing call now succeeding (or no longer being made if that's the fix)
5. **Regression check:** test 1–2 adjacent flows. Examples:
   - Fixed something in SRS rating? Also try chapter switch, session end
   - Fixed something in homework? Also try teacher view of the same homework
   - Fixed something in login? Also try logout + re-login

"The code looks right" / "the change makes sense" does NOT count as verification. Re-running the repro is the only acceptable proof.

**Gate:** repro fails to reproduce + no new console errors + adjacent flows still work.

---

## Phase 5 — Close out

1. **Bug log:** append one line to `.claude/bug-log.md` in this format:
   ```
   YYYY-MM-DD | file.js:line | symptom → root cause → fix
   ```
   Keep it terse — this is pattern memory across sessions, not a write-up.

2. **Memory:** if the root cause taught you something *non-obvious* about the codebase (a hidden invariant, a subtle data-shape rule, a Supabase RLS gotcha), save a `project` memory. Don't save things derivable from reading the file.

3. **Out-of-scope finds:** anything you noticed but didn't fix → `mcp__ccd_session__spawn_task` so it doesn't get lost and doesn't bloat this change.

4. **Summary to user:** one or two sentences. What changed, what you verified.

---

## Credentials

Test account credentials live in `.claude/credentials.local.md` (gitignored). Read that file to get them.

If the file is missing, stop at the login screen and ask the user. Don't try to register a new account — that pollutes staging.

---

## Tool quick reference

| Need | Tool |
|---|---|
| Check if server running | `mcp__Claude_Preview__preview_list` |
| Start dev server | `mcp__Claude_Preview__preview_start` (name: `vokabeltrainer`) |
| Stop dev server | `mcp__Claude_Preview__preview_stop` |
| Get page structure / find selectors | `mcp__Claude_Preview__preview_snapshot` |
| Click | `mcp__Claude_Preview__preview_click` |
| Fill input | `mcp__Claude_Preview__preview_fill` |
| Read console | `mcp__Claude_Preview__preview_console_logs` (use `level: "error"` to filter) |
| Read network | `mcp__Claude_Preview__preview_network` (use `filter: "failed"`) |
| Inspect computed style | `mcp__Claude_Preview__preview_inspect` |
| Run JS in page | `mcp__Claude_Preview__preview_eval` (state inspection only — don't use to "fix" UI) |
| Screenshot | `mcp__Claude_Preview__preview_screenshot` |
| Find code | `Grep` first, `Read` second |

Preview MCP is the primary debugging tool. Chrome MCP (`mcp__Claude_in_Chrome__*`) is a fallback for cases where you specifically need to debug against the user's real browser state.
