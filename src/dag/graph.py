from langgraph.graph import StateGraph, END
from typing import Literal
from src.dag.state import AlphaDagState
from src.dag.nodes import (
    finops_gate_node,
    market_data_node,
    quant_compute_node,
    bedrock_node,
    validation_node
)

def finops_router(state: AlphaDagState) -> Literal["market_data_node", "budget_exceeded"]:
    """Conditional edge: Routes to execution only if budget clears."""
    if state.get("finops_budget_cleared"):
        return "market_data_node"
    return "budget_exceeded"

def budget_exceeded_node(state: AlphaDagState) -> dict:
    """Terminal node if budget is breached."""
    return {"final_insight": "SYSTEM ALERT: Daily AI Budget Exceeded. Generating data-only report."}

def build_graph():
    """Compiles the Alpha-DAG."""
    workflow = StateGraph(AlphaDagState)
    
    # 1. Define nodes
    workflow.add_node("finops_gate", finops_gate_node)
    workflow.add_node("budget_exceeded", budget_exceeded_node)
    workflow.add_node("market_data_node", market_data_node)
    workflow.add_node("quant_compute_node", quant_compute_node)
    workflow.add_node("bedrock_node", bedrock_node)
    workflow.add_node("validation_node", validation_node)
    
    # 2. Define edges
    # Entry point is ALWAYS the FinOps gate
    workflow.set_entry_point("finops_gate")
    
    # FinOps routing
    workflow.add_conditional_edges("finops_gate", finops_router)
    
    # Execution pipeline
    workflow.add_edge("market_data_node", "quant_compute_node")
    workflow.add_edge("quant_compute_node", "bedrock_node")
    workflow.add_edge("bedrock_node", "validation_node")
    
    # Terminal edges
    workflow.add_edge("validation_node", END)
    workflow.add_edge("budget_exceeded", END)
    
    return workflow.compile()

# The compiled singleton instance to be imported by the FastAPI app
alpha_dag = build_graph()
