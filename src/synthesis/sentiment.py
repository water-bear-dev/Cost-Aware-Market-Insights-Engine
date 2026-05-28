import re
from typing import Any, Dict, List

import httpx
import structlog
import yfinance as yf

from src.config import settings

logger = structlog.get_logger(__name__)

# Standard financial lexical words for scoring
POSITIVE_WORDS = {
    "buy", "bull", "bullish", "long", "growth", "undervalued", "breakout",
    "high", "gain", "positive", "good", "strong", "beat", "calls", "moon",
    "rally", "upgrade", "outperform", "profit", "earnings", "revenue", "surge",
    "record", "dividend", "catalyst", "momentum"
}

NEGATIVE_WORDS = {
    "sell", "bear", "bearish", "short", "drop", "fall", "negative", "bad",
    "weak", "miss", "puts", "dump", "crash", "loss", "plunge", "downgrade",
    "underperform", "debt", "risk", "decline", "slide", "shrink", "threat",
    "lawsuit", "investigation", "headwind", "inflation", "pressure"
}


def _score_texts(texts: List[str]) -> Dict[str, Any]:
    """Lexical score normalized between -1.0 and 1.0."""
    total_pos = 0
    total_neg = 0

    for text in texts:
        words = re.findall(r"\b\w+\b", text.lower())
        for word in words:
            if word in POSITIVE_WORDS:
                total_pos += 1
            elif word in NEGATIVE_WORDS:
                total_neg += 1

    total_matches = total_pos + total_neg
    score = 0.0 if total_matches == 0 else (total_pos - total_neg) / total_matches
    return {"score": round(score, 4), "pos": total_pos, "neg": total_neg}


def _label_for_score(score: float) -> str:
    if score > 0.12:
        return "Bullish"
    if score < -0.12:
        return "Bearish"
    return "Neutral"


def _fetch_reddit_texts(clean_ticker: str) -> Dict[str, Any]:
    texts: List[str] = []
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }
    try:
        url = (
            "https://www.reddit.com/r/wallstreetbets/search.json"
            f"?q={clean_ticker}&restrict_sr=1&sort=new&limit=15"
        )
        with httpx.Client(timeout=6.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code != 200:
                return {"ok": False, "texts": [], "error": f"status={resp.status_code}"}
            data = resp.json()
            children = data.get("data", {}).get("children", [])
            for child in children:
                post_data = child.get("data", {})
                title = post_data.get("title", "")
                selftext = post_data.get("selftext", "")
                texts.append(f"{title} {selftext}".strip())
        logger.info("Fetched Reddit sentiment data", ticker=clean_ticker, posts=len(texts))
        return {"ok": True, "texts": texts, "error": None}
    except Exception as exc:
        logger.warning("Reddit WSB search failed", error=str(exc), ticker=clean_ticker)
        return {"ok": False, "texts": [], "error": str(exc)}


def _fetch_news_texts(ticker: str, headlines: List[str] | None) -> Dict[str, Any]:
    texts: List[str] = []
    if headlines:
        texts.extend([h for h in headlines if h])
        return {"ok": True, "texts": texts, "error": None}

    try:
        t_obj = yf.Ticker(ticker)
        for n in t_obj.news[:5]:
            content = n.get("content") or {}
            title = content.get("title") or n.get("title")
            if title:
                texts.append(title)
        return {"ok": True, "texts": texts, "error": None}
    except Exception as exc:
        logger.warning("yfinance news fallback failed", error=str(exc), ticker=ticker)
        return {"ok": False, "texts": [], "error": str(exc)}


def _fetch_x_texts(clean_ticker: str) -> Dict[str, Any]:
    """X source is optional and should degrade gracefully."""
    if not settings.enable_x_sentiment:
        return {"ok": False, "texts": [], "error": "x_sentiment_disabled"}
    if not settings.x_bearer_token:
        return {"ok": False, "texts": [], "error": "x_bearer_token_missing"}

    query = f"(${clean_ticker} OR {clean_ticker}) lang:en -is:retweet"
    url = f"{settings.x_api_base_url}/2/tweets/search/recent"
    headers = {"Authorization": f"Bearer {settings.x_bearer_token}"}
    params = {"query": query, "max_results": settings.x_sentiment_max_results}
    try:
        with httpx.Client(timeout=6.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers, params=params)
            if resp.status_code != 200:
                return {"ok": False, "texts": [], "error": f"status={resp.status_code}"}
            data = resp.json()
            tweets = data.get("data", []) or []
            texts = [t.get("text", "") for t in tweets if t.get("text")]
        logger.info("Fetched X sentiment data", ticker=clean_ticker, posts=len(texts))
        return {"ok": True, "texts": texts, "error": None}
    except Exception as exc:
        logger.warning("X sentiment fetch failed", error=str(exc), ticker=clean_ticker)
        return {"ok": False, "texts": [], "error": str(exc)}


def _build_source_payload(name: str, source_result: Dict[str, Any]) -> Dict[str, Any]:
    texts = source_result.get("texts", []) or []
    score_meta = _score_texts(texts)
    score = float(score_meta["score"])
    return {
        "name": name,
        "ok": bool(source_result.get("ok", False)),
        "volume": len(texts),
        "score": round(score, 2),
        "label": _label_for_score(score),
        "error": source_result.get("error"),
    }


def analyze_lexical_sentiment(ticker: str, headlines: list = None) -> dict:
    """
    Computes lexical sentiment by combining Reddit, news, and optional X source.
    Returns backward-compatible fields plus detailed source diagnostics.
    """
    clean_ticker = ticker.split(".")[0].upper()  # strip exchange suffix like .AX or .L
    headline_list = headlines if isinstance(headlines, list) else None

    reddit_result = _fetch_reddit_texts(clean_ticker)
    news_result = _fetch_news_texts(ticker, headline_list)
    x_result = _fetch_x_texts(clean_ticker)

    source_payloads = {
        "reddit": _build_source_payload("reddit", reddit_result),
        "news": _build_source_payload("news", news_result),
        "x": _build_source_payload("x", x_result),
    }

    weighted_sum = 0.0
    total_weight = 0
    successful_scores: List[float] = []
    errors: List[str] = []
    total_volume = 0

    for source_name, payload in source_payloads.items():
        volume = int(payload.get("volume", 0))
        score = float(payload.get("score", 0.0))
        ok = bool(payload.get("ok", False))
        total_volume += volume
        if ok and volume > 0:
            weighted_sum += score * volume
            total_weight += volume
            successful_scores.append(score)
        if payload.get("error"):
            errors.append(f"{source_name}:{payload['error']}")

    aggregate_score = weighted_sum / total_weight if total_weight > 0 else 0.0
    aggregate_label = _label_for_score(aggregate_score)

    divergence = False
    if len(successful_scores) >= 2:
        divergence = (max(successful_scores) - min(successful_scores)) >= 0.5

    # Confidence increases with sample size but is dampened by divergence.
    base_conf = min(1.0, total_volume / 20.0)
    confidence = round(base_conf * (0.65 if divergence else 1.0), 2)

    return {
        "sentiment_score": round(aggregate_score, 2),
        "sentiment_label": aggregate_label,
        "social_volume": total_volume,
        "sources": source_payloads,
        "divergence": divergence,
        "confidence": confidence,
        "errors": errors,
    }
