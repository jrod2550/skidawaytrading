-- Seed data for Skidaway Trading
-- Note: User profiles are created AFTER users sign up via Supabase Auth.
-- Run this after creating the 3 auth users in Supabase Dashboard.

-- Insert default bot configuration
insert into public.bot_config (key, value) values
  ('risk_limits', '{
    "max_position_pct": 5,
    "max_open_positions": 10,
    "daily_loss_pct": 3,
    "weekly_loss_pct": 7,
    "max_portfolio_delta": 500,
    "min_portfolio_theta": -200,
    "min_confidence_score": 70,
    "position_stop_loss_pct": 30,
    "position_take_profit_pct": 100
  }'::jsonb),
  ('bot_mode', '"manual_review"'::jsonb),
  ('bot_paused', 'false'::jsonb),
  ('watched_representatives', '["Pelosi", "Tuberville", "Crenshaw", "Ossoff"]'::jsonb);
