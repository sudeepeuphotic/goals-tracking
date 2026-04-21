# Nosh Focus Cycles — Product Requirements (PRD)

## Problem Statement (verbatim)
"I want to build an application to track candidates progress in the organisation. I have attached the requirements in the PDF format. Can you build a web-application and compatible backend for this?"

Source: `Nosh Focus-cycle-v4.pdf` — PRD for the Nosh Focus Cycles Tool v2, an internal
tool to run 3-month execution cycles.

## Tech Stack
- Backend: FastAPI + MongoDB (motor) + PyJWT + bcrypt. All endpoints under `/api`.
- Frontend: React 19 + Tailwind + shadcn/ui + axios + react-router-dom 7.
- Auth: JWT in httpOnly cookies (access 12h, refresh 7d). Roles: `admin`, `manager`, `dri`, `contributor`.
- Design: IDE-inspired / Swiss-brutalist (sharp corners, traffic-light system, Space Grotesk + IBM Plex).

## User Personas
- **Admin / Founder** — creates cycles, objectives, assigns DRIs & contributors, sets rigor questions.
- **Manager** — reads individual & objective progress, team DRI feedback; writes manager review.
- **DRI** — leads an objective, submits weekly updates + end-of-cycle DRI reflection.
- **Contributor** — fills an Individual Plan, submits weekly updates, end-of-cycle reflection, and DRI feedback for objectives they contributed on.

## Core Requirements (static)
1. Focus Cycle (3-month) creation & activation.
2. Objectives with DRI + success metric + current/target + contributors + custom rigor questions.
3. Individual Plan per user per objective (mission, role, ownership metric, up to 3 goals, key bets, risks, kill list).
4. Weekly Updates — green/yellow/red + 2-3 line text + blockers + progress; <3 minutes.
5. End-of-Cycle Reflections — Individual (10 fields + rigor answers) + DRI (9 fields + outcome enum).
6. DRI Feedback — 6 dimensions (clarity, alignment, unblocking, decision_making, quality_bar, trajectory_impact) enum excellent/good/okay/poor + optional examples + free text.
7. Manager Review — final evaluation, optional score 1-5, disagreement note vs AI. Tabbed interface: Individual / Objective / DRI feedback / AI analysis.
8. AI Panel — placeholder in v1, gated to manager/admin.

## Implemented (v1) — 2026-02-21
- JWT auth + admin seed + 4 demo users (manager/dri/alice/bob) + 1 active cycle "Q1 2026 — Growth" + 2 seeded objectives + 1 plan + 1 weekly update.
- All CRUD endpoints with role gating & business rules:
  - DRI cannot rate themselves.
  - Non-contributors cannot submit DRI feedback.
  - Only the DRI can submit the DRI reflection.
  - Manager review restricted to manager/admin.
- Dashboard with current objective + goals + ownership metric + latest status + inline weekly widget.
- Cycles page (admin creates cycles + objectives with DRI picker, contributor checkboxes, rigor questions).
- Objective Detail with tabs: Updates timeline / Plans / DRI feedback (with aggregate summary for manager/admin) / AI analysis (manager/admin).
- My Plan (sectioned form) + Weekly Update (traffic light widget + personal timeline).
- End-of-Cycle Reflection (Individual + DRI-mode toggle visible only to the DRI).
- DRI Feedback page — segmented control radio + optional examples + free text.
- Manager Review — 4 tabs (Individual / Objective / DRI feedback / AI).
- Admin Users page — list + create.
- IDE-brutalist design: Space Grotesk headings, IBM Plex Sans body, IBM Plex Mono for data/labels, sharp 1px borders, 4px 4px 0 shadows.

## Iteration 2 — 2026-02-21
- **Password reset** — `/api/auth/forgot-password` (logs reset link to server console, dev mode) + `/api/auth/reset-password` with 32-byte URL-safe token + 1-hour TTL + single-use. Frontend: "Forgot password?" dialog on Login + `/reset-password?token=…` page.
- **Brute-force lockout** — 5 failed logins per `{real_ip}:{email}` → 15-min lockout (429). Uses `x-forwarded-for` (first hop) instead of `request.client.host` so it works correctly behind k8s ingress. Verified: 6th attempt returns 429.
- **In-app reminder banner** — Dashboard shows yellow "REMINDER · YYYY-Www" banner counting user objectives with no update for the current ISO week, with a Submit-now CTA to `/weekly`. (External email/Slack deferred per user choice.)
- **Progress charts** — Added `ProgressChart` (recharts) to Objective Detail → Updates tab. Status-over-time line (G/Y/R step chart) + metric current→target bar.
- **Privacy-scoped /api/users** — Admin/manager get full fields; contributors get only `{id, name, role}`.
- **AI evaluator (Gemini 3 Flash)** — Live, manager/admin-only. `POST /api/ai/evaluate-individual` and `POST /api/ai/evaluate-objective`. Uses `google-genai` SDK with `response_mime_type=application/json` + strict JSON schema. Feature-flagged via `AI_ENABLED` + `GOOGLE_API_KEY` + `AI_MODEL`. `AIPanel` component handles run/re-run, caching last eval, and compact display (exec summary, strength/risk signals, leadership grid, mismatch, execution risks, tentative score). Integrated on Dashboard (self-view for managers), Objective Detail AI tab, and Manager Review AI tab.

## Backlog (prioritised)
- **P0** AI evaluation layer — Gemini 3 Flash (configurable; skippable). Generates executive summary, strength/risk signals, leadership signals, tentative score, manager-attention points. Manager-only.
- **P1** Feedback anonymisation / summary view for the DRI themselves (v1 shows aggregate only to manager/admin).
- **P1** Password reset flow (forgot-password / reset-password) + brute-force lockout (5 fails = 15 min).
- **P1** Weekly update reminders (email or in-app) — high-leverage for adoption.
- **P2** Progress charts (metric current vs target over time) on Dashboard & Objective detail.
- **P2** GET /api/users restriction / field-scoping to avoid leaking user directory to contributors.
- **P2** Split `server.py` into `routers/*.py` (auth, cycles, objectives, plans, updates, reflections, feedback, manager_review).
- **P2** Admin password re-hash on .env change; seed updates for existing admin.

## Next tasks
1. Wire up the AI evaluator (Gemini 3 Flash) behind a feature flag.
2. Add password reset + brute-force lockout (per auth playbook).
3. Add weekly update reminders.
4. Visual charts for metric progression.

## Test credentials
`/app/memory/test_credentials.md` — admin/manager/dri/alice/bob.

## Regression suite
`/app/backend/tests/test_nosh_backend.py` — 24 pytest tests, 100% pass.
