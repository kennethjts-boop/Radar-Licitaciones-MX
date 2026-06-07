import hashlib

from app.processing.text import fold_text


def build_event_hash(title: str, region: str = "morelos", category: str = "general") -> str:
    canonical = "|".join([fold_text(title), fold_text(region), fold_text(category)])
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def is_duplicate(canonical_hash: str, known_hashes: set[str]) -> bool:
    return canonical_hash in known_hashes
