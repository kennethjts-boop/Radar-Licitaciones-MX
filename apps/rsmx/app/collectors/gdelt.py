from app.models.schemas import RawItem


async def collect_gdelt_items(query: str = "morelos bloqueo OR incendio OR seguridad") -> list[RawItem]:
    import httpx

    url = "https://api.gdeltproject.org/api/v2/doc/doc"
    params = {
        "query": query,
        "mode": "ArtList",
        "format": "json",
        "maxrecords": "25",
        "sort": "HybridRel",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()

    return [
        RawItem(
            source_id="gdelt",
            source_name="GDELT",
            title=article.get("title", ""),
            url=article.get("url"),
            text=article.get("seendate", ""),
            raw_payload=article,
        )
        for article in payload.get("articles", [])
    ]
