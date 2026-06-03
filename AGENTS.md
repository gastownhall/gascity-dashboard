# gas-city-dashboard — agent context

The durable conventions, invariants, and gotchas an agent must load to contribute here — the things the code does **not** announce about itself. Anything derivable from the source (file layout, component names, script flags, port numbers) is omitted on purpose: read the code, which is the canonical and non-stale record.

## What it is

An editorial-typographic ambient dashboard surfacing live state from a [Gas City](https://github.com/gastownhall/gascity) (`gc`) supervisor over its HTTP API. npm workspaces: `backend` (Node + Express + TS), `frontend` (React + Vite + Tailwind), and `shared`.

- **This repository is temporary.** It is the standalone workspace for the next Gas City dashboard and is intended to replace the existing `gc dashboard` implementation in `gastownhall/gascity` once it is ready to fold back into the main `gc` codebase.
- **Use the GC supervisor API directly for GC-owned resources.** The frontend
  uses the generated supervisor OpenAPI client for sessions, agents, beads,
  mail, events, health, cities, formula feeds, and formula-run snapshots. The
  dashboard service should own only dashboard-local host capabilities such as
  git/gh/diff/build/dolt-noms reads and the transport-only `/gc-supervisor/*`
  proxy. Do not add new dashboard DTO mirrors or backend route facades for
  supervisor-owned data.
- **`shared` is the single source of truth for dashboard-owned `/api/*` DTOs and UI contracts.** Both sides import it, so a dashboard contract mismatch is a compile error, not a runtime `undefined`. Do not mirror supervisor wire shapes in `shared` when the generated supervisor client can carry them directly.
- **The backend binds `127.0.0.1` only, by design.** For remote dev, forward the Vite port over SSH; never expose the backend.
- **User-facing product language is Formula / Run / Formula Run.** The GC supervisor API still uses `workflow` in some wire paths and field names. Keep that vocabulary at UI boundaries and in dashboard-owned projections; do not hide or duplicate supervisor wire fields with a backend DTO layer.

## The contracts (they outrank assumed conventions)

- **`README.md`** — repo status, quick start, supported surface, and operations overview.
- **`specs/requirements/product.md`** — what's being built and for whom (users, purpose, brand personality, anti-references). Strategic decisions defer to it.
- **`DESIGN.md`** — the binding visual contract, kept at the repo root as the agent-facing design standard (alongside `README.md` and `AGENTS.md`), not under `specs/`. Re-read it before any UI or UI-copy change. It defines the named rules and style absolutes and outranks habit. Don't restate it here — it would go stale against the source of truth. All specs that touch UI, copy, or visual structure should defer to it rather than redefine visual rules.
- **`specs/architecture/{overview,security,extending}.md`** — how things are wired, the security/impersonation model, and how to add a route or endpoint. Deeper specs live alongside in `specs/architecture/` (e.g. `formula-run-detail-type.md`, `module-author-checklist.md`, `maintainer-coupling-audit.md`); product requirements live in `specs/requirements/` (e.g. `modular-dashboard-prd.md`); implementation plans in `specs/plans/`.

## Remote, CI, and the merge gate

Published at **github.com/gastownhall/gascity-dashboard**. Land feature work on branches and open PRs against `main`. (The git remote pointing at that URL is whatever your local clone named it — `git clone` defaults to `origin`, but a renamed remote is still fine; nothing in the workflow depends on the name.)

`main` is branch-protected — land work via a PR that passes CI (`.github/workflows`); you cannot push straight to `main`. **Match CI locally before pushing or the merge blocks:** root `npm run typecheck` runs both source and test typechecks. CI also runs the shared build/tests, generated supervisor client drift check, frontend build, backend tests, and frontend tests.

## Commands

Use npm workspaces from the repo root:

- `npm install`
- `npm run build:shared`
- `npm run dev:backend`
- `npm run dev:frontend`
- `npm run lint`
- `npm run typecheck`
- `npm --workspace backend test`
- `npm --workspace frontend test`
- `npm --workspace frontend run build`

For GC supervisor OpenAPI work:

- `npm run openapi:gc-supervisor:update` refreshes `backend/openapi/gc-supervisor.openapi.json`.
- `npm run openapi:gc-supervisor:generate` regenerates the backend and frontend supervisor client artifacts.
- `npm run openapi:gc-supervisor:check` verifies the generated supervisor client is current.

Do **not** hand-edit generated supervisor API artifacts. Change the OpenAPI schema or generator inputs, regenerate, and commit the generated result.

## Gotchas the code won't tell you

- **Tailwind config changes need a full Vite restart**, not HMR: `rm -rf node_modules/.vite && npm run dev:frontend`, or stale class definitions are served.
- **The Vite proxy's `changeOrigin: true` is load-bearing** — it makes write requests carry the backend's expected `Origin` and pass its allow-list. Don't remove it.
- **`.env.local` (gitignored) must be sourced** before the backend runs (it defines `GC_CITY_NAME`, `ADMIN_AUDIT_LOG_PATH`, etc.): `set -a; . ./.env.local; set +a`.
- **Formula run detail has a focused browser harness:** `node scripts/snap-formula-run-detail.mjs --test` clicks through `/runs` into a mocked run detail and fails on any broken `/api/*` call. Its base URL defaults to `http://127.0.0.1:5174` and can be overridden with `SNAP_BASE`. It **does not start its own server** — it drives whatever Vite is already serving there, so it tests the working tree of whichever checkout is running `npm run dev:frontend`. Set `SNAP_BASE` when testing a different dev server. Playwright lives at `scripts/node_modules/` (per-script install), not at the root.
- **Hidden paths are ignored by default.** `.gitignore` intentionally ignores dotfiles/dot-directories except allow-listed project files such as `.github`, `.claude`, and `.agents`. Be deliberate before adding new hidden project paths.

## Project agent files

- `AGENTS.md` is the canonical shared project guide.
- `CLAUDE.md` and `GEMINI.md` are import shims that point at `AGENTS.md`.
- `.claude/skills/` is the real shared project skill tree.
- `.agents/skills` symlinks to `.claude/skills`.
- Preserve this layout when adding project-scoped skills or guidance.

## Issue tracking

Work items live in **`bd` (beads)** in an embedded-dolt store at `.beads/`, isolated from the gc supervisor — these beads are **not** in the dashboard's own `/api/beads` view, and `.beads/` has no Dolt remote yet, so bead state is local-only. Anything that outlives the current task goes in `bd` (`bd ready` / `show` / `update --claim` / `close`), not scattered TODO comments.

## Architecture Best Practices

These apply to all code in this project — frontend and server:

- **TDD (Test-Driven Development)** - write the tests first; the implementation
  code isn't done until the tests pass.
- **Consider First Principles** to assess your current architecture against the
  one you'd use if you started over from scratch.
- **Leverage Types** using statically typed languages (TypeScript, Rust, etc) so
  that we can leverage the power of the compiler as guardrails and immediate
  feedback on our code at build-time instead of waiting until run-time.
- **DRY (Don’t Repeat Yourself)** – eliminate duplicated logic by extracting
  shared utilities and modules.
- **Separation of Concerns** – each module should handle one distinct
  responsibility.
- **Single Responsibility Principle (SRP)** – every class/module/function/file
  should have exactly one reason to change.
- **Clear Abstractions & Contracts** – expose intent through small, stable
  interfaces and hide implementation details.
- **Low Coupling, High Cohesion** – keep modules self-contained, minimize
  cross-dependencies.
- **Scalability & Statelessness** – design components to scale horizontally and
  prefer stateless services when possible.
- **Observability & Testability** – build in logging, metrics, tracing, and
  ensure components can be unit/integration tested.
- **KISS (Keep It Simple, Sir)** - keep solutions as simple as possible.
- **YAGNI (You're Not Gonna Need It)** – avoid speculative complexity or
  over-engineering.
- **Don't Swallow Errors** by catching exceptions, silently filling in required
  but missing values, masking deserialization with nulls (or undefined values)
  or empty lists, or
  ignoring timeouts when something hangs. All of those are errors (client-side
  and server-side) and must be tracked in a centralized log so it can be used to
  improve the app over time. Also, inform the user as appropriate so that they
  can take necessary action.
- **No Placeholder Code** - we're building production code here, not toys.
- **No Comments for Removed Functionality** - the source is not the place to
  keep history of what's changed; it's the place to implement the current
  requirements only.
- **Layered Architecture** - organize code into clear tiers where each layer
  depends only on the one(s) below it, keeping logic cleanly separated.
- **Use Non-Nullable Variables** when possible; use nullability only when there
  is NO other possiblity.
- **Use Async Notifications** when possible over inefficient polling.
- **Eliminate Race Conditions** that might cause dropped or corrupted data
- **Write for Maintainability** so that the code is clear and readable and easy
  to maintain by future developers.
- **Arrange Project Idiomatically** for the language and framework being used,
  including recommended lints, static analysis tools, folder structure and
  gitignore entries.
- **Keep Serialization/Deserialization At The Edges** to make full use of
  type-safe objects in the app itself and to centralize error handling for
  type-system translation. Do NOT allow untyped data with known shapes to flow
  through the system and subvert the type system.
- **Prefer Well-Known, High Quality OSS Libraries** instead of hand-rolling your
  own behavior to get more robust, better maintained and better tested results.
- **Treat Static Warnings And Info As Errors To Be Fixed**. The whole point of
  static checking (linting, compilers, etc) is that they surface issues at
  build-time so that they can be fixed now instead of lead to errors at runtime.
  Take advantage of that feedback to fix those errors!
- **Use Centralized Semantic Constant Values** using enums and constants instead
  of spreading magic numbers through-out the code.
