import os
import duckdb
import pandas as pd

class WarehouseClient:
    def __init__(self):
        self.use_athena = os.getenv("USE_ATHENA", "false").lower() == "true"
        self.duckdb_path = os.getenv("DUCKDB_PATH", "scratch/qmj_screener.duckdb")
        self.athena_db = os.getenv("ATHENA_DATABASE", "awsdatacatalog.qmj_screener")
        self.s3_staging = os.getenv("S3_DATALAKE_BUCKET", "")
        
        if self.use_athena:
            # Import dynamically to avoid requiring it if not used
            from pyathena import connect
            self.athena_conn = connect(
                s3_staging_dir=f"s3://{self.s3_staging}/athena-results/",
                region_name=os.getenv("AWS_REGION", "us-east-1")
            )

    def get_qmj_screener(self, universe: str = None):
        where_clause = ""
        if universe == 'asx':
            where_clause = "WHERE ticker LIKE '%.AX'"
        elif universe == 'sp500':
            where_clause = "WHERE ticker NOT LIKE '%.AX'"
            
        query = f"""
            SELECT * FROM fct_qmj_screener
            {where_clause}
            ORDER BY report_date DESC, qmj_score DESC
        """
        
        try:
            if self.use_athena:
                df = pd.read_sql(query, self.athena_conn)
            else:
                if not os.path.exists(self.duckdb_path):
                    return []
                with duckdb.connect(self.duckdb_path, read_only=True) as con:
                    df = con.execute(query).df()
            
            if df.empty:
                return []

            # Ensure all required Z-scores are present
            required_z = ['z_prof', 'z_safety', 'z_growth', 'z_value', 'z_mom']
            
            # If any are missing, calculate them dynamically per reporting period
            if not all(col in df.columns for col in required_z):
                # Map internal metrics to their Z-score targets
                mappings = {
                    'profitability': 'z_prof',
                    'leverage': 'z_safety', # Safety is inverse of leverage
                    'growth_yoy': 'z_growth',
                    'valuation': 'z_value',
                    'momentum': 'z_mom'
                }
                
                for metric, z_col in mappings.items():
                    if metric in df.columns:
                        # Group by period to calculate relative Z-scores
                        groups = df.groupby(['reporting_year', 'reporting_quarter'])[metric]
                        avg = groups.transform('mean')
                        std = groups.transform('std')
                        
                        if z_col == 'z_safety':
                            # Inverse leverage: higher is worse, so negative Z
                            df[z_col] = -(df[metric] - avg) / std
                        else:
                            df[z_col] = (df[metric] - avg) / std
                        
                        df[z_col] = df[z_col].fillna(0)
            
            # Recalculate composite QMJ score if we added new factors
            df['qmj_score'] = df[required_z].mean(axis=1)
            
            # Replace NaN/Inf with None for JSON compliance
            return df.replace({float('nan'): None, float('inf'): None, float('-inf'): None}).to_dict(orient="records")
            
        except Exception as e:
            print(f"Screener fetch error: {e}")
            return []

warehouse_client = WarehouseClient()
