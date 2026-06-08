import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def extract_chat(update: dict) -> dict | None:
    payload = (
        update.get("message")
        or update.get("edited_message")
        or update.get("channel_post")
        or update.get("edited_channel_post")
        or {}
    )
    chat = payload.get("chat")
    if chat:
        return chat

    membership = update.get("my_chat_member") or update.get("chat_member") or {}
    return membership.get("chat")


def main() -> int:
    load_dotenv(PROJECT_ROOT / ".env")

    token = os.getenv("RSMX_TELEGRAM_BOT_TOKEN")
    if not token:
        print("ERROR: RSMX_TELEGRAM_BOT_TOKEN not configured")
        return 1

    url = f"https://api.telegram.org/bot{token}/getUpdates"
    try:
        response = httpx.get(url, timeout=20)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"ERROR: Telegram getUpdates request failed: {exc.__class__.__name__}")
        return 1

    payload = response.json()

    if not payload.get("ok"):
        print("ERROR: Telegram getUpdates returned ok=false")
        return 1

    seen: set[int] = set()
    found = False
    for update in payload.get("result", []):
        chat = extract_chat(update)
        if not chat:
            continue
        chat_id = chat.get("id")
        if chat_id is None or chat_id in seen:
            continue
        seen.add(chat_id)
        found = True
        print(f"chat_id: {chat_id}")
        if chat.get("username"):
            print(f"username: {chat['username']}")
        if chat.get("first_name"):
            print(f"first_name: {chat['first_name']}")

    if not found:
        print("No chat_id found. Send a message to the RSmx bot, then run this script again.")
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
