# Skidaway Trading Bot — Linux NUC Setup Guide

Everything you need to get the trading bot running 24/7 on your Linux NUC.

---

## 1. System Basics

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essentials
sudo apt install -y git python3 python3-pip python3-venv unzip wget curl openjdk-17-jre xvfb
```

**Why xvfb?** IB Gateway is a Java GUI app. xvfb gives it a "fake" display so it runs headless.

---

## 2. Clone the Repo

```bash
cd ~
git clone https://github.com/jrod2550/skidawaytrading.git
cd skidawaytrading
```

---

## 3. Python Environment

```bash
cd ~/skidawaytrading/bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install nest_asyncio  # needed for ib_insync on Linux
```

---

## 4. Environment File

Create the `.env` file in the repo root:

```bash
nano ~/skidawaytrading/.env
```

Paste this and fill in your values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://gihsbfpvpzmiiqsxufnl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
UW_API_KEY=your_unusual_whales_key_here
IBKR_HOST=127.0.0.1
IBKR_PORT=4002
IBKR_CLIENT_ID=1
IBKR_USERNAME=your_ibkr_username
IBKR_PASSWORD=your_ibkr_paper_password
BOT_MODE=manual_review
```

**Where to find these:**
- Supabase keys: supabase.com > your project > Settings > API
- Anthropic key: console.anthropic.com > API Keys
- UW key: unusualwhales.com > Account > API
- IBKR credentials: your paper trading login

---

## 5. Install IB Gateway

Download the **stable offline installer** from IBKR:

```bash
cd /tmp
# Download IB Gateway (check ibkr.com for latest version URL)
wget -O ibgateway-stable.sh https://download2.interactivebrokers.com/installers/ibgateway/stable-standalone/ibgateway-stable-standalone-linux-x64.sh
chmod +x ibgateway-stable.sh
sudo ./ibgateway-stable.sh -q  # quiet install
```

IB Gateway installs to `/opt/ibgateway/` or `~/Jts/ibgateway/`.

---

## 6. Install IBC (Auto-Login & Auto-Restart)

IBC handles automatic login to IB Gateway and keeps it running.

```bash
cd /tmp
wget https://github.com/IbcAlpha/IBC/releases/download/3.19.0/IBCLinux-3.19.0.zip
mkdir -p ~/ibc
unzip IBCLinux-3.19.0.zip -d ~/ibc
chmod +x ~/ibc/*.sh
```

### Configure IBC

```bash
nano ~/ibc/config.ini
```

Key settings to change:

```ini
IbLoginId=your_ibkr_username
IbPassword=your_ibkr_paper_password
TradingMode=paper
IbDir=/home/YOUR_USERNAME/Jts
AcceptIncomingConnectionAction=accept
AcceptNonBrokerageAccountWarning=yes
ExistingSessionDetectedAction=primary
```

Replace `YOUR_USERNAME` with your Linux username.

---

## 7. Create Systemd Services

### IB Gateway Service

```bash
sudo nano /etc/systemd/system/ibgateway.service
```

Paste:

```ini
[Unit]
Description=IB Gateway via IBC
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOUR_USERNAME
Environment=DISPLAY=:1
ExecStartPre=/usr/bin/Xvfb :1 -screen 0 1024x768x24 &
ExecStart=/home/YOUR_USERNAME/ibc/gatewaystart.sh -inline
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target
```

### Trading Bot Service

```bash
sudo nano /etc/systemd/system/skidaway-bot.service
```

Paste:

```ini
[Unit]
Description=Skidaway Trading Bot
After=ibgateway.service
Requires=ibgateway.service

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/skidawaytrading/bot
ExecStart=/home/YOUR_USERNAME/skidawaytrading/bot/venv/bin/python -m src.main
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

**Replace `YOUR_USERNAME` in all files above with your actual Linux username.**

### Enable & Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable ibgateway
sudo systemctl enable skidaway-bot
sudo systemctl start ibgateway

# Wait 30 seconds for IB Gateway to fully start
sleep 30

sudo systemctl start skidaway-bot
```

---

## 8. Verify Everything Works

```bash
# Check IB Gateway is running
sudo systemctl status ibgateway

# Check bot is running
sudo systemctl status skidaway-bot

# Watch bot logs live
journalctl -u skidaway-bot -f

# Check IB Gateway logs
journalctl -u ibgateway -f
```

Your dashboard at skidawaytrading.vercel.app should show **Bot: Online** once the bot starts sending heartbeats.

---

## 9. Useful Commands

```bash
# Restart bot (after pulling new code)
cd ~/skidawaytrading && git pull
sudo systemctl restart skidaway-bot

# Restart IB Gateway (if connection drops)
sudo systemctl restart ibgateway
sleep 30
sudo systemctl restart skidaway-bot

# Stop everything
sudo systemctl stop skidaway-bot
sudo systemctl stop ibgateway

# View last 100 lines of bot logs
journalctl -u skidaway-bot -n 100

# Check if IB Gateway port is listening
ss -tlnp | grep 4002
```

---

## 10. Auto-Update (Optional)

To auto-pull the latest code daily at 8am ET:

```bash
crontab -e
```

Add:

```cron
0 8 * * 1-5 cd /home/YOUR_USERNAME/skidawaytrading && git pull && sudo systemctl restart skidaway-bot
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot shows "Connection refused" | IB Gateway isn't running. Check `systemctl status ibgateway` |
| IB Gateway won't start | Check Java: `java -version`. Need OpenJDK 17+ |
| "Could not qualify contract" | IB Gateway not logged in. Check IBC config credentials |
| Bot starts but no signals | Markets may be closed. Check logs for "No flow alerts returned" |
| Dashboard shows "Offline" | Bot isn't sending heartbeats. Check `journalctl -u skidaway-bot -f` |
| xvfb errors | Make sure xvfb is installed: `sudo apt install xvfb` |

---

## Architecture Reminder

```
Your NUC (Linux)                    Cloud
┌─────────────────────┐     ┌──────────────────┐
│ IB Gateway (:4002)  │     │ Supabase (DB)    │
│        ↕            │────▶│ - signals        │
│ Python Trading Bot  │     │ - trades         │
│ - Scans UW flow     │     │ - positions      │
│ - Claude AI analysis│     │ - ai_activity    │
│ - Executes trades   │     └──────────────────┘
└─────────────────────┘              ↕
                              ┌──────────────────┐
                              │ Vercel Dashboard  │
  You (phone/laptop) ───────▶│ skidawaytrading   │
                              │   .vercel.app     │
                              └──────────────────┘
```
