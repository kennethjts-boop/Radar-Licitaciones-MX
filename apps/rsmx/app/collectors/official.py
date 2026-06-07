from app.models.schemas import RawItem


def collect_official_items(configured_sources: list[dict[str, str]]) -> list[RawItem]:
    # Official sources are intentionally configuration-driven to avoid invasive collection.
    return [
        RawItem(
            source_id=source["id"],
            source_name=source["name"],
            title=source.get("latest_title", ""),
            url=source.get("url"),
            text=source.get("latest_text", ""),
            raw_payload=source,
        )
        for source in configured_sources
        if source.get("latest_title")
    ]
