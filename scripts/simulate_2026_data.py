import os
import json
import random
from datetime import datetime

# Import ticker lists
from seed_universes import TOKYO_TICKERS, HANGSENG_TICKERS, DAX_TICKERS, FTSE_TICKERS

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BRONZE_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "scratch", "bronze", "financials")

def get_exchange_and_info(symbol):
    if symbol in TOKYO_TICKERS:
        return "TSE", "Tokyo Stock", "Technology" if random.choice([True, False]) else "Consumer Defensive"
    elif symbol in HANGSENG_TICKERS:
        return "HKG", "Hong Kong Stock", "Financial Services" if random.choice([True, False]) else "Technology"
    elif symbol in DAX_TICKERS:
        return "GER", "German Stock", "Industrials" if random.choice([True, False]) else "Healthcare"
    elif symbol in FTSE_TICKERS:
        return "LSE", "UK Stock", "Energy" if random.choice([True, False]) else "Financial Services"
    return "Unknown", "Global Stock", "Conglomerate"

def create_mock_history(symbol):
    exchange, name_prefix, sector = get_exchange_and_info(symbol)
    company_name = f"{name_prefix} {symbol.split('.')[0]} Corp"
    
    # Financial parameters
    base_revenue = random.randint(10, 100) * 1_000_000_000
    base_assets = base_revenue * random.uniform(1.2, 2.5)
    base_equity = base_assets * random.uniform(0.3, 0.6)
    base_debt = base_equity * random.uniform(0.4, 0.9)
    market_cap = base_equity * random.uniform(1.5, 4.0)
    momentum = random.uniform(-15.0, 45.0)
    
    records = []
    years = [2024, 2025, 2026]
    for i, year in enumerate(years):
        multiplier = 1.0 + (i * random.uniform(0.02, 0.08)) # modest growth
        rev = base_revenue * multiplier
        gp = rev * random.uniform(0.35, 0.55)
        ni = rev * random.uniform(0.08, 0.15)
        assets = base_assets * multiplier
        equity = base_equity * multiplier
        debt = base_debt * random.uniform(0.95, 1.05)
        ocf = ni * random.uniform(1.1, 1.4)
        
        records.append({
            "ticker": symbol,
            "company_name": company_name,
            "exchange": exchange,
            "industry": f"Representative {sector}",
            "sector": sector,
            "market_cap": int(market_cap * multiplier),
            "momentum": momentum,
            "report_date": f"{year}-03-31T00:00:00",
            "net_income": round(ni, 2),
            "gross_profit": round(gp, 2),
            "total_revenue": round(rev, 2),
            "total_assets": round(assets, 2),
            "total_equity": round(equity, 2),
            "total_debt": round(debt, 2),
            "operating_cash_flow": round(ocf, 2)
        })
    return records

def main():
    os.makedirs(BRONZE_DIR, exist_ok=True)
    print(f"Scanning files in {BRONZE_DIR}...")
    
    # 1. Update existing files to include 2026-03-31 records
    updated_existing = 0
    for filename in os.listdir(BRONZE_DIR):
        if not filename.endswith(".json"):
            continue
        filepath = os.path.join(BRONZE_DIR, filename)
        
        try:
            with open(filepath, "r") as f:
                data = json.load(f)
            
            # Standardize to list
            is_list = isinstance(data, list)
            records = data if is_list else [data]
            
            # Check if 2026 record already exists
            has_2026 = any("2026" in r.get("report_date", "") for r in records)
            if not has_2026 and records:
                # Sort records by date to find the latest
                records.sort(key=lambda r: r.get("report_date", ""))
                latest = records[-1]
                
                # Duplicate the latest and set date to 2026-03-31
                new_record = latest.copy()
                orig_date = latest.get("report_date", "")
                
                # Modulate financial numbers slightly to simulate a new quarter
                growth_factor = random.uniform(1.01, 1.05)
                for field in ["net_income", "gross_profit", "total_revenue", "total_assets", "total_equity", "operating_cash_flow"]:
                    if new_record.get(field) is not None:
                        new_record[field] = round(new_record[field] * growth_factor, 2)
                
                if "T" in orig_date:
                    new_record["report_date"] = "2026-03-31T00:00:00"
                else:
                    new_record["report_date"] = "2026-03-31"
                    
                records.append(new_record)
                
                with open(filepath, "w") as f:
                    json.dump(records, f, indent=2)
                updated_existing += 1
        except Exception as e:
            print(f"Error processing {filename}: {e}")
            
    print(f"Updated {updated_existing} existing files with 2026-03-31 report dates.")

    # 2. Generate records for new universes
    new_tickers = TOKYO_TICKERS + HANGSENG_TICKERS + DAX_TICKERS + FTSE_TICKERS
    created_new = 0
    for symbol in new_tickers:
        filepath = os.path.join(BRONZE_DIR, f"{symbol}.json")
        if not os.path.exists(filepath):
            try:
                records = create_mock_history(symbol)
                with open(filepath, "w") as f:
                    json.dump(records, f, indent=2)
                created_new += 1
            except Exception as e:
                print(f"Error creating {symbol}: {e}")
                
    print(f"Created {created_new} new files for international tickers.")
    print("Simulation complete.")

if __name__ == "__main__":
    main()
