/* =====================================================
   State
   ===================================================== */
let portfolioChartInstance = null;
let modalChartInstance = null;
const sparklineInstances = {};
let currentZoom = 1.0;
let currentModalTicker = null;
let currentPeriod = '1mo';
let currentModalMkt = {};
let currentModalInsight = null;

// Snapshot of last known data for diff-and-patch
let lastMarketData = {};
let lastInsightsData = {};
let dailyPicksData = {};

let currentCurrency = 'USD';
let EXCHANGE_RATES = {
    'USD': { rate: 1.0, symbol: '$' },
    'EUR': { rate: 0.92, symbol: '€' },
    'GBP': { rate: 0.83, symbol: '£' },
    'AUD': { rate: 1.54, symbol: 'A$' },
    'JPY': { rate: 154.0, symbol: '¥' }
};

async function refreshExchangeRates() {
    try {
        const resp = await fetch('/api/v1/meta/rates');
        if (resp.ok) {
            const rates = await resp.json();
            EXCHANGE_RATES = rates;
            console.log('Exchange rates updated:', EXCHANGE_RATES);
            // Re-render if necessary, but usually the first dashboard load happens after this or concurrently
        }
    } catch (e) {
        console.error('Failed to fetch exchange rates, using defaults:', e);
    }
}

function formatExchange(code) {
    if (!code) return '';
    const upper = code.toUpperCase();
    const map = {
        'NMS': 'NASDAQ',
        'NGM': 'NASDAQ',
        'NCM': 'NASDAQ',
        'NYQ': 'NYSE',
        'ASE': 'AMEX',
        'PNK': 'OTC',
        'BTS': 'BATS',
        'ASX': 'ASX',
        'LSE': 'LSE'
    };
    return map[upper] || upper;
}

function formatPrice(value, tickerCurrency = 'USD') {
    if (value === null || value === undefined) return 'N/A';
    
    // 1. Convert Ticker Price -> USD
    const tickerRate = EXCHANGE_RATES[tickerCurrency] ? EXCHANGE_RATES[tickerCurrency].rate : 1.0;
    const usdValue = value / tickerRate;
    
    // 2. Convert USD -> Selected Currency
    const { rate, symbol } = EXCHANGE_RATES[currentCurrency];
    const converted = usdValue * rate;
    
    const decimals = currentCurrency === 'JPY' ? 0 : 2;
    return `${symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function formatLargePrice(value, tickerCurrency = 'USD') {
    if (value === null || value === undefined || value === 0) return '—';
    
    // 1. Convert Ticker Price -> USD
    const tickerRate = EXCHANGE_RATES[tickerCurrency] ? EXCHANGE_RATES[tickerCurrency].rate : 1.0;
    const usdValue = value / tickerRate;
    
    // 2. Convert USD -> Selected Currency
    const { rate, symbol } = EXCHANGE_RATES[currentCurrency];
    const v = usdValue * rate;

    if (v >= 1e12) return `${symbol}${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9)  return `${symbol}${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6)  return `${symbol}${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3)  return `${symbol}${(v / 1e3).toFixed(1)}K`;
    return formatPrice(value, tickerCurrency);
}

/* =====================================================
   Bootstrap
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initControls();
    initModal();
    initDashboard();
    setupTickerForm();
    initCurrency();
    refreshExchangeRates();
    initManageFilters();
});

/* =====================================================
   Tabs
   ===================================================== */
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            if (btn.dataset.tab === 'discover-view') fetchDiscoverData();
        });
    });
}

/* =====================================================
   Control Bars (Manage & Density)
   ===================================================== */
function initControls() {
    const grid = document.getElementById('insights-container');
    const manageBtn = document.getElementById('manage-toggle-btn');
    const managePanel = document.getElementById('manage-panel');

    // Density
    document.querySelectorAll('.density-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.density-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const density = btn.dataset.density;
            grid.className = 'insights-grid';
            if (density !== 'standard') {
                grid.classList.add(`density-${density}`);
            }
        });
    });

    // Manage Panel Toggle
    manageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        managePanel.classList.toggle('open');
        if (managePanel.classList.contains('open')) renderManageList();
    });

    document.addEventListener('click', (e) => {
        if (!managePanel.contains(e.target) && e.target !== manageBtn) {
            managePanel.classList.remove('open');
        }
    });
}

function renderManageList() {
    const list = document.getElementById('manage-list');
    const tickers = Object.keys(lastMarketData).sort();
    
    if (tickers.length === 0) {
        list.innerHTML = '<li style="font-size:0.8rem; color:var(--text-secondary); text-align:center; padding:1rem;">Your watchlist is empty</li>';
        return;
    }

    list.innerHTML = tickers.map(t => `
        <li class="manage-item">
            <span class="manage-item-ticker">${t}</span>
            <button class="manage-item-delete" onclick="handleManageDelete('${t}', this)" title="Remove ${t}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"></path></svg>
            </button>
        </li>
    `).join('');
}

window.handleManageDelete = async (ticker, btn) => {
    btn.disabled = true;
    const success = await deleteTickerLogic(ticker);
    if (success) {
        renderManageList();
        // Remove from UI grid
        const el = document.querySelector(`[data-ticker="${ticker}"]`);
        if (el) {
            el.classList.add('fade-out');
            setTimeout(() => el.remove(), 300);
        }
    } else {
        btn.disabled = false;
    }
};

/* =====================================================
   Currency
   ===================================================== */
function initCurrency() {
    const selector = document.getElementById('currency-selector');
    if (!selector) return;
    
    selector.addEventListener('change', (e) => {
        currentCurrency = e.target.value;
        // Trigger re-render of all price-related elements
        if (Object.keys(lastMarketData).length > 0) {
            patchInsightsGrid(lastMarketData, lastInsightsData);
            updatePortfolioChart(Object.values(lastMarketData));
            fetchCosts();
            fetchDashboardCosts();
            // If modal is open, refresh it
            if (currentModalTicker) {
                renderModalContent(currentModalMkt, currentModalInsight);
            }
        }
    });
}

/* =====================================================
   Ticker Form
   ===================================================== */
