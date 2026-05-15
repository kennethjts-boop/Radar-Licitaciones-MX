# Repository Guidelines

## Project Structure & Module Organization
This monorepo contains `apps/web/` for the Vite React dashboard, `apps/worker/` for the TypeScript radar worker, `scraper-maestros/` for the Morelos scraper, `supabase/` for functions and migrations, and `docs/` for handoff, architecture, and migration notes. Keep generated `dist/`, scraper `output/`, and local data dumps out of source changes unless explicitly required. If a nested `Radar-Licitaciones-MX/` repository appears, verify the intended root deliberately before editing.

## Build, Test, and Development Commands
Run commands inside each package. In `apps/web`: `npm run dev`, `npm run build`, `npm run lint`, and `npm run preview`. In `apps/worker`: `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run scan`, `npm run test:alerts`, `npm run financial:sample`, `npm run alert-filter:sample`, and `npm run external-leads:dry-run`. In `scraper-maestros`, use `npm start`. Node 20+ is required for the worker.

## Coding Style & Naming Conventions
Use TypeScript with camelCase functions, PascalCase React components, hooks named `use*`, and clear module boundaries under `apps/worker/src/modules`. Keep radar collectors, enrichment engines, alert filters, and Telegram handlers independently testable. Existing financial-ceiling work lives in `src/modules/financial-ceiling-radar/`; keep it isolated/accessory unless intentionally changing core flow.

## Testing Guidelines
Worker tests use Jest and TypeScript checks; run `npm test` and `npm run typecheck` before touching pipeline logic. Web changes should pass `npm run lint` and `npm run build`. Use deterministic fixtures for procurement documents and alert filters; avoid live portals in unit tests. Use sample scripts such as `financial:sample`, `alert-filter:sample`, or `external-leads:dry-run` for behavior validation when relevant.

## Commit & Pull Request Guidelines
History uses Spanish Conventional Commits with scopes, for example `feat: G3 ...`, `fix: G1/G2/G4 ...`, `fix: telegram bot handlers...`, and `feat: technical shielding...`. PRs should specify root vs nested repo when relevant, name the affected app, include commands run, describe alerting/database impact, and attach screenshots for dashboard changes.
