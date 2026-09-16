# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GigATax (product-facing name "Finch") — taxes/expense tracking for gig workers, streamers, and creators. FastAPI backend + React/Vite frontend, Supabase for auth/db/storage, Plaid for bank connections, Anthropic Claude for receipt OCR and transaction categorization.

## Commands

### Backend (Python, managed with `uv`)
```bash
uv sync                              # install deps (from uv.lock/pyproject.toml)
python scripts/start_backend.py      # runs DB connectivity check, then starts uvicorn
uvicorn backend.main:app --reload    # run directly (no pre-flight DB check)
python backend/startup_checks.py     # standalone Supabase connectivity check
python scripts/seed_demo_data.py     # seed demo transactions for existing auth users
python scripts/plaid_sanbox.py       # exercise Plaid sandbox flow standalone
```
There are no backend tests currently in the repo.

### Frontend (`frontend/`)
```bash
npm install
npm run dev         # vite dev server
npm run build        # tsc -b && vite build
npm run typecheck    # tsc --noEmit
npm run preview
```
No frontend test suite/linter is configured.

## Environment configuration

Env vars are loaded from `backend/.env` and `frontend/.env` (see `backend/startup_checks.py::_load_env` and `backend/src/ai/categorizer.py::_load_env`, which each do their own lightweight `.env` parsing rather than relying solely on `python-dotenv`). Key vars:

