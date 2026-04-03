# Skidaway NUC Server — Reference Guide

Your always-on Linux server running in the Ubiquiti network rack.

---

## Quick Reference

| Item | Value |
|------|-------|
| **OS** | Ubuntu 24.04.4 LTS |
| **IP** | 192.168.1.159 (DHCP reserved in UniFi) |
| **User** | jarrett |
| **SSH** | `ssh jarrett@192.168.1.159` |
| **CPU/RAM** | Intel NUC, ~8GB RAM |
| **Disk** | 97.87GB (6.5% used) |

---

## What's Running

Three systemd services run 24/7:

| Service | Purpose | Port |
|---------|---------|------|
| `xvfb` | Virtual display for IB Gateway (headless GUI) | Display :1 |
| `ibgateway` | Interactive Brokers Gateway (paper trading) | 4002 |
| `skidaway-bot` | Python trading bot (scans flow, executes trades) | — |

All auto-start on boot and auto-restart on crash.

---

## Daily Commands

```bash
# SSH in from any machine on your network
ssh jarrett@192.168.1.159

# Check all services
sudo systemctl status skidaway-bot ibgateway xvfb

# Watch bot logs in real-time
journalctl -u skidaway-bot -f

# Restart the bot (after code changes)
cd ~/skidawaytrading && git pull
sudo systemctl restart skidaway-bot

# Restart IB Gateway (if connection drops)
sudo systemctl restart ibgateway
sleep 30
sudo systemctl restart skidaway-bot

# Stop everything
sudo systemctl stop skidaway-bot ibgateway xvfb

# View last 100 log lines
journalctl -u skidaway-bot -n 100 --no-pager

# Check if IBKR port is listening
ss -tlnp | grep 4002

# Check disk space
df -h /

# Check memory
free -h

# Check temperature
cat /sys/class/thermal/thermal_zone0/temp
# (divide by 1000 for Celsius)
```

---

## File Locations

| Path | Contents |
|------|----------|
| `~/skidawaytrading/` | Git repo (bot + web + supabase migrations) |
| `~/skidawaytrading/.env` | API keys (Supabase, Anthropic, UW, IBKR) |
| `~/skidawaytrading/bot/` | Python trading bot |
| `~/skidawaytrading/bot/venv/` | Python virtual environment |
| `~/ibc/` | IBC auto-login manager for IB Gateway |
| `~/ibc/config.ini` | IBC config (IBKR credentials, trading mode) |
| `~/ibc/logs/` | IBC/Gateway logs |
| `~/Jts/` | IB Gateway install (symlinked) |
| `/usr/local/ibgateway/` | IB Gateway application files |
| `/etc/systemd/system/xvfb.service` | Xvfb service file |
| `/etc/systemd/system/ibgateway.service` | IB Gateway service file |
| `/etc/systemd/system/skidaway-bot.service` | Trading bot service file |

---

## Network Setup

- **Router**: Ubiquiti (UniFi controller)
- **Connection**: Hardwired ethernet in network rack
- **IP reservation**: 192.168.1.159 fixed in UniFi DHCP settings
- **SSH**: Port 22 (default)

To access from outside your home network, install [Tailscale](https://tailscale.com):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

---

## Using Claude Code on the NUC

Claude Code is installed and can run commands for you:

```bash
ssh jarrett@192.168.1.159
claude
```

Then ask it to do things like "restart the bot", "check the logs", "update the code", etc.
Note: sudo requires passwordless sudo to be configured (currently enabled via `/etc/sudoers.d/jarrett`).

---

## Updating the Bot

When new code is pushed to GitHub:

```bash
ssh jarrett@192.168.1.159
cd ~/skidawaytrading
git pull
sudo systemctl restart skidaway-bot
```

Or set up auto-updates (runs daily at 8am ET, weekdays only):
```bash
crontab -e
# Add this line:
0 12 * * 1-5 cd /home/jarrett/skidawaytrading && git pull && sudo systemctl restart skidaway-bot
```
(12 UTC = 8am ET)

---

## Other Things You Can Run

This server is capable of much more than just the trading bot. Some ideas:

### AdGuard Home (network-wide ad blocker)
```bash
curl -s -S -L https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/master/scripts/install.sh | sh -s -- -v
```
Then set the NUC's IP as your DNS server in UniFi controller. Every device on your network blocks ads.

### Tailscale (access from anywhere)
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Free VPN — SSH into the NUC from anywhere in the world.

### Uptime Kuma (monitoring dashboard)
```bash
sudo apt install -y docker.io
sudo docker run -d --restart=always -p 3001:3001 louislam/uptime-kuma
```
Visit http://192.168.1.159:3001 — monitor your Vercel dashboard, Supabase, and bot uptime.

### File sharing (Samba)
```bash
sudo apt install -y samba
```
Share folders on your network — access from Windows File Explorer.

### Grafana (pretty dashboards)
```bash
sudo apt install -y docker.io
sudo docker run -d --restart=always -p 3000:3000 grafana/grafana
```
Visit http://192.168.1.159:3000 — connect to Supabase and build custom trading dashboards.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Can't SSH in | Check cable, ping 192.168.1.159, verify UniFi shows device |
| Bot shows offline on dashboard | `sudo systemctl restart skidaway-bot` |
| IB Gateway won't connect | `sudo systemctl restart ibgateway`, wait 30s, restart bot |
| "Connection refused" on port 4002 | IB Gateway isn't running: `sudo systemctl status ibgateway` |
| Disk full | `df -h /` to check, `sudo apt autoremove` to clean |
| High temperature | Check ventilation in rack, `cat /sys/class/thermal/thermal_zone0/temp` |
| Need to change IBKR password | Edit `~/ibc/config.ini`, restart ibgateway |
| Server rebooted (power outage) | Everything auto-starts, but check `sudo dhcpcd eno1` if no network |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  NUC (192.168.1.159) — Ubuntu 24.04                 │
│                                                     │
│  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │ IB Gateway   │  │ Skidaway Trading Bot         │ │
│  │ (port 4002)  │◄─│ - Scans UW flow every 60s    │ │
│  │ Paper acct   │  │ - Claude Haiku screens       │ │
│  │ DU8395165    │  │ - Claude Sonnet analyzes      │ │
│  └──────────────┘  │ - Executes approved trades   │ │
│                    │ - Logs to Supabase            │ │
│                    └──────────────────────────────┘  │
└───────────────────────────┬─────────────────────────┘
                            │ internet
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
   ┌────────────────┐ ┌──────────┐ ┌──────────────┐
   │ Supabase       │ │ Anthropic│ │ Unusual      │
   │ - signals      │ │ Claude   │ │ Whales API   │
   │ - trades       │ │ Haiku    │ │ - flow       │
   │ - positions    │ │ Sonnet   │ │ - congress   │
   │ - ai_activity  │ └──────────┘ │ - sectors    │
   └───────┬────────┘              └──────────────┘
           │
           ▼
   ┌────────────────┐
   │ Vercel         │     ┌─────────────┐
   │ Dashboard      │◄────│ You (phone/ │
   │ skidawaytrading│     │ laptop/     │
   │ .vercel.app    │     │ anywhere)   │
   └────────────────┘     └─────────────┘
```
