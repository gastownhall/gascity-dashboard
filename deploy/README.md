# Deploying gas-city-dashboard

Single-user, localhost-only systemd user unit. Designed to **outlive gc-supervisor outages** — the dashboard is exactly what you want open when gc is misbehaving, so it must not be `gc-supervisor`-managed.

The unit file ([`gas-city-dashboard.service`](gas-city-dashboard.service)) uses systemd's `%h` substitution so the same file works on any operator's host when installed under `systemctl --user`. It expects the repo at `~/gascity-dashboard` (the `gastownhall/gascity-dashboard` clone default). If yours lives elsewhere, repoint the `WorkingDirectory` / `ExecStart` / `Environment=` / `ReadWritePaths` paths before installing — a wrong path no longer fails silently: the unit's `ExecStartPre` aborts the start with an actionable message instead of a permanently-inactive unit and an empty journal.

The unit runs `node` off its own `Environment=PATH` (`~/.local/bin` first, then the system paths) rather than a hard-coded interpreter location, so a per-user Node install (nvm, fnm, asdf) works without an edit; a systemd user service does not inherit your login shell's `PATH`, which is why the unit states one. If your Node lives outside those directories, add it to that `Environment=PATH` line. As with the repo path, a `node` the unit cannot resolve aborts the start with an actionable message instead of a bare `status=203/EXEC`.

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