function setupTickerForm() {
    const btn = document.getElementById('add-ticker-btn');
    const input = document.getElementById('new-ticker-input');
    const status = document.getElementById('ticker-status');
    const resultsList = document.getElementById('autocomplete-results');

    let debounceTimer;

    const handleSearch = async (query) => {
        if (!query || query.length < 1) {
            resultsList.classList.remove('active');
            return;
        }

        try {
            const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
            if (res.ok) {
                const results = await res.json();
                if (results.length > 0) {
                    resultsList.innerHTML = results.map(r => `
                        <li class="autocomplete-item" data-symbol="${r.symbol}" data-exchange="${r.exchange}">
                            <div class="autocomplete-exchange">${r.exchange}</div>
                            <div class="autocomplete-symbol">${r.symbol}</div>
                            <div class="autocomplete-name">${r.name}</div>
                        </li>
                    `).join('');
                    resultsList.classList.add('active');
                } else {
                    resultsList.classList.remove('active');
                }
            }
        } catch (e) {
            console.error("Autocomplete search failed", e);
        }
    };

    input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => handleSearch(e.target.value.trim()), 300);
    });

    resultsList.addEventListener('click', (e) => {
        const item = e.target.closest('.autocomplete-item');
        if (item) {
            const symbol = item.dataset.symbol;
            const exchange = item.dataset.exchange;
            // The user requested prefix: NASDAQ: AAPL
            input.value = exchange ? `${exchange}: ${symbol}` : symbol;
            resultsList.classList.remove('active');
            input.focus();
        }
    });

    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !resultsList.contains(e.target)) {
            resultsList.classList.remove('active');
        }
    });

    input.addEventListener('keydown', e => { 
        if (e.key === 'Enter') {
            btn.click();
            resultsList.classList.remove('active');
        }
    });

    btn.addEventListener('click', async () => {
        let val = input.value.trim().toUpperCase();
        if (!val) return;

        // Strip exchange prefix if present (e.g. "NASDAQ: AAPL" -> "AAPL")
        if (val.includes(':')) {
            const parts = val.split(':');
            val = parts[parts.length - 1].trim();
        }

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
                status.textContent = `✓ Added ${val}`;
                status.style.color = "var(--positive)";
                input.value = "";
                resultsList.classList.remove('active');
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

/* =====================================================
   Dashboard Init & Polling
   ===================================================== */
async function initDashboard() {
    await fetchHealth();
    fetchCosts();
    fetchDashboardCosts();
    await fetchMarketAndInsights();
    await fetchDailyPicks();

    // Background batch: ensure all tickers have synthesis
    triggerBatchSynthesis();

    // Async background refresh — no UI wipe on each tick
    setInterval(() => {
        fetchCosts();
        fetchDashboardCosts();
        fetchMarketAndInsights();
        fetchDailyPicks();
    }, 15000);
}

async function fetchDailyPicks() {
    const grid = document.getElementById('daily-picks-grid');
    const container = document.getElementById('daily-picks-container');

    try {
        const res = await fetch('/api/v1/daily_picks');
        if (res.ok) {
            const data = await res.json();
            
            if (!data || data.length === 0) {
                // If we're on first load and no data, show a subtle finding state if the container isn't hidden yet
                if (grid.children.length === 0) {
                    grid.innerHTML = `
                        <div class="metric-card glass" style="grid-column: 1 / -1; display: flex; align-items: center; gap: 1rem; padding: 2rem;">
                            <div class="node-pulse" style="position:relative; width:20px; height:20px; border-radius:50%; border:2px solid var(--accent); animation:nodePulse 2s infinite;"></div>
                            <span style="color: var(--text-secondary); font-size: 0.9rem;">The Daily Discovery Agent is currently hunting for hidden gems... check back in 30s.</span>
                        </div>
                    `;
                    container.style.display = 'block';
                }
                return;
            }
            
            container.style.display = 'block';
            data.forEach(p => dailyPicksData[p.actual_ticker] = p);

            // Labels for the 3 rationale bullets
            const bulletLabels = ['📈 What\'s Happening', '💡 Why It\'s Interesting', '👀 What to Watch'];

            grid.innerHTML = data.map(pick => {
                const price = parseFloat(pick.last_price || 0);
                const change5d = parseFloat(pick.change_5d || 0) * 100;
                const momentum1mo = parseFloat(pick.momentum_1mo || 0); // already in %
                const isPos = change5d >= 0;
                const sign = isPos ? '+' : '';
                const changeColor = isPos ? 'var(--positive)' : 'var(--negative)';

                // Build rationale bullets — supports both array (new) and string (legacy)
                let rationaleItems = [];
                if (Array.isArray(pick.rationale)) {
                    rationaleItems = pick.rationale;
                } else if (typeof pick.rationale === 'string') {
                    rationaleItems = pick.rationale.split('\n').map(l => l.replace(/^[-*\d.]+\s*/, '').trim()).filter(Boolean);
                }

                const bulletsHtml = rationaleItems.length
                    ? rationaleItems.slice(0, 3).map((text, i) => `
                        <div style="display: flex; gap: 0.65rem; align-items: flex-start; padding: 0.6rem 0; border-bottom: 1px dashed rgba(255,255,255,0.07);">
                            <div style="min-width: 140px; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); font-weight: 700; padding-top: 2px;">${bulletLabels[i] || '●'}</div>
                            <p style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.55; margin: 0;">${text}</p>
                        </div>`).join('')
                    : `<p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6;">AI synthesis in progress...</p>`;

                const statsHtml = momentum1mo !== 0
                    ? `<div style="display: flex; gap: 0.75rem; margin-top: 0.75rem; flex-wrap: wrap;">
                        <span style="font-size: 0.7rem; background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); padding: 0.2rem 0.5rem; border-radius: 6px; color: var(--text-secondary);">
                            1-Month: <strong style="color: ${momentum1mo >= 0 ? '#10b981' : '#f43f5e'}">${momentum1mo >= 0 ? '+' : ''}${momentum1mo.toFixed(1)}%</strong>
                        </span>
                        <span style="font-size: 0.7rem; background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); padding: 0.2rem 0.5rem; border-radius: 6px; color: var(--text-secondary);">
                            5-Day: <strong style="color: ${changeColor}">${sign}${change5d.toFixed(2)}%</strong>
                        </span>
                       </div>`
                    : '';

                return `
                <div class="metric-card glass glow-hover discovery-pick-card" style="cursor: pointer; display: flex; flex-direction: column; gap: 0; padding: 1.5rem;" onclick="openDailyPickModal('${pick.actual_ticker}')">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <span class="dim-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 600;">${pick.category}</span>
                        <span style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 0.2rem 0.6rem; border-radius: 12px;">Daily Pick</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                        <div style="display: flex; flex-direction: column; align-items: flex-start;">
                            ${pick.exchange ? `<span style="font-size: 0.65rem; color: var(--accent); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">${formatExchange(pick.exchange)}</span>` : ''}
                            <h3 class="metric-value text-gradient-purple" style="font-size: 2rem; line-height: 1.1; letter-spacing: -0.5px; margin: 0;">${pick.actual_ticker}</h3>
                            ${pick.company_name ? `<span style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${pick.company_name}</span>` : ''}
                        </div>
                        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
                            <span style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${formatPrice(price, pick.currency || 'USD')}</span>
                            <button class="glass-btn primary" style="padding: 0.3rem 0.6rem; font-size: 0.7rem; border-radius: 6px; margin-top: 0.75rem;"
                                    onclick="event.stopPropagation(); handleAddFeatured('${pick.actual_ticker}', this)">
                                + Track
                            </button>
                        </div>
                    </div>

                    ${statsHtml}

                    <div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 0.875rem; padding-top: 0.875rem;">
                        ${bulletsHtml}
                    </div>

                    <div style="font-size:0.75rem; color:var(--accent); text-align: right; margin-top: 0.75rem; font-weight: 500;">
                        Deep Dive &rarr;
                    </div>
            </div>
            `;
            }).join('');
        }
    } catch (e) {
        console.error("Daily picks fetch failed", e);
    }
}

window.handleAddFeatured = async (ticker, btn) => {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Adding...";
    
    try {
        const res = await fetch('/api/v1/tickers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: ticker })
        });
        if (res.ok) {
            btn.textContent = "✓ Tracked";
            btn.style.borderColor = "var(--positive)";
            btn.style.color = "var(--positive)";
            await fetchMarketAndInsights();
        } else {
            btn.textContent = "Error";
            setTimeout(() => { btn.disabled = false; btn.textContent = originalText; }, 2000);
        }
    } catch (e) {
        btn.disabled = false;
        btn.textContent = originalText;
    }
};

async function triggerBatchSynthesis() {
    try {
        const [marketRes, insightsRes] = await Promise.all([
            fetch('/api/v1/market'),
            fetch('/api/v1/insights')
        ]);
        if (!marketRes.ok || !insightsRes.ok) return;

        const marketData = await marketRes.json();
        const insightsData = await insightsRes.json();
        const insightMap = {};
        insightsData.forEach(i => { insightMap[i.ticker] = i; });

        const now = Date.now();
        const TEN_MINUTES_MS = 10 * 60 * 1000;

        for (const mkt of marketData) {
            const insight = insightMap[mkt.ticker];
            const hasNoInsight = !insight;
            const isStale = insight && (now - new Date(insight.timestamp).getTime()) > TEN_MINUTES_MS;
            // Also re-synthesize tickers that only have fallback/mock analysis (not real Claude)
            const needsRealAI = insight && (
                insight.model_used === 'data-fallback' ||
                insight.model_used === 'local-mock'
            );

            if (hasNoInsight || isStale || needsRealAI) {
                // Small staggered delay to avoid hammering Bedrock in parallel
                const delay = marketData.indexOf(mkt) * 800;
                setTimeout(() => {
                    fetch(`/api/v2/tickers/${mkt.ticker}/synthesize`, { method: 'POST' })
                        .catch(() => {});
                }, delay);
            }
        }
    } catch (e) {}
}

const activeIngestion = new Set();
const portfolioHistoryCache = {};

async function triggerBatchIngestion(marketData) {
    if (!marketData || marketData.length === 0) return;
    try {
        const pendingTickers = marketData.filter(m => m.status === 'pending_data' && !activeIngestion.has(m.ticker));
        if (pendingTickers.length === 0) return;

        for (let i = 0; i < pendingTickers.length; i++) {
            const mkt = pendingTickers[i];
            activeIngestion.add(mkt.ticker);
            const delay = i * 2000; // 2 seconds between bursts
            setTimeout(() => {
                fetch(`/api/v1/tickers/${mkt.ticker}/ingest`, { method: 'POST' })
                    .then(res => {
                        // Whether it succeeded or failed, clear the active flag so it can retry 
                        // in the next 15s session if it's STILL pending
                        activeIngestion.delete(mkt.ticker);
                    })
                    .catch(() => {
                        activeIngestion.delete(mkt.ticker);
                    });
            }, delay);
        }
    } catch (e) {}
}

/* =====================================================
   Health Check
   ===================================================== */
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

/* =====================================================
   FinOps Data
   ===================================================== */
async function fetchCosts() {
    try {
        const res = await fetch('/api/v1/costs');
        if (res.ok) {
            const data = await res.json();
            document.getElementById('budget-total').textContent = formatPrice(data.daily_budget_usd);
            document.getElementById('budget-spend').textContent = formatPrice(data.current_spend_usd);
            document.getElementById('budget-remaining').textContent = formatPrice(data.remaining_budget_usd);
            
            let breakdownEl = document.getElementById('budget-breakdown');
            if (!breakdownEl) {
                const spendContainer = document.getElementById('budget-spend').parentElement;
                breakdownEl = document.createElement('div');
                breakdownEl.id = 'budget-breakdown';
                breakdownEl.style.fontSize = '0.7rem';
                breakdownEl.style.color = 'var(--text-secondary)';
                breakdownEl.style.marginTop = '0.2rem';
                spendContainer.appendChild(breakdownEl);
            }
            breakdownEl.innerHTML = `AI: ${formatPrice(data.llm_spend_usd)} | Uptime: ${formatPrice(data.infrastructure_spend_usd)}`;
            
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
            document.getElementById('dashboard-total-7d').textContent = formatPrice(data.metrics.total_7_days_usd);
            document.getElementById('dashboard-average-7d').textContent = formatPrice(data.metrics.daily_average_usd);
            document.getElementById('dashboard-projected-30d').textContent = formatPrice(data.metrics.projected_30_days_usd);
            drawSparkline('sparkline-7d', [1,2,1.5,3,2.5,4,data.metrics.total_7_days_usd*100], '#38bdf8');
            drawSparkline('sparkline-avg', [1,1.5,1.2,1.8,1.5,1.9,data.metrics.daily_average_usd*500], '#c084fc');
            drawSparkline('sparkline-30d', [10,12,11,15,14,18,data.metrics.projected_30_days_usd*20], '#10b981');
        }
    } catch (e) {}
}

function drawSparkline(elementId, dataset, color) {
    const container = document.getElementById(elementId);
    if (!container) return;
    if (sparklineInstances[elementId]) {
        // Check if the canvas is still in the DOM
        const existingCanvas = sparklineInstances[elementId].canvas;
        if (!document.body.contains(existingCanvas)) {
            sparklineInstances[elementId].destroy();
            delete sparklineInstances[elementId];
        }
    }

    if (!sparklineInstances[elementId]) {
        container.innerHTML = '<canvas></canvas>';
        const ctx = container.querySelector('canvas').getContext('2d');
        
        // Calculate min/max for zooming
        const minVal = Math.min(...dataset);
        const maxVal = Math.max(...dataset);
        const range = maxVal - minVal;
        const padding = range === 0 ? 1 : range * 0.1;

        sparklineInstances[elementId] = new Chart(ctx, {
            type: 'line',
            data: { labels: dataset.map((_,i) => i), datasets: [{ data: dataset, borderColor: color, borderWidth: 2, pointRadius: 0, tension: 0.4 }] },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { 
                    legend: { display: false }, 
                    tooltip: { enabled: false },
                    datalabels: { display: false } 
                }, 
                scales: { 
                    x: { display: false }, 
                    y: { 
                        display: false,
                        beginAtZero: false,
                        min: minVal - padding,
                        max: maxVal + padding
                    } 
                }, 
                animation: false 
            }
        });
    } else {
        // Update existing chart
        const minVal = Math.min(...dataset);
        const maxVal = Math.max(...dataset);
        const range = maxVal - minVal;
        const padding = range === 0 ? 1 : range * 0.1;
        
        sparklineInstances[elementId].data.datasets[0].data = dataset;
        sparklineInstances[elementId].data.datasets[0].borderColor = color;
        sparklineInstances[elementId].options.scales.y.min = minVal - padding;
        sparklineInstances[elementId].options.scales.y.max = maxVal + padding;
        sparklineInstances[elementId].update('none');
    }
}

