import yfinance as yf
ticker_list = ["AMZN", "MSFT", "AAPL"]
for symbol in ticker_list:
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period="5d")
        print(f"{symbol} history: {len(hist)} rows")
        if hist.empty:
            print(f"{symbol} info: {t.info.get('regularMarketPrice')}")
    except Exception as e:
        print(f"{symbol} error: {str(e)}")
