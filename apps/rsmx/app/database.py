from dataclasses import dataclass


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    service_role_key: str
    anon_key: str = ""


def is_configured(config: SupabaseConfig) -> bool:
    return bool(config.url and config.service_role_key)
