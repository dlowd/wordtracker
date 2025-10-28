# Repository Guidelines

## Project Structure & Module Organization
- The app now lives in `wordtracker-vite/` (Vite + vanilla JS). Root `index.html` is kept for legacy reference; new work should target the Vite project.
- Global styles sit in `src/styles/global.css`; feature logic is split across `src/app`, `src/state`, `src/features`, `src/ui`, and `src/utils`.
- Supabase access is centralized in `src/supabase/client.js` (ESM import via `https://esm.sh`). Use the exported client helpers instead of wiring Supabase directly in feature files.
- When adding assets, place them under `wordtracker-vite/public/` so Vite can serve them without extra configuration.

## Build, Test, and Development Commands
- `cd wordtracker-vite && npm install` — install dependencies.
- `npm run dev` — start the Vite dev server (hot reload, ES modules).
- `npm run build` — produce the static bundle in `wordtracker-vite/dist/`.

## Coding Style & Naming Conventions
- Two-space indentation for JS modules and CSS. Keep imports sorted by relative path segment (`utils → state → ui → features`).
- Prefer `const`/`let`, camelCase identifiers, and keep DOM lookups centralized via `src/ui/dom.js`.
- Modules should expose explicit functions; avoid implicit globals. Use the existing feature folders as templates when introducing new functionality.

## Testing Guidelines
- The `runSelfTests()` helper still runs on boot (see `src/app/app.js`) and is the quickest way to sanity-check date math after refactors.
- For new modules, add lightweight unit helpers where practical (e.g., pure utils). Keep browser smoke tests in the manual checklist (word entry, import/export, Supabase auth).
- Run `npm run build` before releasing to ensure the bundler can resolve external ESM imports.

## Commit & Pull Request Guidelines
- Follow short, imperative commit subjects (`Add pace variance guard`). Include detail lines only when necessary.
- PRs should describe motivation, summarize UI impacts, and call out manual test steps (browser + platform). Link NaNoWriMo tracker issues or TODO references when available.
- Attach screenshots or screen recordings for visual changes, especially stats cards, chart rendering, and overlays, so reviewers can confirm differences quickly.
