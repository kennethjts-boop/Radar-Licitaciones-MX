from app.models.schemas import RawItem


def collect_rss_items(feeds: list[dict[str, str]]) -> list[RawItem]:
    import feedparser

    items: list[RawItem] = []
    for feed in feeds:
        parsed = feedparser.parse(feed["url"])
        for entry in parsed.entries[:25]:
            items.append(
                RawItem(
                    source_id=feed["id"],
                    source_name=feed["name"],
                    title=getattr(entry, "title", ""),
                    url=getattr(entry, "link", None),
                    text=getattr(entry, "summary", ""),
                    raw_payload=dict(entry),
                )
            )
    return items