/* =====================================================
   Market + Insights — Async Diff Patch
   ===================================================== */
async function fetchMarketAndInsights() {
    try {
        const [marketRes, insightsRes] = await Promise.all([
            fetch('/api/v1/market'),
            fetch('/api/v1/insights')
        ]);
        if (!marketRes.ok || !insightsRes.ok) return;

        const marketArr = await marketRes.json();
        const insightsArr = await insightsRes.json();

        document.getElementById('ticker-count').textContent = `${marketArr.length}/30 Tracked`;

        // Build maps
        const newMarket = {};
        marketArr.forEach(m => { newMarket[m.ticker] = m; });
        const newInsights = {};
        insightsArr.forEach(i => { newInsights[i.ticker] = i; });

        updatePortfolioChart(marketArr);
        patchInsightsGrid(newMarket, newInsights);

        lastMarketData = newMarket;
        lastInsightsData = newInsights;
        
        triggerBatchIngestion(marketArr);

    } catch (e) {
        console.error("Market & Insights fetch failed", e);
    }
}

/* Diff-and-patch: add new cards, update existing, remove deleted */
function patchInsightsGrid(newMarket, newInsights) {
    const container = document.getElementById('insights-container');

    // Remove loading placeholder on first real render
    const placeholder = container.querySelector('.loading-placeholder');
    if (placeholder) placeholder.remove();

    const existingTickers = new Set(
        [...container.querySelectorAll('[data-ticker]')].map(el => el.dataset.ticker)
    );
    const newTickers = new Set(Object.keys(newMarket));

    // Remove cards for deleted tickers
    existingTickers.forEach(ticker => {
        if (!newTickers.has(ticker)) {
            const el = container.querySelector(`[data-ticker="${ticker}"]`);
            if (el) {
                el.classList.add('fade-out');
                setTimeout(() => el.remove(), 300);
            }
        }
    });

    // Update or create cards
    Object.values(newMarket).forEach((mkt, index) => {
        const insight = newInsights[mkt.ticker] || null;
        const existing = container.querySelector(`[data-ticker="${mkt.ticker}"]`);
        if (existing) {
            updateCard(existing, mkt, insight);
        } else {
            const card = buildCard(mkt, insight, index);
            container.appendChild(card);
        }

        if (mkt.sparkline && mkt.sparkline.length > 0) {
            const color = mkt.change_pct >= 0 ? '#10b981' : '#f43f5e';
            drawSparkline(`sparkline-card-${mkt.ticker}`, mkt.sparkline, color);
        }
    });
}

