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

let currentCurrency = 'USD';
const EXCHANGE_RATES = {
    'USD': { rate: 1.0, symbol: '$' },
    'EUR': { rate: 0.92, symbol: '€' },
    'GBP': { rate: 0.83, symbol: '£' },
    'AUD': { rate: 1.54, symbol: 'A$' },
    'JPY': { rate: 154.0, symbol: '¥' }
};

function formatPrice(value) {
    if (value === null || value === undefined) return 'N/A';
    const { rate, symbol } = EXCHANGE_RATES[currentCurrency];
    const converted = value * rate;
    // Special case for JPY which usually doesn't have decimals for small amounts, but let's keep 2 for consistency or 0 for JPY
    const decimals = currentCurrency === 'JPY' ? 0 : 2;
    return `${symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function formatLargePrice(value) {
    if (value === null || value === undefined || value === 0) return '—';
    const { rate, symbol } = EXCHANGE_RATES[currentCurrency];
    const v = value * rate;
    if (v >= 1e12) return `${symbol}${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9)  return `${symbol}${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6)  return `${symbol}${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3)  return `${symbol}${(v / 1e3).toFixed(1)}K`;
    return formatPrice(value);
}

/* =====================================================
   Bootstrap
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initControls(); // Replacement for Zoom
    initModal();
    initDashboard();
    setupTickerForm();
    initCurrency();
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
            grid.innerHTML = data.map(pick => `
                <div class="metric-card glass glow-hover discovery-pick-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                        <span class="dim-label" style="font-size:0.7rem; text-transform:uppercase; letter-spacing: 0.05em; color: var(--accent);">${pick.category}</span>
                        <span class="signal-pill watch" style="background: rgba(139, 92, 246, 0.1); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.3); padding: 0.2rem 0.5rem; border-radius: 6px; font-size: 0.65rem; font-weight: 700;">DAILY PICK</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                        <h3 class="metric-value text-gradient-purple" style="font-size: 1.8rem; letter-spacing: -0.5px;">${pick.actual_ticker}</h3>
                        <button class="glass-btn primary" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; border-radius: 6px;" 
                                onclick="handleAddFeatured('${pick.actual_ticker}', this)">
                            Track
                        </button>
                    </div>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; border-top: 1px solid var(--glass-border); padding-top: 0.75rem;">${pick.rationale}</p>
                </div>
            `).join('');
        }
    } catch (e) {}
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
    if (!sparklineInstances[elementId]) {
        container.innerHTML = '<canvas></canvas>';
        const ctx = container.querySelector('canvas').getContext('2d');
        sparklineInstances[elementId] = new Chart(ctx, {
            type: 'line',
            data: { labels: dataset.map((_,i) => i), datasets: [{ data: dataset, borderColor: color, borderWidth: 2, pointRadius: 0, tension: 0.4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, animation: false }
        });
    } else {
        sparklineInstances[elementId].data.datasets[0].data = dataset;
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

        document.getElementById('ticker-count').textContent = `${marketArr.length}/10 Tracked`;

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
    });
}

function signalClass(signal) {
    if (!signal) return 'hold';
    return signal.toLowerCase();
}

function statusChip(modelUsed) {
    if (!modelUsed) return `<span class="status-chip pending">Pending</span>`;
    if (modelUsed.includes('claude') || modelUsed.includes('haiku')) return `<span class="status-chip live-ai">🟢 Live AI</span>`;
    if (modelUsed === 'data-fallback') return `<span class="status-chip data-insight">🟡 Data Insight</span>`;
    if (modelUsed === 'local-mock') return `<span class="status-chip data-insight">🟡 Mock</span>`;
    return `<span class="status-chip pending">⚪ Pending</span>`;
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
    wrapper.dataset.ticker = mkt.ticker;
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

    inner.onclick = () => {
        openModal(mkt.ticker);
    };
}

function cardInnerHtml(mkt, insight) {
    // Fix for pending cards with no real data yet
    if (mkt.status === 'pending_data') {
        return `
            <div class="card-header">
                <div class="card-header-left">
                    <span class="ticker-symbol">${mkt.ticker}</span>
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
                <span class="ticker-symbol">${mkt.ticker}</span>
                ${signal ? `<span class="signal-pill ${sClass}">${signal}</span>` : ''}
            </div>
            ${statusChip(insight ? insight.model_used : null)}
        </div>
        <div class="price-row">
            <span style="font-size:1.8rem; font-weight:700;">${formatPrice(mkt.close_price)}</span>
            <span class="${changeClass}" style="margin-left:0.5rem; font-size:1rem; font-weight:600;">${sign}${mkt.change_pct.toFixed(2)}%</span>
        </div>
        <div class="insight-text">
            ${insight ? formatInsight(insight.insight_text, true) : 'Awaiting AI synthesis — click to view history.'}
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
            document.getElementById('ticker-count').textContent = `${total}/10 Tracked`;
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
    
    // Sort by price for better bar visualization
    const sorted = [...marketData].filter(m => m.status === 'active').sort((a,b) => b.close_price - a.close_price);
    if (sorted.length === 0) return;

    const labels = sorted.map(d => d.ticker);
    const data = sorted.map(d => d.close_price);
    const colors = sorted.map(d => d.change_pct >= 0 ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)');
    const borderColors = sorted.map(d => d.change_pct >= 0 ? 'rgba(16,185,129,0.9)' : 'rgba(244,63,94,0.9)');

    const ctx = document.getElementById('portfolioChart').getContext('2d');

    if (portfolioChartInstance) {
        portfolioChartInstance.options.scales.y.ticks.callback = v => {
            const { symbol, rate } = EXCHANGE_RATES[currentCurrency];
            return `${symbol}${(v * rate).toFixed(0)}`;
        };
        portfolioChartInstance.options.plugins.tooltip.callbacks.label = ctx => {
            return ` ${ctx.label}: ${formatPrice(ctx.parsed.y)}`;
        };
        portfolioChartInstance.update('none');
    } else {
        portfolioChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ 
                    label: 'Price (USD)', 
                    data, 
                    backgroundColor: colors, 
                    borderColor: borderColors, 
                    borderWidth: 1, 
                    borderRadius: 6 
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const ticker = portfolioChartInstance.data.labels[index];
                        openModal(ticker);
                    }
                },
                plugins: { 
                    legend: { labels: { color: '#f8fafc' } }, 
                    tooltip: { 
                        callbacks: { 
                            label: ctx => ` ${ctx.label}: ${formatPrice(ctx.parsed.y)}` 
                        } 
                    },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                    }
                },
                scales: {
                    y: { 
                        beginAtZero: true, 
                        ticks: { 
                            color: '#94a3b8', 
                            callback: v => {
                                const { symbol, rate } = EXCHANGE_RATES[currentCurrency];
                                return `${symbol}${(v * rate).toFixed(0)}`;
                            }
                        }, 
                        grid: { color: 'rgba(255,255,255,0.05)' } 
                    },
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
                }
            }
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

function renderModalContent(mkt, insight) {
    const ticker = mkt.ticker || currentModalTicker;

    // Header
    document.getElementById('modal-ticker-title').textContent = ticker;
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
    const isPos = (mkt.change_pct || 0) >= 0;
    const sign  = isPos ? '+' : '';
    const changeColor = isPos ? 'var(--positive)' : 'var(--negative)';
    document.getElementById('modal-hero-stats').innerHTML = `
        <div class="hero-stat main">
            <div class="hero-stat-label">LAST PRICE</div>
            <div class="hero-stat-value main">${formatPrice(mkt.close_price)}</div>
        </div>
        <div class="hero-stat main">
            <div class="hero-stat-label">DAY CHANGE</div>
            <div class="hero-stat-value main" style="color:${changeColor}">${sign}${(mkt.change_pct||0).toFixed(2)}%</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">OPEN</div>
            <div class="hero-stat-value">${formatPrice(mkt.open_price)}</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">HIGH</div>
            <div class="hero-stat-value">${formatPrice(mkt.high_price)}</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">LOW</div>
            <div class="hero-stat-value">${formatPrice(mkt.low_price)}</div>
        </div>
    `;
}

function renderKeyStats(info, mkt) {
    const fmt = (v, isPrice=false, decimals=2) => {
        if (v === null || v === undefined || v === '—') return '—';
        if (isPrice) return formatPrice(parseFloat(v));
        return parseFloat(v).toFixed(decimals);
    };
    const fmtVol = v => v ? (v >= 1e9 ? `${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `${(v/1e6).toFixed(2)}M` : `${(v/1e3).toFixed(1)}K`) : '—';

    const stats = [
        { label: 'Market Cap',     value: formatLargePrice(info.market_cap) },
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
                    y: { ticks: { color: '#94a3b8', callback: v => {
                        const { symbol, rate } = EXCHANGE_RATES[currentCurrency];
                        return `${symbol}${(v * rate).toFixed(0)}`;
                    } }, grid: { color: 'rgba(255,255,255,0.04)' } }
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
function formatInsight(text, onlyFirst = false) {
    if (!text) return '';
    
    // Simple mini-markdown for bullet points and bold
    let formatted = text.trim();
    
    // Handle numbered or dash bullets
    const lines = formatted.split('\n');
    let bullets = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^(\d+\.|-|\*)\s/)) {
            let content = trimmed.replace(/^(\d+\.|-|\*)\s/, '');
            // Bold the "Category:" if present
            if (content.includes(':')) {
                const parts = content.split(':');
                const category = parts.shift();
                const rest = parts.join(':');
                content = `<strong>${category}:</strong>${rest}`;
            }
            bullets.push(`<div class="insight-bullet">${content}</div>`);
            if (onlyFirst) break; // Stop after first bullet if requested
        } else if (trimmed && !onlyFirst) {
            bullets.push(`<div>${trimmed}</div>`);
        }
    }

    formatted = bullets.join('');

    // Handle any remaining bold (simple **bold**)
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    return formatted;
}
