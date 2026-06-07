import re
import unicodedata


def fold_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", ascii_text.lower()).strip()


def contains_any(text: str, terms: set[str]) -> bool:
    folded = fold_text(text)
    return any(term in folded for term in terms)