function signalClass(signal) {
    if (!signal) return 'hold';
    return signal.toLowerCase();
}

function statusChip(modelUsed) {
    return '';
}

function buildNewsHtml(mkt) {
    const links = mkt.headline_links || [];
    const headlines = mkt.headlines || [];

    // Use rich links if available, else fall back to bare strings
    if (links.length > 0) {
        const items = links.slice(0, 5);
        let html = '<ul class="news-list">';
        for (const h of items) {
            if (!h.title) continue;
            if (h.url) {
                html += `<li><div><a href="${h.url}" target="_blank" rel="noopener noreferrer">${h.title}</a>${h.source ? `<span class="news-source">${h.source}</span>` : ''}</div></li>`;
            } else {
                html += `<li><div>${h.title}</div></li>`;
            }
        }
        html += '</ul>';
        return html;
    }

    if (headlines.length > 0) {
        let html = '<ul class="news-list">';
        headlines.slice(0, 3).forEach(h => { html += `<li><div>${h}</div></li>`; });
        html += '</ul>';
        return html;
    }

    return `<ul class="news-list"><li style="color:var(--text-secondary)"><div>No recent headlines found.</div></li></ul>`;
}

function buildCard(mkt, insight, index) {
    const wrapper = document.createElement('div');
    wrapper.dataset.ticker   = mkt.ticker;
    wrapper.dataset.company  = mkt.company_name || '';
    wrapper.dataset.exchange = mkt.exchange || '';
    wrapper.dataset.price    = mkt.close_price || 0;
    wrapper.dataset.change   = mkt.change_pct  || 0;
    wrapper.className = 'insight-card';
    wrapper.style.animationDelay = `${index * 0.05}s`;

    const inner = document.createElement('div');
    inner.className = 'glass';
    inner.style.height = '100%';
    inner.innerHTML = cardInnerHtml(mkt, insight);

    // Card body click → open modal
    inner.addEventListener('click', () => {
        openModal(mkt.ticker);
    });

    wrapper.appendChild(inner);
    return wrapper;
}

function updateCard(wrapper, mkt, insight) {
    const inner = wrapper.querySelector('.glass');
    if (!inner) return;
    inner.innerHTML = cardInnerHtml(mkt, insight);
    
    // Update data attributes for filtering/sorting
    wrapper.dataset.price = mkt.close_price || 0;
    wrapper.dataset.change = mkt.change_pct || 0;
    wrapper.dataset.company = mkt.company_name || '';
    wrapper.dataset.exchange = mkt.exchange || '';

    inner.onclick = () => {
        openModal(mkt.ticker);
    };
}

function cardInnerHtml(mkt, insight) {
    // Fix for pending cards with no real data yet
    if (mkt.status === 'pending_data') {
        return `
            <div class="card-header">
                <div class="card-header-left" style="align-items: flex-start;">
                    <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem;">
                        ${mkt.exchange ? `<span style="font-size: 0.6rem; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">${mkt.exchange}</span>` : ''}
                        <span class="ticker-symbol">${mkt.ticker}</span>
                    </div>
                </div>
                ${statusChip(null)}
            </div>
            <div class="price-row" style="display:flex; align-items:center; gap:0.5rem; justify-content:center; padding: 1.5rem 0;">
                <svg class="spinner" viewBox="0 0 50 50" style="width:24px; height:24px; animation:spin 1s linear infinite;">
                    <circle cx="25" cy="25" r="20" fill="none" stroke="var(--accent)" stroke-width="4" stroke-dasharray="31.4 31.4" stroke-linecap="round"></circle>
                </svg>
            </div>
            <p class="insight-text" style="color:var(--text-secondary); text-align:center;">Forcing data ingestion for ${mkt.ticker}...</p>
            <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
        `;
    }

    const isPos = mkt.change_pct >= 0;
    const sign = isPos ? '+' : '';
    const changeClass = isPos ? 'pill-green' : 'pill-red';
    const signal = insight ? insight.signal : null;
    const sClass = signalClass(signal);

    return `
        <div class="card-header">
            <div class="card-header-left">
                ${mkt.exchange ? `<span class="card-exchange">${formatExchange(mkt.exchange)}</span>` : ''}
                <div class="card-ticker-row">
                    <span class="ticker-symbol">${mkt.ticker}</span>
                    ${signal ? `<span class="signal-pill ${sClass}">${signal}</span>` : ''}
                </div>
                ${mkt.company_name ? `<span class="card-company-name">${mkt.company_name}</span>` : ''}
            </div>
            
            <div class="card-sparkline-box">
                <div id="sparkline-card-${mkt.ticker}" class="sparkline-inner"></div>
            </div>

            <div class="card-price-box">
                <span class="card-price">${formatPrice(mkt.close_price, mkt.currency)}</span>
                <span class="${changeClass} card-change">${sign}${mkt.change_pct.toFixed(2)}%</span>
            </div>
        </div>
        <div class="insight-text" style="margin-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.75rem;">
            ${insight ? formatInsight(insight.insight_text, 2) : 'Awaiting AI synthesis — click to view history.'}
            ${insight ? '<div style="font-size:0.7rem; color:var(--accent); margin-top:0.4rem; opacity:0.8;">Click to expand full analysis →</div>' : ''}
        </div>
        ${buildNewsHtml(mkt)}
    `;
}

