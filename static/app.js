/* =====================================================
   State
   ===================================================== */
let portfolioChartInstance = null;
let modalChartInstance = null;
const sparklineInstances = {};
let currentZoom = 1.0;
let currentModalTicker = null;
let currentPeriod = '1mo';

// Snapshot of last known data for diff-and-patch
let lastMarketData = {};
let lastInsightsData = {};

/* =====================================================
   Bootstrap
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initControls(); // Replacement for Zoom
    initModal();
    initDashboard();
    setupTickerForm();
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
   Ticker Form
   ===================================================== */
function setupTickerForm() {
    const btn = document.getElementById('add-ticker-btn');
    const input = document.getElementById('new-ticker-input');
    const status = document.getElementById('ticker-status');

    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

    btn.addEventListener('click', async () => {
        const val = input.value.trim().toUpperCase();
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
                status.textContent = `✓ Added ${val}`;
                status.style.color = "var(--positive)";
                input.value = "";
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

    // Background batch: ensure all tickers have synthesis
    triggerBatchSynthesis();

    // Async background refresh — no UI wipe on each tick
    setInterval(() => {
        fetchCosts();
        fetchDashboardCosts();
        fetchMarketAndInsights();
    }, 15000);
}

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
                    fetch(`/api/v1/tickers/${mkt.ticker}/synthesize`, { method: 'POST' })
                        .catch(() => {});
                }, delay);
            }
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
            <span style="font-size:1.8rem; font-weight:700;">$${mkt.close_price.toFixed(2)}</span>
            <span class="${changeClass}" style="margin-left:0.5rem; font-size:1rem; font-weight:600;">${sign}${mkt.change_pct.toFixed(2)}%</span>
        </div>
        <p class="insight-text">${insight ? insight.insight_text : 'Awaiting AI synthesis — click to view history.'}</p>
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
    const ctx = document.getElementById('portfolioChart').getContext('2d');
    const sorted = [...marketData].sort((a,b) => b.close_price - a.close_price);
    const labels = sorted.map(d => d.ticker);
    const data = sorted.map(d => d.close_price);
    const colors = sorted.map(d => d.change_pct >= 0 ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)');
    const borderColors = sorted.map(d => d.change_pct >= 0 ? 'rgba(16,185,129,0.9)' : 'rgba(244,63,94,0.9)');

    if (portfolioChartInstance) {
        portfolioChartInstance.data.labels = labels;
        portfolioChartInstance.data.datasets[0].data = data;
        portfolioChartInstance.data.datasets[0].backgroundColor = colors;
        portfolioChartInstance.data.datasets[0].borderColor = borderColors;
        portfolioChartInstance.update('none');
    } else {
        portfolioChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ label: 'Price (USD)', data, backgroundColor: colors, borderColor: borderColors, borderWidth: 1, borderRadius: 6 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#f8fafc' } }, tooltip: { callbacks: { label: ctx => ` $${ctx.parsed.y.toFixed(2)}` } } },
                scales: {
                    y: { beginAtZero: false, ticks: { color: '#94a3b8', callback: v => `$${v}` }, grid: { color: 'rgba(255,255,255,0.05)' } },
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

    const mkt = lastMarketData[ticker] || {};
    const insight = lastInsightsData[ticker] || null;

    // Header
    document.getElementById('modal-ticker-title').textContent = ticker;
    document.getElementById('modal-ticker-name').textContent = `Click a period to load historical chart`;

    // Signal badge
    const signal = insight ? (insight.signal || 'HOLD') : 'HOLD';
    const sigBadge = document.getElementById('modal-signal-badge');
    sigBadge.className = `signal-badge ${signal.toLowerCase()}`;
    sigBadge.textContent = signal;

    // Stats
    document.getElementById('modal-stats').innerHTML = `
        <div class="stat-item"><div class="stat-label">Price</div><div class="stat-value">$${(mkt.close_price||0).toFixed(2)}</div></div>
        <div class="stat-item"><div class="stat-label">Change</div><div class="stat-value ${mkt.change_pct>=0?'pill-green':'pill-red'}">${mkt.change_pct>=0?'+':''}${(mkt.change_pct||0).toFixed(2)}%</div></div>
        <div class="stat-item"><div class="stat-label">Open</div><div class="stat-value">$${(mkt.open_price||0).toFixed(2)}</div></div>
        <div class="stat-item"><div class="stat-label">High</div><div class="stat-value">$${(mkt.high_price||0).toFixed(2)}</div></div>
        <div class="stat-item"><div class="stat-label">Low</div><div class="stat-value">$${(mkt.low_price||0).toFixed(2)}</div></div>
        <div class="stat-item"><div class="stat-label">Volume</div><div class="stat-value">${((mkt.volume||0)/1e6).toFixed(2)}M</div></div>
    `;

    // AI Insight
    document.getElementById('modal-insight-text').textContent =
        insight ? insight.insight_text : 'No AI synthesis available yet.';
    document.getElementById('modal-insight-meta').textContent =
        insight ? `Model: ${insight.model_used} · Cost: $${(insight.cost_usd||0).toFixed(6)}` : '';

    // Reset analyst section
    document.getElementById('modal-analyst').innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Loading analyst data...</p>';

    // Show modal
    document.getElementById('ticker-modal').classList.add('open');
    document.body.style.overflow = 'hidden';

    // Load chart + analyst data
    loadModalChart(ticker, '1mo');
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

        // Update name if we have it
        if (data.info && data.info.name) {
            document.getElementById('modal-ticker-name').textContent = data.info.name;
        }

        // Color line based on overall trend
        const trendColor = closes[closes.length-1] >= closes[0] ? '#10b981' : '#f43f5e';

        // Destroy old chart
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
                    tooltip: {
                        backgroundColor: 'rgba(15,23,42,0.9)',
                        titleColor: '#94a3b8',
                        bodyColor: '#f8fafc',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        callbacks: { label: ctx => ` $${ctx.parsed.y.toFixed(2)}` }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
                    y: { ticks: { color: '#94a3b8', callback: v => `$${v}` }, grid: { color: 'rgba(255,255,255,0.04)' } }
                }
            }
        });

        // Update stats with info
        if (data.info) {
            const extraStats = document.getElementById('modal-stats');
            const existing = extraStats.innerHTML;
            let infoHtml = '';
            if (data.info['52w_high']) infoHtml += `<div class="stat-item"><div class="stat-label">52W High</div><div class="stat-value">$${parseFloat(data.info['52w_high']).toFixed(2)}</div></div>`;
            if (data.info['52w_low']) infoHtml += `<div class="stat-item"><div class="stat-label">52W Low</div><div class="stat-value">$${parseFloat(data.info['52w_low']).toFixed(2)}</div></div>`;
            if (data.info.pe_ratio) infoHtml += `<div class="stat-item"><div class="stat-label">P/E Ratio</div><div class="stat-value">${parseFloat(data.info.pe_ratio).toFixed(1)}</div></div>`;
            if (data.info.market_cap) infoHtml += `<div class="stat-item"><div class="stat-label">Mkt Cap</div><div class="stat-value">$${(data.info.market_cap/1e9).toFixed(1)}B</div></div>`;
            extraStats.innerHTML = existing + infoHtml;
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
