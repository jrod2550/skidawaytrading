from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_service_role_key: str

    # Unusual Whales
    uw_api_key: str
    uw_base_url: str = "https://api.unusualwhales.com"
    uw_websocket_url: str = "wss://feed.unusualwhales.com"

    # IBKR TWS Gateway
    ibkr_host: str = "127.0.0.1"
    ibkr_port: int = 4002  # 4001=live, 4002=paper
    ibkr_client_id: int = 1

    # Bot
    bot_mode: str = "manual_review"  # manual_review | semi_auto | full_auto
    poll_interval_seconds: int = 60
    congressional_poll_minutes: int = 30
    log_level: str = "INFO"

    model_config = {"env_file": "../.env", "env_file_encoding": "utf-8"}


settings = Settings()  # type: ignore[call-arg]