/* =====================================================
   Delete Ticker
   ===================================================== */
/* =====================================================
   Delete Logic (Unified)
   ===================================================== */
async function deleteTickerLogic(ticker) {
    try {
        const res = await fetch(`/api/v1/tickers/${ticker}`, { method: 'DELETE' });
        if (res.ok) {
            delete lastMarketData[ticker];
            delete lastInsightsData[ticker];
            updatePortfolioChart(Object.values(lastMarketData));
            const total = Object.keys(lastMarketData).length;
            document.getElementById('ticker-count').textContent = `${total}/30 Tracked`;
            return true;
        }
    } catch (e) {
        console.error("Delete failed", e);
    }
    return false;
}

/* =====================================================
   Portfolio Chart
   ===================================================== */
function updatePortfolioChart(marketData) {
    if (!marketData || marketData.length === 0) return;
    const active = [...marketData].filter(m => m.status === 'active');
    if (active.length === 0) return;

    // Build combined 24h area chart from sparkline data
    // Each ticker's sparkline has N price points; sum them all up (converted to selected currency)
    const sparklines = active.map(d => {
        const pts = d.sparkline || [];
        const { rate } = EXCHANGE_RATES[currentCurrency];
        const tickerUsdRate = EXCHANGE_RATES[d.currency] ? EXCHANGE_RATES[d.currency].rate : 1.0;
        // sparkline values are in ticker's native currency → convert to USD → to display currency
        return pts.map(v => (parseFloat(v) / tickerUsdRate) * rate);
    }).filter(s => s.length > 0);

    if (sparklines.length === 0) return;

    const len = Math.max(...sparklines.map(s => s.length));
    const combined = Array.from({ length: len }, (_, i) =>
        sparklines.reduce((sum, s) => sum + (s[i] || s[s.length - 1] || 0), 0)
    );

    // X labels: approximate 15-min intervals going back from now
    const nowMs = Date.now();
    const labels = combined.map((_, i) => {
        const msAgo = (len - 1 - i) * 15 * 60 * 1000;
        return new Date(nowMs - msAgo).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    const { symbol } = EXCHANGE_RATES[currentCurrency];
    const ctx = document.getElementById('portfolioChart').getContext('2d');
    const isPos = combined[combined.length - 1] >= combined[0];
    const lineColor = isPos ? 'rgba(16,185,129,1)' : 'rgba(244,63,94,1)';
    const fillColor = isPos ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)';

    if (portfolioChartInstance) {
        portfolioChartInstance.data.labels = labels;
        portfolioChartInstance.data.datasets[0].data = combined;
        portfolioChartInstance.data.datasets[0].borderColor = lineColor;
        portfolioChartInstance.data.datasets[0].backgroundColor = fillColor;
        portfolioChartInstance.options.scales.y.ticks.callback = v => `${symbol}${v.toFixed(0)}`;
        portfolioChartInstance.options.plugins.tooltip.callbacks.label = c => ` Combined: ${symbol}${c.parsed.y.toFixed(2)}`;
        portfolioChartInstance.update('none');
    } else {
        portfolioChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Portfolio Value',
                    data: combined,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.4,
                    fill: true,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    datalabels: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15,23,42,0.9)',
                        titleColor: '#94a3b8',
                        bodyColor: '#f8fafc',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        callbacks: { label: c => ` Combined: ${symbol}${c.parsed.y.toFixed(2)}` }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
                    y: {
                        beginAtZero: false,
                        ticks: { color: '#94a3b8', callback: v => `${symbol}${v.toFixed(0)}` },
                        grid: { color: 'rgba(255,255,255,0.04)' }
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }
}

/* =====================================================
   Modal
   ===================================================== */
function initModal() {
    const backdrop = document.getElementById('ticker-modal');
    const closeBtn = document.getElementById('modal-close-btn');

    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    document.getElementById('period-selector').addEventListener('click', e => {
        const btn = e.target.closest('.period-btn');
        if (!btn) return;
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        if (currentModalTicker) loadModalChart(currentModalTicker, currentPeriod);
    });
}

function openModal(ticker) {
    currentModalTicker = ticker;
    currentPeriod = '1mo';
    document.querySelectorAll('.period-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === '1mo');
    });

    const mkt     = lastMarketData[ticker]  || {};
    const insight  = lastInsightsData[ticker] || null;
    currentModalMkt    = mkt;
    currentModalInsight = insight;

    renderModalContent(mkt, insight);

    // Load enriched chart + key stats + company info
    loadModalChart(ticker, '1mo');
}

async function openDailyPickModal(ticker) {
    // If it's already in the watchlist, just use openModal normally
    if (lastMarketData[ticker]) {
        openModal(ticker);
        return;
    }
    
    // Otherwise, mock a skeleton and fetch history on-demand
    currentModalTicker = ticker;
    currentPeriod = '1mo';
    document.querySelectorAll('.period-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === '1mo');
    });
    
    currentModalMkt = { ticker: ticker, status: 'pending_data' };
    const pick = dailyPicksData[ticker];
    currentModalInsight = { 
        insight_text: pick ? pick.rationale : 'Fetching full analysis...', 
        model_used: 'discovery-agent', 
        signal: 'WATCH',
        cost_usd: 0 
    };
    
    renderModalContent(currentModalMkt, currentModalInsight);
    await loadModalChart(ticker, '1mo');
}
window.openDailyPickModal = openDailyPickModal;

