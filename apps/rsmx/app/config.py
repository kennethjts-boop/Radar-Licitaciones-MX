from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="RSMX_", extra="ignore")

    PROJECT_NAME: str = "Radar-Social-MX"
    APP_SHORT_NAME: str = "RSmx"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_ANON_KEY: str = ""
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_WEBHOOK_URL: str = ""
    TELEGRAM_DEFAULT_CHAT_ID: str = ""
    ENABLE_TELEGRAM_ALERTS: bool = True
    ENABLE_RSS_COLLECTOR: bool = True
    ENABLE_GDELT_COLLECTOR: bool = True
    ENABLE_OFFICIAL_COLLECTOR: bool = True
    MONITOR_INTERVAL_SECONDS: int = 60
    DEFAULT_MIN_ALERT_SCORE: int = 75
    DEFAULT_REGION: str = "morelos"
    LOG_LEVEL: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
