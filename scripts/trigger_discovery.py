import os
import sys
import structlog
from datetime import datetime

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.dag.discovery_graph import discovery_dag

logger = structlog.get_logger(__name__)

def main():
    logger.info("CLI: Manually triggering Discovery Agent DAG")
    try:
        # Trigger the graph with an empty initial state
        # The first node will populate the universe automatically
        result = discovery_dag.invoke({
            "universe": [],
            "sp500_universe": [],
            "international_universe": [],
            "hidden_gems_universe": [],
            "messages": []
        })
        
        logger.info("Discovery complete", 
                    picks=len(result.get("picks", [])),
                    categories=[p.get("category") for p in result.get("picks", [])])
        
    except Exception as e:
        logger.error("Discovery failed", error=str(e), exc_info=True)

if __name__ == "__main__":
    main()