function renderModalContent(mkt, insight) {
    const ticker = mkt.ticker || currentModalTicker;

    // Header
    document.getElementById('modal-ticker-title').innerHTML = `
        ${mkt.exchange ? `<span style="font-size: 0.75rem; color: var(--accent); display: block; margin-bottom: 2px; letter-spacing: 0.05em;">${formatExchange(mkt.exchange)}</span>` : ''}
        ${ticker}
    `;
    if (!mkt.name) document.getElementById('modal-ticker-name').textContent  = 'Loading company info...';

    // Signal badge
    const signal   = insight ? (insight.signal || 'HOLD') : 'HOLD';
    const sigBadge = document.getElementById('modal-signal-badge');
    sigBadge.className   = `signal-badge ${signal.toLowerCase()}`;
    sigBadge.textContent = signal;

    // Hero stats (price, change, open, high, low)
    renderHeroStats(mkt);

    // AI Insight
    document.getElementById('modal-insight-text').innerHTML =
        insight ? formatInsight(insight.insight_text) : 'No AI synthesis available yet.';
    document.getElementById('modal-insight-meta').textContent =
        insight ? `Model: ${insight.model_used} · Cost: $${(insight.cost_usd||0).toFixed(6)}` : ''; // Keep cost in USD for FinOps accuracy

    // News articles from card data
    renderModalNews(mkt);

    // If we already have info from a previous load, re-render key stats too
    if (mkt.info) {
        renderKeyStats(mkt.info, mkt);
        renderAboutSection(mkt.info);
    } else {
        // Clear key stats and analyst while loading
        document.getElementById('modal-key-stats').innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Loading statistics...</p>';
        document.getElementById('modal-analyst').innerHTML    = '<p style="color:var(--text-secondary);font-size:0.85rem;">Loading analyst data...</p>';
        document.getElementById('modal-about-section').style.display = 'none';
    }

    // Show modal
    document.getElementById('ticker-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function renderHeroStats(mkt) {
    if (mkt.status === 'pending_data') {
        document.getElementById('modal-hero-stats').innerHTML = `
            <div class="hero-stat main"><div class="hero-stat-label">LAST PRICE</div><div class="hero-stat-value main">--</div></div>
            <div class="hero-stat main"><div class="hero-stat-label">DAY CHANGE</div><div class="hero-stat-value main">--</div></div>
            <div class="hero-stat"><div class="hero-stat-label">OPEN</div><div class="hero-stat-value">--</div></div>
            <div class="hero-stat"><div class="hero-stat-label">HIGH</div><div class="hero-stat-value">--</div></div>
            <div class="hero-stat"><div class="hero-stat-label">LOW</div><div class="hero-stat-value">--</div></div>
        `;
        return;
    }

    const isPos = (mkt.change_pct || 0) >= 0;
    const sign  = isPos ? '+' : '';
    const changeColor = isPos ? 'var(--positive)' : 'var(--negative)';
    document.getElementById('modal-hero-stats').innerHTML = `
        <div class="hero-stat main">
            <div class="hero-stat-label">LAST PRICE</div>
            <div class="hero-stat-value main">${formatPrice(mkt.close_price, mkt.currency)}</div>
        </div>
        <div class="hero-stat main">
            <div class="hero-stat-label">DAY CHANGE</div>
            <div class="hero-stat-value main" style="color:${changeColor}">${sign}${(mkt.change_pct||0).toFixed(2)}%</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">OPEN</div>
            <div class="hero-stat-value">${formatPrice(mkt.open_price, mkt.currency)}</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">HIGH</div>
            <div class="hero-stat-value">${formatPrice(mkt.high_price, mkt.currency)}</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">LOW</div>
            <div class="hero-stat-value">${formatPrice(mkt.low_price, mkt.currency)}</div>
        </div>
    `;
}

function renderKeyStats(info, mkt) {
    const fmt = (v, isPrice, dec) => {
        if (v === null || v === undefined || v === '—') return '—';
        if (isPrice) return formatPrice(parseFloat(v), mkt.currency);
        return parseFloat(v).toFixed(dec || 2);
    };
    const fmtVol = v => v ? (v >= 1e9 ? `${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `${(v/1e6).toFixed(2)}M` : `${(v/1e3).toFixed(1)}K`) : '—';
    
    const stats = [
        { label: 'Market Cap',     value: formatLargePrice(info.market_cap, mkt.currency) },
        { label: 'P/E Ratio',      value: fmt(info.pe_ratio, false, 1) },
        { label: 'Fwd P/E',        value: fmt(info.forward_pe, false, 1) },
        { label: 'EPS (TTM)',      value: fmt(info.eps, true) },
        { label: 'Div. Yield',     value: info.dividend_yield ? `${(info.dividend_yield*100).toFixed(2)}%` : '—' },
        { label: 'Beta',           value: fmt(info.beta, false, 2) },
        { label: '52W High',       value: fmt(info['52w_high'], true) },
        { label: '52W Low',        value: fmt(info['52w_low'],  true) },
        { label: 'Mean Target',    value: fmt(info.target_price, true) },
        { label: 'Volume',         value: fmtVol(mkt.volume) },
        { label: 'Avg Volume',     value: fmtVol(info.avg_volume) },
    ];

    document.getElementById('modal-key-stats').innerHTML = stats.map(s => `
        <div class="key-stat-item">
            <div class="key-stat-label">${s.label}</div>
            <div class="key-stat-value">${s.value}</div>
        </div>
    `).join('');
}

function renderModalNews(mkt) {
    const container = document.getElementById('modal-news-list');
    const links     = mkt.headline_links || [];
    const headlines = mkt.headlines      || [];

    if (links.length > 0) {
        container.innerHTML = links.slice(0, 5).map(h => {
            if (!h.title) return '';
            const pub = h.published ? new Date(h.published).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '';
            return `
                <a class="news-article-card" href="${h.url || '#'}" target="_blank" rel="noopener noreferrer">
                    <div class="news-article-source">${h.source || 'News'}${pub ? ` · ${pub}` : ''}</div>
                    <div class="news-article-title">${h.title}</div>
                    <svg class="news-article-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M7 7h10v10"/></svg>
                </a>
            `;
        }).join('');
    } else if (headlines.length > 0) {
        container.innerHTML = headlines.slice(0, 5).map(h =>
            `<div class="news-article-card no-link"><div class="news-article-title">${h}</div></div>`
        ).join('');
    } else {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">No recent news available.</p>';
    }
}

function renderAboutSection(info) {
    if (!info || !info.business_summary) return;
    document.getElementById('modal-about-text').textContent = info.business_summary;
    const metaEl = document.getElementById('modal-about-meta');
    const tags = [
        info.sector   ? { label: info.sector }   : null,
        info.industry ? { label: info.industry } : null,
        info.country  ? { label: info.country }  : null,
        info.exchange ? { label: info.exchange }  : null,
    ].filter(Boolean);
    metaEl.innerHTML = tags.map(t =>
        `<span class="about-tag">${t.label}</span>`
    ).join('');
    document.getElementById('modal-about-section').style.display = 'block';
}


function closeModal() {
    document.getElementById('ticker-modal').classList.remove('open');
    document.body.style.overflow = '';
    if (modalChartInstance) {
        modalChartInstance.destroy();
        modalChartInstance = null;
    }
    currentModalTicker = null;
}

async function loadModalChart(ticker, period) {
    const loading = document.getElementById('modal-chart-loading');
    loading.classList.remove('hidden');

    try {
        const res = await fetch(`/api/v1/market/history/${ticker}?period=${period}`);
        if (!res.ok) throw new Error('Failed to load history');
        const data = await res.json();

        // Build labels + close prices
        const labels = data.ohlcv.map(d => {
            const dt = new Date(d.time);
            return period === '1d' ? dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : dt.toLocaleDateString();
        });
        const closes = data.ohlcv.map(d => d.close);

        // Update company name
        if (data.info && data.info.name) {
            document.getElementById('modal-ticker-name').textContent = data.info.name;
        }

        // Color based on trend
        const trendColor = closes[closes.length-1] >= closes[0] ? '#10b981' : '#f43f5e';

        // Update hero stats if this is a pending discovery pick
        if (currentModalMkt && currentModalMkt.status === 'pending_data') {
            const today = data.ohlcv[data.ohlcv.length - 1];
            let close = today.close;
            let open = today.open;
            let high = today.high;
            let low = today.low;
            let prevClose = data.ohlcv.length > 1 ? data.ohlcv[data.ohlcv.length - 2].close : today.close;
            
            if (data.info) {
                if (data.info.current_price) close = data.info.current_price;
                if (data.info.previous_close) prevClose = data.info.previous_close;
                if (data.info.day_open) open = data.info.day_open;
                if (data.info.day_high) high = data.info.day_high;
                if (data.info.day_low) low = data.info.day_low;
            }
            
            const change_pct = prevClose ? ((close - prevClose) / prevClose) * 100 : 0;
            
            currentModalMkt.close_price = close;
            currentModalMkt.open_price = open;
            currentModalMkt.high_price = high;
            currentModalMkt.low_price = low;
            currentModalMkt.change_pct = change_pct;
            currentModalMkt.volume = today.volume;
            currentModalMkt.currency = data.info ? data.info.currency : 'USD';
            currentModalMkt.status = 'loaded';
            
            renderHeroStats(currentModalMkt);
        }

        if (modalChartInstance) { modalChartInstance.destroy(); modalChartInstance = null; }
        const ctx = document.getElementById('modal-history-chart').getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, trendColor + '33');
        gradient.addColorStop(1, trendColor + '00');

        modalChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: ticker,
                    data: closes,
                    borderColor: trendColor,
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15,23,42,0.9)',
                        titleColor: '#94a3b8',
                        bodyColor: '#f8fafc',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        callbacks: { label: ctx => ` ${ctx.label}: ${formatPrice(ctx.parsed.y)}` }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
                    y: { 
                        beginAtZero: false,
                        ticks: { color: '#94a3b8', callback: v => {
                            const { symbol, rate } = EXCHANGE_RATES[currentCurrency];
                            return `${symbol}${(v * rate).toFixed(0)}`;
                        } }, 
                        grid: { color: 'rgba(255,255,255,0.04)' } 
                    }
                }
            }
        });

        // Key stats (only populated on first load when info is available)
        if (data.info) {
            currentModalMkt.info = data.info; // Cache for currency refreshes
            renderKeyStats(data.info, currentModalMkt);
            renderAboutSection(data.info);
        }

        // Analyst ratings
        renderAnalystBar(data.analyst_summary);

    } catch (e) {
        console.error('Chart load error', e);
        document.getElementById('modal-analyst').innerHTML = '<p style="color:var(--text-secondary);">Could not load analyst data.</p>';
    } finally {
        loading.classList.add('hidden');
    }
}

function renderAnalystBar(summary) {
    const container = document.getElementById('modal-analyst');
    if (!summary) { container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">No analyst data available.</p>'; return; }

    const total = (summary.strong_buy||0) + (summary.buy||0) + (summary.hold||0) + (summary.sell||0) + (summary.strong_sell||0);
    if (total === 0) { container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">No analyst ratings on record.</p>'; return; }

    const rows = [
        { label: 'Strong Buy', count: summary.strong_buy||0, color: '#10b981' },
        { label: 'Buy',        count: summary.buy||0,        color: '#34d399' },
        { label: 'Hold',       count: summary.hold||0,       color: '#94a3b8' },
        { label: 'Sell',       count: summary.sell||0,       color: '#fb7185' },
        { label: 'Strong Sell',count: summary.strong_sell||0,color: '#f43f5e' },
    ];

    container.innerHTML = rows.map(r => `
        <div class="analyst-row">
            <span class="analyst-label">${r.label}</span>
            <div class="analyst-bar-bg">
                <div class="analyst-bar-fill" style="width:${total ? (r.count/total*100) : 0}%; background:${r.color};"></div>
            </div>
            <span class="analyst-count">${r.count}</span>
        </div>
    `).join('');
}
function formatInsight(text, limit = null) {
    if (!text) return '';
    
    // Handle array input (sometimes returned by discovery agent)
    let rawText = Array.isArray(text) ? text.join('\n') : String(text);
    let formatted = rawText.trim();
    
    // Handle numbered or dash bullets
    const lines = formatted.split('\n');
    let bullets = [];
    let firstLine = '';
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        if (!firstLine) firstLine = trimmed;

        // Lenient bullet detection: Numbered (1. 2.), dash (-), or star (*)
        // Changed regex to allow optional space after bullet
        if (trimmed.match(/^(\d+\.|-|\*)\s?|^\u2022/)) {
            let content = trimmed.replace(/^(\d+\.|-|\*)\s?|^\u2022/, '').trim();
            // Bold the "Category:" if present
            if (content.includes(':')) {
                const parts = content.split(':');
                const category = parts.shift();
                const rest = parts.join(':');
                content = `<strong>${category}:</strong>${rest}`;
            }
            bullets.push(`<div class="insight-bullet">${content}</div>`);
            if (limit && bullets.length >= limit) break; // Stop after limit reached
        } else if (trimmed && (!limit || bullets.length < limit)) {
            bullets.push(`<div>${trimmed}</div>`);
        }
    }

    // Fallback: If no bullets found and we only wanted one, show the first non-empty line
    if (bullets.length === 0 && firstLine) {
        let content = firstLine;
        if (content.length > 120 && limit === 1) content = content.substring(0, 117) + '...';
        formatted = `<div>${content}</div>`;
    } else {
        formatted = bullets.join('');
    }

    // Handle any remaining bold (simple **bold**)
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    return formatted;
}

/* =====================================================
   Discover Tab — fetch, render
   ===================================================== */
let _discoverRefreshTimer = null;
let _discoverNewsTimer    = null;

async function fetchDiscoverData() {
    fetchDiscoverIndices();
    fetchDiscoverMovers();
    fetchDiscoverNews();
    fetchDailyPicks();  // also refresh daily picks when switching to Discover

    // Auto-refresh indices every 5 min, news every hour
    clearInterval(_discoverRefreshTimer);
    clearInterval(_discoverNewsTimer);
    _discoverRefreshTimer = setInterval(fetchDiscoverIndices, 5 * 60 * 1000);
    _discoverNewsTimer    = setInterval(fetchDiscoverNews,   60 * 60 * 1000);
}

async function fetchDiscoverIndices() {
    try {
        const res = await fetch('/api/v1/discover/indices');
        if (!res.ok) return;
        const data = await res.json();
        renderMarketIndices(data.regions || []);
        renderCommodities(data.commodities || []);
    } catch(e) { console.error('Discover indices failed', e); }
}

async function fetchDiscoverMovers() {
    try {
        const res = await fetch('/api/v1/discover/movers');
        if (!res.ok) return;
        const data = await res.json();
        renderMovers('gainers-table', data.gainers || [], true);
        renderMovers('losers-table',  data.losers  || [], false);
        if (data.as_of) {
            const d = new Date(data.as_of);
            document.getElementById('movers-as-of').textContent =
                `· as of ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
        }
    } catch(e) { console.error('Discover movers failed', e); }
}

