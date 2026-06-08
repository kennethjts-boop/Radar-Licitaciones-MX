import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MESSAGE = "RSmx Telegram OK. Bot separado funcionando. Alertas automáticas siguen desactivadas."


def main() -> int:
    load_dotenv(PROJECT_ROOT / ".env")

    token = os.getenv("RSMX_TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("RSMX_TELEGRAM_DEFAULT_CHAT_ID")
    alerts_enabled = os.getenv("RSMX_ENABLE_TELEGRAM_ALERTS", "").lower() == "true"

    if not token:
        print("ERROR: RSMX_TELEGRAM_BOT_TOKEN not configured")
        return 1
    if not chat_id:
        print("ERROR: RSMX_TELEGRAM_DEFAULT_CHAT_ID not configured")
        return 1
    if alerts_enabled:
        print("ERROR: RSMX_ENABLE_TELEGRAM_ALERTS must remain false for this audit")
        return 1

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        response = httpx.post(
            url,
            json={
                "chat_id": chat_id,
                "text": MESSAGE,
                "disable_web_page_preview": True,
            },
            timeout=20,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"ERROR: Telegram sendMessage request failed: {exc.__class__.__name__}")
        return 1

    payload = response.json()
    if not payload.get("ok"):
        print("ERROR: Telegram sendMessage returned ok=false")
        return 1

    print("Telegram test message sent: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
