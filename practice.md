# practice.md — Working instructions for Claude Code

Tenant Maintenance Dashboard: a single-page demo for a property manager. Vanilla HTML/CSS/JS, no framework, no build step. Deployed on GitHub Pages: https://stavdayan-netizen.github.io/Dashboard-Practice/

## Rules

1. **Preserve the existing design and functionality** unless the user explicitly asks for a change.
2. **Make focused changes only.** No drive-by refactors, renames, or cleanups.
3. **Test locally before calling anything done** (see Testing).
4. **Commit and push after each completed change** (see Git).
5. **Never commit secrets, API tokens, or `.env` files.** Keep `.env` in `.gitignore`; add the entry if it's missing.
6. **External integrations take credentials from environment variables**, never from source files (see Secrets).
7. If a request is ambiguous, ask instead of guessing. Be exact with numbers and dates.

## Files

- `index.html`, `styles.css`, `app.js` — the app. PapaParse (CSV) and Chart.js (charts) load from CDN.
- `maintenance_requests.csv` — 40-row fallback data. `data.js` is generated from it by `generate-data.ps1`; rerun that script after editing the CSV.
- `demo_upload_sample.csv` — 36-row file for "Download demo CSV". `DEMO_CSV` in `app.js` must stay identical to it.
- `serve.ps1` — local static server. `README.md` documents setup. `SPEC.MD` is the original build brief.

## Data conventions

- Load order: Airtable first, bundled CSV as fallback. The header badge shows which is active ("Live: Airtable" / "Sample data (CSV)").
- Airtable base `appIl5LOY1FMfCPUR`: tickets table `tblk60sOTkEpyDmr1`, Properties table `tbl7OhvkXrPXmCAuB`. The ticket `property` field is a linked record (the API returns record IDs), so names are resolved through the Properties table.
- Each row carries `full_address` (Airtable lookup). It is not displayed; it's kept for the planned vendor-search integration.
- All data (Airtable, CSV, upload, New Request) goes through `validateRows()`. Rules: unique `id`; `date_created`, `date_resolved`, `cost_date` must not be after `AS_OF_DATE` (`2026-09-23`, the demo "today"); `cost` and `cost_date` are both present or both blank; category, priority, and status come from fixed lists.
- Parse CSV with PapaParse, never `split(',')`.
- Upload CSV and + New Request change in-memory data only; nothing is written back to Airtable or the CSV.

## Design and accessibility conventions

- Soft pastel look, white cards, indigo accent, UI in English, currency in USD.
- Charts: category donut and status bar use separate pastel palettes. The four status colors are distinct from each other and from the donut.
- Priority badges: Urgent red/pink, High orange, Medium yellow, Low green, each with a border. Keep text contrast at 4.5:1 or better.
- Keyboard: visible focus, tabs and rows operable by keyboard, dialogs close on Escape, trap focus, and return focus to the trigger.
- Responsive: no horizontal page overflow at 375px; the requests table becomes cards on phones.
- CSS gotcha: a class that sets `display` overrides the `hidden` attribute. Add a `.thing[hidden] { display: none; }` rule when needed.

## Testing

- No Node or Python on this machine. Run `powershell -ExecutionPolicy Bypass -File serve.ps1` (port 8531) and open `http://localhost:8531` in the browser pane. `file://` pages aren't testable there.
- Check: no console errors, correct numbers, desktop (~1300px) and mobile (375px) layouts, and any interaction you touched.
- Confirm the data source badge reads "Live: Airtable" when testing Airtable changes.
- Stop the server by process, not port: find `serve.ps1` via `Get-CimInstance Win32_Process` and `Stop-Process` that PID. The port owner is the System process.

## Git and deployment

- Branch `master`, remote `origin`. GitHub Pages deploys from `master` root, so every push goes live after a 1–2 minute rebuild.
- `git fetch` first. The user sometimes edits files directly on GitHub.
- Stage specific files; no `git add -A`. Make new commits; don't amend or rewrite pushed history.
- Commit message: short imperative subject, a body explaining why, then the `Co-Authored-By` trailer the environment specifies.
- The repo-local `user.email` is the GitHub no-reply address (`330001498+stavdayan-netizen@users.noreply.github.com`) because GitHub rejects pushes that expose the real email (GH007). Don't change global git config.

## Secrets and integrations

- Put credentials in a gitignored `.env` and read them from environment variables. Commit a `.env.example` with variable names and placeholder values only.
- The site is static, so browser code can't read environment variables. Anything that needs a private credential must run outside the browser (a local script or a serverless function). Ask the user which approach before building it.
- Don't write real credential values into files yourself. Leave a placeholder and tell the user where to paste it. Never print tokens in output, commits, or docs; redact them when showing config.
- **Known exception:** `AIRTABLE_CONFIG.token` in `app.js` is a read-only token (`data.records:read`) scoped to this one base, deliberately public so the Pages site works without a login. Don't copy this pattern for other services, and never swap in a broader token.
- Airtable ID values (base, table, record) are not secrets.
