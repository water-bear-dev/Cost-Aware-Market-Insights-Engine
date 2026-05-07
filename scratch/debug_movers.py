import yfinance as yf
import pandas as pd

MOVERS_UNIVERSE = ["AAPL", "MSFT", "GOOGL"]
data = yf.download(MOVERS_UNIVERSE, period="2d", interval="1d", progress=False, group_by="ticker", auto_adjust=True)

print("Columns:", data.columns)
print("Type of columns:", type(data.columns))

for sym in MOVERS_UNIVERSE:
    if isinstance(data.columns, pd.MultiIndex):
        # When group_by="ticker", the top level is ticker, second level is metric (Close, Open, etc.)
        if sym in data.columns.levels[0]:
            prices = data[sym]["Close"].dropna()
            print(f"{sym} prices:\n", prices)
    else:
        # If only one ticker, it's not a MultiIndex usually, but with group_by="ticker" it might still be
        print(f"{sym} not in multi-index")
