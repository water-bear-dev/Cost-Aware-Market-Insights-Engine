import httpx
import re
import structlog
import yfinance as yf

logger = structlog.get_logger(__name__)

# Standard financial lexical words for scoring
POSITIVE_WORDS = {
    'buy', 'bull', 'bullish', 'long', 'growth', 'undervalued', 'breakout', 
    'high', 'gain', 'positive', 'good', 'strong', 'beat', 'calls', 'moon', 
    'rally', 'upgrade', 'outperform', 'profit', 'earnings', 'revenue', 'surge',
    'growth', 'record', 'dividend', 'catalyst', 'momentum'
}

NEGATIVE_WORDS = {
    'sell', 'bear', 'bearish', 'short', 'drop', 'fall', 'negative', 'bad', 
    'weak', 'miss', 'puts', 'dump', 'crash', 'loss', 'plunge', 'downgrade', 
    'underperform', 'debt', 'risk', 'decline', 'slide', 'shrink', 'threat',
    'lawsuit', 'investigation', 'headwind', 'inflation', 'pressure'
}

def analyze_lexical_sentiment(ticker: str, headlines: list = None) -> dict:
    """
    Computes zero-cost lexical sentiment score for a ticker by scanning
    Reddit search results and provided/fetched news headlines.
    """
    social_text = []
    social_volume = 0
    reddit_success = False

    # 1. Fetch from Reddit public endpoints (r/wallstreetbets)
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    clean_ticker = ticker.split('.')[0].upper() # strip exchange suffix like .AX or .L
    
    try:
        url = f"https://www.reddit.com/r/wallstreetbets/search.json?q={clean_ticker}&restrict_sr=1&sort=new&limit=15"
        with httpx.Client(timeout=6.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                children = data.get("data", {}).get("children", [])
                for child in children:
                    post_data = child.get("data", {})
                    title = post_data.get("title", "")
                    selftext = post_data.get("selftext", "")
                    social_text.append(title + " " + selftext)
                    social_volume += 1
                reddit_success = True
                logger.info("Fetched Reddit sentiment data", ticker=ticker, posts=social_volume)
            else:
                logger.warning("Reddit search returned non-200", status_code=resp.status_code, ticker=ticker)
    except Exception as e:
        logger.warning("Reddit WSB search failed", error=str(e), ticker=ticker)

    # 2. Integrate provided or fetched news headlines to enrich the text context
    if headlines:
        for hl in headlines:
            social_text.append(hl)
            social_volume += 1
    else:
        # Fetch news on-the-fly from yfinance as fallback
        try:
            t_obj = yf.Ticker(ticker)
            for n in t_obj.news[:3]:
                content = n.get("content") or {}
                title = content.get("title") or n.get("title")
                if title:
                    social_text.append(title)
                    social_volume += 1
        except Exception as e:
            logger.warning("yfinance news fallback failed", error=str(e), ticker=ticker)

    if not social_text:
        # Default fallback if absolutely nothing is found
        return {
            "sentiment_score": 0.0,
            "sentiment_label": "Neutral",
            "social_volume": 0
        }

    # 3. Lexical scoring
    total_pos = 0
    total_neg = 0
    
    for text in social_text:
        words = re.findall(r'\b\w+\b', text.lower())
        for word in words:
            if word in POSITIVE_WORDS:
                total_pos += 1
            elif word in NEGATIVE_WORDS:
                total_neg += 1
                
    total_matches = total_pos + total_neg
    if total_matches == 0:
        score = 0.0
    else:
        # Score normalized between -1.0 and 1.0
        score = (total_pos - total_neg) / total_matches

    # Map to label
    if score > 0.12:
        label = "Bullish"
    elif score < -0.12:
        label = "Bearish"
    else:
        label = "Neutral"

    return {
        "sentiment_score": round(score, 2),
        "sentiment_label": label,
        "social_volume": social_volume
    }