async function fetchDiscoverNews() {
    try {
        const res = await fetch('/api/v1/discover/news');
        if (!res.ok) return;
        const data = await res.json();
        renderTopNews(data.articles || []);
        if (data.as_of) {
            const d = new Date(data.as_of);
            document.getElementById('news-as-of').textContent =
                `· updated ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
        }
    } catch(e) { console.error('Discover news failed', e); }
}

function renderMarketIndices(regions) {
    const el = document.getElementById('discover-indices');
    if (!el) return;

    el.innerHTML = regions.map(r => {
        if (!r.indices || !r.indices.length) return '';
        const cards = r.indices.map(idx => {
            const isPos = idx.change_pct >= 0;
            const sign  = isPos ? '+' : '';
            // Format price with commas; don't prepend $ for non-USD
            const priceStr = idx.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
            const currencyLabel = idx.currency && idx.currency !== 'USD' ? idx.currency : '$';
            return `<div class="discover-index-card">
                <div class="discover-index-name">${idx.name}</div>
                <div class="discover-index-price">${currencyLabel !== '$' ? '' : '$'}${priceStr} <span style="font-size:0.65rem;color:var(--text-secondary);">${currencyLabel !== '$' ? currencyLabel : ''}</span></div>
                <span class="discover-change-badge ${isPos ? 'pos' : 'neg'}">${sign}${idx.change_pct.toFixed(2)}%</span>
            </div>`;
        }).join('');

        return `<div class="discover-region-group">
            <div class="discover-region-label">${r.flag} ${r.region}</div>
            <div class="discover-region-cards">${cards}</div>
        </div>`;
    }).join('');
}

function renderCommodities(commodities) {
    const el = document.getElementById('discover-commodities');
    if (!el) return;
    el.innerHTML = commodities.map(c => {
        const isPos = c.change_pct >= 0;
        const sign  = isPos ? '+' : '';
        return `<div class="discover-index-card">
            <div class="discover-region-label">${c.icon} ${c.name}</div>
            <div class="discover-index-name">per ${c.unit} · USD</div>
            <div class="discover-index-price">$${c.price.toLocaleString()}</div>
            <span class="discover-change-badge ${isPos ? 'pos' : 'neg'}">${sign}${c.change_pct.toFixed(2)}%</span>
        </div>`;
    }).join('');
}

function renderMovers(tableId, movers, isGainer) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    if (!movers.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-secondary);text-align:center;padding:1rem;">No data yet</td></tr>';
        return;
    }
    tbody.innerHTML = movers.map((m, i) => {
        const sign  = m.change_pct >= 0 ? '+' : '';
        const color = m.change_pct >= 0 ? '#10b981' : '#f43f5e';
        // Truncate long company names
        const name  = (m.company_name || m.ticker).length > 22
            ? (m.company_name || m.ticker).substring(0, 20) + '…'
            : (m.company_name || m.ticker);
        return `<tr>
            <td><strong>${m.ticker}</strong></td>
            <td style="color:var(--text-secondary);font-size:0.8rem;">${name}</td>
            <td style="text-align:right;">$${m.price.toLocaleString()}</td>
            <td style="text-align:right;color:${color};font-weight:700;">${sign}${m.change_pct.toFixed(2)}%</td>
        </tr>`;
    }).join('');
}

function renderTopNews(articles) {
    const el = document.getElementById('discover-news');
    if (!el) return;
    if (!articles.length) { el.innerHTML = '<p style="color:var(--text-secondary)">No news available yet.</p>'; return; }
    el.innerHTML = articles.map(a => {
        const d = a.published ? new Date(a.published) : null;
        const time = d ? d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
        const desc = a.description || '';
        return `<div class="news-feed-item">
            <div class="news-feed-meta">
                <div class="news-feed-source">${a.source || 'News'}</div>
                <div class="news-feed-time">${time}</div>
            </div>
            <div class="news-feed-content">
                <a class="news-feed-title" href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
                ${desc ? `<p class="news-feed-desc">${desc}</p>` : ''}
            </div>
        </div>`;
    }).join('');
}

/* =====================================================
   Manage Tab — Search / Filter / Sort
   ===================================================== */
// Exchange code → normalised exchange name
const EXCHANGE_MAP = {
    NMS: 'Nasdaq', NGS: 'Nasdaq', NNM: 'Nasdaq', NCM: 'Nasdaq',
    NYQ: 'NYSE',   NYS: 'NYSE',
    ASX: 'ASX',
    LSE: 'LSE',    IOB: 'LSE',
    TYO: 'TSE',    JPX: 'TSE',
    HKG: 'HKEX',
};
// Exchange → country bucket
const EXCHANGE_COUNTRY = {
    Nasdaq: 'US', NYSE: 'US',
    ASX:    'AU',
    LSE:    'EU',
    TSE:    'ASIA', HKEX: 'ASIA',
};

let _activeSortKey = 'name';

function initManageFilters() {
    const search   = document.getElementById('asset-search');
    const country  = document.getElementById('filter-country');
    const exchange = document.getElementById('filter-exchange');

    if (!search) return;

    search.addEventListener('input',   applyManageFilters);
    country.addEventListener('change', applyManageFilters);
    exchange.addEventListener('change', applyManageFilters);

    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _activeSortKey = btn.dataset.sort;
            applyManageFilters();
        });
    });
}

function applyManageFilters() {
    const query    = (document.getElementById('asset-search')?.value   || '').toLowerCase().trim();
    const country  = (document.getElementById('filter-country')?.value  || '');
    const exchange = (document.getElementById('filter-exchange')?.value  || '');

    const cards = Array.from(document.querySelectorAll('#insights-container .insight-card, #insights-container [data-ticker]'));
    if (!cards.length) return;

    cards.forEach(card => {
        const ticker  = (card.dataset.ticker  || '').toLowerCase();
        const company = (card.dataset.company || '').toLowerCase();
        const exc     = EXCHANGE_MAP[card.dataset.exchange] || card.dataset.exchange || '';
        const cntry   = EXCHANGE_COUNTRY[exc] || '';

        const matchQuery    = !query   || ticker.includes(query) || company.includes(query);
        const matchCountry  = !country  || cntry === country;
        const matchExchange = !exchange || exc === exchange;

        card.style.display = (matchQuery && matchCountry && matchExchange) ? '' : 'none';
    });

    // Sort visible cards
    const container = document.getElementById('insights-container');
    if (!container) return;
    const visible = cards.filter(c => c.style.display !== 'none');
    visible.sort((a, b) => {
        const aT = a.dataset.ticker || '';
        const bT = b.dataset.ticker || '';
        const aP = parseFloat(a.dataset.price || 0);
        const bP = parseFloat(b.dataset.price || 0);
        const aC = parseFloat(a.dataset.change || 0);
        const bC = parseFloat(b.dataset.change || 0);
        switch (_activeSortKey) {
            case 'price-desc':  return bP - aP;
            case 'price-asc':   return aP - bP;
            case 'change-desc': return bC - aC;
            case 'change-asc':  return aC - bC;
            default:            return aT.localeCompare(bT);
        }
    });
    visible.forEach(c => container.appendChild(c));
}

