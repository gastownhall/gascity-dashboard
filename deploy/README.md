# Deploying gas-city-dashboard

Single-user, localhost-only systemd user unit. Designed to **outlive gc-supervisor outages** — the dashboard is exactly what you want open when gc is misbehaving, so it must not be `gc-supervisor`-managed.

The unit file ([`gas-city-dashboard.service`](gas-city-dashboard.service)) uses systemd's `%h` substitution so the same file works on any operator's host when installed under `systemctl --user`. It expects the repo at `~/gascity-dashboard` (the `gastownhall/gascity-dashboard` clone default). If yours lives elsewhere, repoint the `WorkingDirectory` / `ExecStart` / `Environment=` / `ReadWritePaths` paths before installing.

The start-critical paths are asserted by `ExecStartPre` and fail the start **loudly**, naming what they could not reach: the checkout (`WorkingDirectory`, via systemd's `200/CHDIR`), the interpreter (`node`, off the unit's `PATH`), the backend build output (`backend/dist/server.js`), and the frontend bundle the UI is served from (`ADMIN_FRONTEND_DIST`). The remaining `Environment=` paths are **not** checked at start and degrade later if mis-set, so get them right by hand: `GC_CITY_PATH` (in-app `gc bd` writes fail — see the comment on that line), `ADMIN_AUDIT_LOG_PATH` (audit rows are dropped and logged per-write; start is unaffected), and a wrong `ReadWritePaths` entry (systemd silently skips a missing bind path, so a later write hits a read-only filesystem). A mistake in those three will not stop the unit.

The unit runs `node` off its own `Environment=PATH` (`~/.local/bin` first, then the system paths) rather than a hard-coded interpreter location, because a systemd user service does not inherit your login shell's `PATH`. If your Node lives outside those directories — nvm, fnm, and asdf all keep theirs under their own roots — add it to that `Environment=PATH` line.

## One-time install

```bash
# 1. Build everything
cd ~/gascity-dashboard
npm install
npm run build

# 2. Link the unit into the user-level systemd dir
mkdir -p ~/.config/systemd/user
cp deploy/gas-city-dashboard.service ~/.config/systemd/user/

# 3. Enable + start
systemctl --user daemon-reload
systemctl --user enable --now gas-city-dashboard.service
```

Browse to <http://127.0.0.1:8082>.

## Updating

```bash
cd ~/gascity-dashboard
git pull
npm install
npm run build

# Re-copy the unit and reload systemd's view of it. Without this, systemd keeps
# running the OLD installed unit, so any unit-file change upstream never takes
# effect on restart.
cp deploy/gas-city-dashboard.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart gas-city-dashboard.service
```

## Diagnostics

```bash
systemctl --user status gas-city-dashboard.service
journalctl --user -u gas-city-dashboard.service -f
ss -tln 'sport = :8082'                       # port-in-use check
curl -fsS http://127.0.0.1:8082/api/health    # smoke test
```

## Kill switch

```bash
ADMIN_DASHBOARD_DISABLED=1 systemctl --user start gas-city-dashboard.service
# → the service refuses to bind the listener; clean exit.
```

For permanent disable: `systemctl --user disable --now gas-city-dashboard.service`.

## Notes

- Bound to `127.0.0.1:8082` only (not `0.0.0.0`); see [`../specs/architecture/security.md`](../specs/architecture/security.md) for the DNS-rebinding posture.
- A `gc-supervisor` outage takes the dashboard's live data with it; the dashboard SHELL stays up (renders the cached / empty state) until supervisor returns.
- Audit log is appended to `~/.gc/events.jsonl` by default — durable channel that survives dolt-hq corruption. Override with `ADMIN_AUDIT_LOG_PATH`.
