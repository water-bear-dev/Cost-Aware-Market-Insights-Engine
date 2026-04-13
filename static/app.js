let portfolioChartInstance = null;
const sparklineInstances = {};

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initDashboard();
    setupTickerForm();
});

function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Add active
            btn.classList.add('active');
            const target = btn.getAttribute('data-tab');
            document.getElementById(target).classList.add('active');
        });
    });
}

function setupTickerForm() {
    const btn = document.getElementById('add-ticker-btn');
    const input = document.getElementById('new-ticker-input');
    const status = document.getElementById('ticker-status');

    btn.addEventListener('click', async () => {
        const val = input.value.trim();
        if (!val) return;
        
        btn.disabled = true;
        btn.textContent = "Tracking...";
        status.textContent = "";

        try {
            const res = await fetch('/api/v1/tickers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticker: val })
            });

            const data = await res.json();
            if (res.ok) {
                status.textContent = `Successfully added ${val.toUpperCase()}`;
                status.style.color = "var(--positive)";
                input.value = "";
                // Force an immediate UI refresh
                await fetchMarketAndInsights();
            } else {
                status.textContent = data.detail || "Failed to add ticker";
                status.style.color = "var(--negative)";
            }
        } catch (e) {
            status.textContent = "Network error";
            status.style.color = "var(--negative)";
        } finally {
            btn.disabled = false;
            btn.textContent = "Track Ticker";
            setTimeout(() => { status.textContent = ""; }, 5000);
        }
    });
}

async function initDashboard() {
    await fetchHealth();
    
    // Initial fetch
    fetchCosts();
    fetchDashboardCosts();
    fetchMarketAndInsights();
    
    // Poll every 15s to catch new dynamo records
    setInterval(() => {
        fetchCosts();
        fetchDashboardCosts();
        fetchMarketAndInsights();
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
    } catch (e) {}
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
            if (data.utilization_pct > 80) pBar.classList.add('danger');
            else pBar.classList.remove('danger');
        }
    } catch (e) {}
}

async function fetchDashboardCosts() {
    try {
        const res = await fetch('/api/v1/costs/dashboard');
        if (res.ok) {
            const data = await res.json();
            
            document.getElementById('dashboard-total-7d').textContent = `$${data.metrics.total_7_days_usd.toFixed(4)}`;
            document.getElementById('dashboard-average-7d').textContent = `$${data.metrics.daily_average_usd.toFixed(4)}`;
            document.getElementById('dashboard-projected-30d').textContent = `$${data.metrics.projected_30_days_usd.toFixed(4)}`;
            
            // Dummy Sparklines to simulate trend (normally this would be historical arrays from the API)
            drawSparkline('sparkline-7d', [1, 2, 1.5, 3, 2.5, 4, data.metrics.total_7_days_usd * 100], '#38bdf8');
            drawSparkline('sparkline-avg', [1, 1.5, 1.2, 1.8, 1.5, 1.9, data.metrics.daily_average_usd * 500], '#c084fc');
            drawSparkline('sparkline-30d', [10, 12, 11, 15, 14, 18, data.metrics.projected_30_days_usd * 20], '#10b981');
        }
    } catch (e) {}
}

function drawSparkline(elementId, dataset, color) {
    const container = document.getElementById(elementId);
    if (!container) return;
    
    if (!sparklineInstances[elementId]) {
        container.innerHTML = '<canvas></canvas>';
        const ctx = container.querySelector('canvas').getContext('2d');
        sparklineInstances[elementId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dataset.map((_, i) => i),
                datasets: [{
                    data: dataset,
                    borderColor: color,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false } },
                animation: false
            }
        });
    } else {
        sparklineInstances[elementId].data.datasets[0].data = dataset;
        sparklineInstances[elementId].update();
    }
}

async function fetchMarketAndInsights() {
    try {
        const [marketRes, insightsRes] = await Promise.all([
            fetch('/api/v1/market'),
            fetch('/api/v1/insights')
        ]);
        
        if (marketRes.ok && insightsRes.ok) {
            const marketData = await marketRes.json();
            const insightsData = await insightsRes.json();
            
            document.getElementById('ticker-count').textContent = `${marketData.length}/10 Tracked`;
            
            updatePortfolioChart(marketData);
            renderTradingViewCards(marketData, insightsData);
        }
    } catch (e) {
        console.error("Market & Insights fetch failed", e);
    }
}

function updatePortfolioChart(marketData) {
    const ctx = document.getElementById('portfolioChart').getContext('2d');
    
    // Sort by price descending
    const sorted = [...marketData].sort((a,b) => b.close_price - a.close_price);
    const labels = sorted.map(d => d.ticker);
    const data = sorted.map(d => d.close_price);
    
    if (portfolioChartInstance) {
        portfolioChartInstance.data.labels = labels;
        portfolioChartInstance.data.datasets[0].data = data;
        portfolioChartInstance.update();
    } else {
        portfolioChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Current Price (USD)',
                    data: data,
                    backgroundColor: 'rgba(56, 189, 248, 0.4)',
                    borderColor: 'rgba(56, 189, 248, 1)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#f8fafc' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

function renderTradingViewCards(marketData, insightsData) {
    const container = document.getElementById('insights-container');
    container.innerHTML = '';
    
    // Create a map of insights
    const insightMap = {};
    insightsData.forEach(ind => { insightMap[ind.ticker] = ind; });
    
    marketData.forEach((mkt, index) => {
        const card = document.createElement('div');
        card.className = 'insight-card glass glow-hover';
        card.style.animationDelay = `${index * 0.1}s`;
        
        const insight = insightMap[mkt.ticker];
        const isPositive = mkt.change_pct >= 0;
        const changeColor = isPositive ? 'pill-green' : 'pill-red';
        const sign = isPositive ? '+' : '';
        
        let newsHtml = '<ul class="news-list">';
        if (mkt.headlines && mkt.headlines.length > 0) {
            mkt.headlines.slice(0, 3).forEach(h => {
                newsHtml += `<li>${h}</li>`;
            });
        } else {
            newsHtml += `<li style="color: var(--text-secondary)">No recent headlines found.</li>`;
        }
        newsHtml += '</ul>';
        
        card.innerHTML = `
            <div class="card-header" style="align-items: center">
                <span class="ticker-symbol">${mkt.ticker}</span>
                <span class="model-tag">${insight ? insight.model_used : 'Awaiting Synthesis...'}</span>
            </div>
            
            <div style="margin: 1rem 0;">
                <span style="font-size: 2rem; font-weight: 700;">$${mkt.close_price.toFixed(2)}</span>
                <span class="${changeColor}" style="margin-left: 0.5rem; font-size: 1.1rem;">
                    ${sign}${mkt.change_pct.toFixed(2)}%
                </span>
            </div>
            
            <div style="border-top: 1px solid var(--glass-border); padding-top: 1rem; margin-top: 0.5rem">
                <p class="insight-text" style="font-size: 0.9rem">${insight ? insight.insight_text : 'Awaiting AI Synthesis over market data... this usually runs on the 15-minute cron.'}</p>
            </div>
            
            ${newsHtml}
        `;
        container.appendChild(card);
    });
}
