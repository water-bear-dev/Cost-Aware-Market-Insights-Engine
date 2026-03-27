document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

async function initDashboard() {
    await fetchHealth();
    
    // Initial fetch
    fetchCosts();
    fetchInsights();
    
    // Poll every 15s to catch new dynamo records
    setInterval(() => {
        fetchCosts();
        fetchInsights();
    }, 15000);
}

async function fetchHealth() {
    try {
        const res = await fetch('/api/v1/health');
        if (res.ok) {
            const data = await res.json();
            const dot = document.getElementById('db-health-dot');
            const txt = document.getElementById('db-health-text');
            
            if (data.status === 'healthy') {
                dot.classList.add('healthy');
                txt.textContent = 'System Healthy';
            }
        }
    } catch (e) {
        console.error("Health check failed", e);
    }
}

async function fetchCosts() {
    try {
        const res = await fetch('/api/v1/costs');
        if (res.ok) {
            const data = await res.json();
            
            document.getElementById('budget-total').textContent = `$${data.daily_budget_usd.toFixed(2)}`;
            document.getElementById('budget-spend').textContent = `$${data.current_spend_usd.toFixed(4)}`;
            document.getElementById('budget-remaining').textContent = `$${data.remaining_budget_usd.toFixed(2)}`;
            
            const pBar = document.getElementById('budget-progress');
            pBar.style.width = `${Math.min(data.utilization_pct, 100)}%`;
            
            if (data.utilization_pct > 80) {
                pBar.classList.add('danger');
            } else {
                pBar.classList.remove('danger');
            }
        }
    } catch (e) {
        console.error("Costs fetch failed", e);
    }
}

async function fetchInsights() {
    try {
        const res = await fetch('/api/v1/insights');
        if (res.ok) {
            const data = await res.json();
            
            // Expected list of insights
            if (Array.isArray(data)) {
                document.getElementById('ticker-count').textContent = `${data.length} Tracked`;
                
                const container = document.getElementById('insights-container');
                container.innerHTML = ''; // clear previous
                
                data.forEach((insight, index) => {
                    const card = document.createElement('div');
                    card.className = 'insight-card glass';
                    card.style.animationDelay = `${index * 0.1}s`;
                    
                    // Parse if the insight mocked text has real market logic attached
                    // We can just dump the raw text as well
                    const timeStr = new Date(insight.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    
                    card.innerHTML = `
                        <div class="card-header">
                            <span class="ticker-symbol">${insight.ticker}</span>
                            <span class="model-tag">${insight.model_used}</span>
                        </div>
                        <p class="insight-text">${insight.insight_text}</p>
                        <div class="card-footer">
                            <span>Tokens: ${insight.input_tokens + insight.output_tokens}</span>
                            <span>Gen: ${timeStr}</span>
                        </div>
                    `;
                    container.appendChild(card);
                });
            }
        }
    } catch (e) {
        console.error("Insights fetch failed", e);
    }
}
