# Skidaway Trading

Multi-signal trading bot and dashboard — congressional trades, unusual options flow, and prediction markets.

## Architecture

- **web/** — Next.js dashboard (TypeScript, Tailwind, shadcn/ui, Supabase Auth)
- **bot/** — Python trading bot (Unusual Whales API, IBKR via ib_insync, APScheduler)
- **supabase/** — Database migrations and seed data

## Setup

1. Create a Supabase project and run migrations in `supabase/migrations/`
2. Copy `.env.example` to `.env` and fill in your keys
3. `cd web && npm install && npm run dev`
4. For the bot: `cd bot && pip install -r requirements.txt && python -m src.main`

## Users

- Jarrett (admin)
- Craig (viewer)
- Jack (viewer)
