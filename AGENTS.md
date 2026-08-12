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


<claude-mem-context>
# Memory Context

# [Radar-Licitaciones-MX] recent context, 2026-08-09 10:37pm CST

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (23,962t read) | 584,553t work | 96% savings

### Jun 14, 2026
S111 User asked if "fase H" is needed next — clarifying an unfamiliar term in the audit context (Jun 14 at 6:40 PM)
S110 Radar Licitaciones MX — Full Audit &amp; Stabilization Plan Initiated (Jun 2026) (Jun 14 at 6:40 PM)
### Jul 15, 2026
674 11:50p 🔴 Radar-Licitaciones-MX — Watchdog job.ts: notifyWatchdogHealthIfNeeded Reordered to Run After setState
678 11:57p ⚖️ Radar-Licitaciones-MX — licitacion-watchdog: Full Hardening Plan Submitted (July 16, 2026)
679 11:58p 🔴 Radar-Licitaciones-MX — licitacion-watchdog Hardening Committed to main (dea7c53)
680 " 🔵 Radar-Licitaciones-MX — Chromium BrowserManager Missing --single-process and --no-zygote Flags Despite Zygote Failure
### Jul 16, 2026
681 12:02a ✅ Radar-Licitaciones-MX — licitacion-watchdog Hardening Pushed to origin/main (dea7c53)
### Aug 9, 2026
698 7:32p ⚖️ Radar-Licitaciones-MX — Forensic Audit of LA-50-GYR-050GYR007-N-173-2026 Initiated
699 7:33p ⚖️ Radar-Licitaciones-MX — Forensic Audit Initiated for Licitación LA-50-GYR-050GYR007-N-173-2026
700 " ⚖️ Radar-Licitaciones-MX — Forensic Audit Task Initiated for Licitación LA-50-GYR-050GYR007-N-173-2026
S267 Radar-Licitaciones-MX — Forensic Audit Task Initiated for Licitación LA-50-GYR-050GYR007-N-173-2026 (Aug 9 at 7:33 PM)
701 7:37p ⚖️ Radar-Licitaciones-MX — Forensic Audit Phase 1 Initiated: LA-50-GYR-050GYR007-N-173-2026
702 7:38p 🟣 Radar-Licitaciones-MX — Forensic Audit Directory Structure Created at /auditoria_n173/
704 " ✅ Radar-Licitaciones-MX — Forensic Chain of Custody Document Created
705 " 🔵 Radar-Licitaciones-MX — ComprasMX Collector Module Structure Identified
706 " 🔵 Radar-Licitaciones-MX — ComprasMX Collector Uses Playwright API Interception, Not HTML Scraping
707 " 🔵 Radar-Licitaciones-MX — Read-Only Audit Query Scripts Already Exist for N-173 Companies
708 7:40p 🟣 Radar-Licitaciones-MX — Standalone Read-Only ComprasMX API Client Created for N-173 Audit
709 " 🔵 Radar-Licitaciones-MX — N-173 Returns 0 Registros from ComprasMX Active Listing API (Procedure No Longer Active)
710 7:42p 🔵 Radar-Licitaciones-MX — N-173 Confirmed Absent from ComprasMX Active Index Across All Query Variants
712 " 🔵 Radar-Licitaciones-MX — N-173 Full ApiRegistro Retrieved: ADJUDICADO PARCIAL, id_procedimiento=468071, uuid=ed72c38c5b684521a64c9c1b65473e9d
713 7:43p 🟣 Radar-Licitaciones-MX — Playwright Detail Page Capture Script Created for N-173 Expediente
715 7:44p 🔵 Radar-Licitaciones-MX — N-173 Complete Expediente Detail and 9-Attachment Index Retrieved from ComprasMX API
716 7:45p 🟣 Radar-Licitaciones-MX — Playwright Attachment Downloader Created for N-173 Public Documents
717 7:46p 🔵 Radar-Licitaciones-MX — All 9 N-173 Public Attachments Successfully Downloaded; ANEXOS Bundle Delivered as ZIP
719 7:47p 🔵 Radar-Licitaciones-MX — ZIP Extracted; Excel Files Reveal Numeric Ordering Mismatch (T1, T3, T2)
720 " 🟣 Radar-Licitaciones-MX — Evidence Manifest Registration Script Created (register_evidence.py)
721 7:49p ✅ Radar-Licitaciones-MX — Evidence Manifest Populated: 19 Artifacts Registered (EVID-0001 to EVID-0019)
723 7:51p 🔵 Radar-Licitaciones-MX — N-173 Forensic Audit: Extraction Tools Confirmed Available
724 " 🔵 Radar-Licitaciones-MX — N-173 Audit: Evidence Manifest Has 2+ IMSS Documents Catalogued
725 7:52p 🟣 Radar-Licitaciones-MX — N-173 Forensic Audit: DOCX Text Extraction Completed
726 " 🔵 Radar-Licitaciones-MX — N-173 OCR Blocked by Digital Signatures on All 4 Actas
727 7:55p ⚖️ Radar-Licitaciones-MX — N-173 Forensic Audit Session Resumed After Interruption
728 7:56p ⚖️ Radar-Licitaciones-MX — N-173 Audit Resumption: Full 12-Rule Handoff Protocol Established
729 " 🔵 Radar-Licitaciones-MX — N-173 Audit: `ps` Command Blocked by Codex Sandbox Permissions
730 " 🔵 Radar-Licitaciones-MX — N-173 Audit: No Lingering OCR Processes; Only chroma-MCP Running
731 " 🔵 Radar-Licitaciones-MX — N-173 Audit Phase 1: Full Disk Inventory Reconstructed (54 files, 29MB, 19 Evidence IDs)
733 7:57p 🔵 Radar-Licitaciones-MX — N-173 Audit: OCR Root Cause Confirmed — pyHanko Digital Signatures Block ocrmypdf
734 " 🔵 Radar-Licitaciones-MX — N-173 Audit: PDF Actas Are Pure JPEG Scans at 200 DPI — OCR Required for All Content
735 " 🔵 Radar-Licitaciones-MX — N-173 Audit: All 19 Evidence IDs Pass SHA-256 Integrity Check; 35 Unregistered Support Files Identified
736 7:58p 🔵 Radar-Licitaciones-MX — N-173 Audit: Key Economic Data Extracted — Contract Awarded to ATLANTIS at $40.7M MXN
737 8:00p ⚖️ Radar-Licitaciones-MX — N-173 Forensic Audit: Session Handoff Document Submitted to Continue Interrupted Work
738 8:02p ⚖️ Radar-Licitaciones-MX — N-173 Forensic Audit Resumption Initiated via Handoff Document
739 8:04p ⚖️ Radar-Licitaciones-MX — N-173 Forensic Audit Recovery Session Re-Initiated via Handoff Document (Aug 10, 2026)
740 8:10p ⚖️ Radar-Licitaciones-MX — N-173 Forensic Audit: Interrupted Session Recovery Initiated via Handoff Protocol
741 " 🔵 Radar-Licitaciones-MX — N-173 Audit Phase 1: Full State Reconstruction from CHECKPOINT_RECUPERADO_SOL.md
742 " 🔵 Radar-Licitaciones-MX — N-173 Audit: ComprasMX Read-Only Script Architecture Confirmed
743 " 🔵 Radar-Licitaciones-MX — N-173 Audit: Physical File Inventory Confirms 54-File Structure
744 " ⚖️ Radar-Licitaciones-MX — N-173 Audit Phase 1: 7-Step Resumption Plan Established
746 8:12p 🟣 Radar-Licitaciones-MX — N-173 Audit: OCR Successfully Executed on Signed PDFs via --invalidate-digital-signatures
747 " 🟣 Radar-Licitaciones-MX — N-173 Audit: EVID-0007 OCR Completed; EVID-0008 (65 pages) Started
748 8:13p 🔵 Radar-Licitaciones-MX — N-173 Audit: EVID-0008 Apertura Acta Has Systematic Sideways Pages 30–40+
750 " 🔵 Radar-Licitaciones-MX — N-173 Audit: EVID-0008 OCR Suppressed Text on 30 Sideways Pages — Critical Data Loss

Access 585k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>