- **Backend**: `SUPABASE_URL` (or `SUPABASE_PROJECT_URL`), `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_ROLE`/`SUPABASE_SECRET_KEY`), `ANTHROPIC_API_KEY`, Plaid credentials — `PLAID_CLIENT` (client id, shared across environments) plus **two separate secrets**: `PLAID_ENV` (despite the name, this holds the Plaid **production** secret) and `PLAID_SANDBOX_ENV` (the sandbox secret), and **`PLAID_ENVIRONMENT`** (`sandbox` (default) / `production` — this `plaid-python` version only exposes those two hosts, no standalone `development`) selects which host + secret pair `plaid_client()`/`_plaid_host_and_secret()` in `backend/src/routers/plaid.py` actually uses; defaults to `sandbox` even if production credentials are present, so it must be set explicitly to hit production — **setting it to `production` means Plaid Link will connect real bank accounts and real transaction data will sync**; `/api/v1/plaid-test-dashboard` only works in `sandbox` since it calls Plaid's sandbox-only token creation API, `PLAID_TOKEN_ENCRYPTION_KEY` (Fernet key used by `backend/src/utils/crypto.py` to encrypt/decrypt stored Plaid access tokens — generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`), `ACCESS_CODE` (gates onboarding via `/api/v1/access/verify`), `CORS_ALLOW_ORIGINS` (comma-separated, merged with hardcoded defaults + `*.vercel.app` regex).
- **Frontend** (`frontend/.env`, see `frontend/.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`.

The backend uses the Supabase **service role** key and therefore bypasses Postgres RLS — request-level authorization happens in-code by verifying the caller's Supabase JWT (see Auth below), not via RLS on the service connection.

## Architecture

### Backend (`backend/`)
FastAPI app assembled in `backend/main.py`, which just registers routers from `backend/src/routers/`. Each router is a thin, single-file REST resource (`users`, `dashboard`, `onboarding`, `plaid`, `receipts`, `optimization`, `filing`, `waitlist`, `access`), all mounted under prefix `/api/v1`. There's no service/repository layer — routers call `backend.db.get_supabase()` directly and issue Supabase table calls inline.

- **`backend/db.py`**: `get_supabase()` is an `lru_cache`d singleton client built from service-role credentials.
- **`backend/src/routers/deps.py`**: auth dependency helpers. `get_user_id(authorization)` and `get_auth_user(authorization)` both expect an `Authorization: Bearer <supabase JWT>` header and verify it via `supabase.auth.get_user(token)`. Every protected router calls one of these manually (FastAPI `Depends` is not used) — pass the `authorization: str | None = Header(default=None)` param and call `get_user_id(...)` at the top of the handler.
- **`backend/src/schemas/requests.py`**: Pydantic request bodies, one per endpoint, imported into the relevant router.
- **`backend/src/ai/categorizer.py`**: all Claude Anthropic SDK calls — `extract_receipt` (vision, base64 image/PDF → merchant/amount/date), `categorize_transaction`, `discover_deductions`. Instantiates its own Anthropic client from `ANTHROPIC_API_KEY` (does its own `.env` loading independent of `startup_checks.py`).
- **`backend/src/services/demo_transactions.py`**: demo/seed data generation used by `scripts/seed_demo_data.py`.
- **`backend/schema.sql`**: source of truth for the Supabase schema — run manually in the Supabase SQL editor (no migration tool). Defines `users`, `transactions`, `deductions`, `receipts`, `integrations`, `plaid_items` (encrypted Plaid access tokens, one row per linked bank connection — see `backend/src/utils/crypto.py`), `optimization_signals`, `filing_profiles`, `filing_runs`, all with RLS policies scoped to `auth.uid()`, plus an `on_auth_user_created` trigger that inserts a `public.users` row when someone signs up. When adding a table/column, update this file and apply it manually — there's no migration runner.
- **`backend/startup_checks.py`**: run before uvicorn starts (via `scripts/start_backend.py`) to fail fast on missing Supabase env vars/connectivity rather than surfacing errors per-request.

Common per-request pattern in routers: verify auth → `get_supabase()` → `sb.table(...).select/upsert/insert(...).eq("user_id"/"id", user_id).execute()`. Many handlers lazily upsert a `users` row on first access if one doesn't exist yet (see `users.py`, `dashboard.py`).

### Frontend (`frontend/src/`)
Vite + React 18 + TypeScript + Tailwind, client-side routed (`react-router-dom`) in `App.tsx`.

- **Route structure**: public routes (`/`, `/waitlist`, `/auth/callback`) → `/start` (onboarding) gated by `AccessGuard` (checks an access code against `/api/v1/access/verify`) → authenticated app routes (`/dashboard`, `/receipts`, `/optimization`, `/review`, `/filing-prep`) nested under `RequireAuth` + `AppShell`.
- **Auth**: `src/lib/supabaseClient.ts` creates the Supabase JS client from `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`. `RequireAuth` guards authenticated routes; `AuthCallbackPage` handles the OAuth/magic-link redirect.
- **API layer**: `src/services/api.ts` is the real backend client — every call goes through `apiFetch`/`requestWithAuth`, which attaches the Supabase JWT via `getAuthHeaders()` and retries once with a forced token refresh on auth failure. `resolveApiBaseUrl()` deliberately falls back to a hardcoded production URL (`https://api.finch-tax.com`) if `VITE_API_BASE_URL` is unset, or if a remote-hosted page is pointed at `localhost`/an insecure `http://` URL — this is a safety net against shipping a build wired to a local backend. `src/services/mockApi.ts` is a parallel mock implementation returning canned data from `src/data/mockData.ts`; a few pages (e.g. `FilingPrepPage`) still import from it instead of `api.ts` — check which one a page uses before assuming live data.
- **Types**: `src/types/api.ts` (request/response DTOs matching backend Pydantic schemas) vs `src/types/domain.ts` (frontend domain models) are kept separate — API responses generally get mapped into domain types before use in components.
- **Business logic helpers** live in `src/utils/`: `taxMath.ts` (deduction/tax calculations), `optimizationSignals.ts`, `stateTaxContext.ts` — prefer extending these over inlining tax math in components.
- Domain feature areas map roughly to route pages: dashboard (`components/dashboard/`), optimization nudges (`components/optimization/`), receipt capture, filing prep.

## Deployment

- **Backend**: Railway, via `railpack.json` (`uvicorn backend.main:app --host 0.0.0.0 --port $PORT`). Also has a GitHub Actions workflow (`.github/workflows/deploy.yml`) that SSHes into an EC2 host on push to `main` and runs `/opt/finch/deploy.sh` there — two deployment paths exist, confirm which is actually live before assuming Railway is authoritative.
- **Frontend**: Vercel (`frontend/vercel.json`); CORS on the backend explicitly allows `https://*.vercel.app` plus a hardcoded prod URL and whatever's in `CORS_ALLOW_ORIGINS`.
