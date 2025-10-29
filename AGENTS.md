# Repository Guidelines

## Project Structure & Module Organization
- The Vite app lives in `wordtracker-vite/`; the root `index.html` is legacy. Build UI work inside the Vite project only.
- Core logic is split across `src/app` (controllers), `src/state` (shared state + persistence helpers), `src/features` (time warp, drawers), `src/ui` (DOM utilities, overlays), `src/utils`, and `src/theme`.
- Storage mode helpers sit in `src/data/mode.js`; Supabase wiring stays isolated in `src/supabase/client.js`. Keep adapters thin so UI modules call the exported helpers instead of touching storage directly.
- Static assets belong in `wordtracker-vite/public/` so Vite can serve them without extra configuration.

## UI Patterns & Components
- Centered modals (`overlay[data-align="center"]`) are used for settings and auth; right-hand drawers are reserved for the entries editor.
- Lightweight affordances use local helpers: the quick-actions menu is `#actionsMenu` (dropdown) and the date badge opens `#warpPopover` (popover). Reuse existing helpers (`toggleActionsMenu`, `closeTimeWarpPopover`) when extending these flows.
- Avoid introducing new ad-hoc overlays—prefer anchoring UI to its trigger, or extend the shared overlay/popup utilities.

- Users land in cloud mode by default. Offline mode is a hidden fallback: Alt/Option‑click the sync status chip to toggle modes. There is no visible UI entry point, so keep the shortcut intact when refactoring.
- Offline mode writes through `saveLocalState()`; cloud mode gates network calls behind `isCloudMode()`/`isRemote()`. New features must branch early based on the active mode.
- Import/export flows go through `buildExportPayload()`/`applyImportedData()`. Reuse those helpers when adding migrations so both modes stay consistent.
- While unsigned in cloud mode the app locks editing: `setAppInteractivity()` disables inputs and the login modal stays open. Keep that behaviour intact when extending auth flows.

## Build, Test, and Development Commands
- `cd wordtracker-vite && npm install` — install dependencies.
- `npm run dev` — start the Vite dev server (hot reload, ES modules).
- `npm run build` — produce the static bundle in `wordtracker-vite/dist/`. Run this after major refactors to verify the ESM graph.

## Coding Style & Naming Conventions
- Two-space indentation for JS/CSS. Group imports by layer (`utils → state → supabase/data → ui → features`).
- Prefer `const`/`let`, camelCase identifiers, and keep DOM lookups centralized via `src/ui/dom.js`.
- Route data persistence through helpers (`activateMode`, `saveLocalState`, `syncProjectSettings`). New features should not read/write `localStorage` or Supabase directly—add adapter hooks instead.
- For UI behavior, reuse the shared helpers (`toggleActionsMenu`, `setAppInteractivity`, `closeTimeWarpPopover`) rather than duplicating listener logic.

## Testing Guidelines
- `runSelfTests()` (in `src/app/app.js`) sanity-checks date math on boot—keep it green after refactors.
- Manual smoke tests should cover both modes: add words, tweak settings, import/export, refresh, and (for cloud) sign-in/out and real-time updates.
- For new persistence helpers, add focused unit tests or console assertions; finish with `npm run build` to verify module resolution.

## Commit & Pull Request Guidelines
- Follow short, imperative commit subjects (`Add pace variance guard`). Include detail lines only when necessary.
- PRs should describe motivation, summarize UI impacts, and list manual tests (explicitly state which mode you exercised). Link NaNoWriMo tracker issues or TODO references when available.
- Attach screenshots or screen recordings for visual changes—especially stats cards, chart updates, and modal flows (mode picker, login, settings)—so reviewers can confirm differences quickly.
