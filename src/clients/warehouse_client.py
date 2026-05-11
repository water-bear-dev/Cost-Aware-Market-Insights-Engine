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
        
        if self.use_athena:
            return pd.read_sql(query, self.athena_conn).to_dict(orient="records")
        else:
            if not os.path.exists(self.duckdb_path):
                return []
            with duckdb.connect(self.duckdb_path, read_only=True) as con:
                df = con.execute(query).df()
                # Replace NaN with None for JSON compliance
                return df.replace({float('nan'): None, float('inf'): None, float('-inf'): None}).to_dict(orient="records")

warehouse_client = WarehouseClient()
