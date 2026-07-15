# Deploying gas-city-dashboard

Single-user, localhost-only systemd user unit. Designed to **outlive gc-supervisor outages** — the dashboard is exactly what you want open when gc is misbehaving, so it must not be `gc-supervisor`-managed.

The unit file ([`gas-city-dashboard.service`](gas-city-dashboard.service)) uses systemd's `%h` substitution so the same file works on any operator's host when installed under `systemctl --user`. It expects the repo at `~/gascity-dashboard` (the `gastownhall/gascity-dashboard` clone default). If yours lives elsewhere, repoint the `WorkingDirectory` / `ExecStart` / `Environment=` / `ReadWritePaths` paths before installing.

Three are asserted at start by `ExecStartPre` and fail **loudly**, naming what they could not reach: the interpreter (`node`, off the unit's `PATH`), the backend build output (`backend/dist/server.js`), and the frontend bundle (`ADMIN_FRONTEND_DIST`). `ADMIN_FRONTEND_DIST` must be an **absolute** path; the start check rejects a relative value. The unit's other `Environment=` values (such as `ADMIN_AUDIT_LOG_PATH`) are **not** asserted at start; if you change one, verify it by hand.

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
ss -tlnp 'src 127.0.0.1:8082'                 # who holds the port we bind
curl -fsS http://127.0.0.1:8082/api/health    # smoke test
```

## Stopping it

```bash
systemctl --user stop gas-city-dashboard.service            # until next start
systemctl --user disable --now gas-city-dashboard.service   # permanently
```

## Notes

- Bound to `127.0.0.1:8082` only (not `0.0.0.0`); see [`../specs/architecture/security.md`](../specs/architecture/security.md) for the DNS-rebinding posture.
- A `gc-supervisor` outage takes the dashboard's live data with it; the dashboard SHELL stays up (renders the cached / empty state) until supervisor returns.
- Audit log is appended to `~/.gc/events.jsonl` by default — durable channel that survives dolt-hq corruption. Override with `ADMIN_AUDIT_LOG_PATH`.
