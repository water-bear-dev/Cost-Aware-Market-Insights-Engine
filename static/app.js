/* =====================================================
   State
   ===================================================== */
const APP_DEBUG = false; // Set to true to see detailed AI synthesis and data logs

function debugLog(msg, ...args) {
    if (APP_DEBUG) {
        console.log(msg, ...args);
    }
}

let portfolioChartInstance = null;

let modalChartInstance = null;
const sparklineInstances = {};
let currentZoom = 1.0;
let currentModalTicker = null;
let currentPeriod = '1d'; // Start with 1D as default for live change
let currentModalMkt = {};
let currentModalInsight = null;

// Track starting price for the selected trend period
const periodStartPrices = {};

// Snapshot of last known data for diff-and-patch
let lastMarketData = {};
let lastInsightsData = {};
let dailyPicksData = {};
let lastDiscoverCommodities = [];

let currentCurrency = 'USD';
let currentCommodityUnit = 'Metric';
let EXCHANGE_RATES = {
    'USD': { rate: 1.0, symbol: '$' },
    'EUR': { rate: 0.92, symbol: '€' },
    'GBP': { rate: 0.83, symbol: '£' },
    'AUD': { rate: 1.54, symbol: 'A$' },
    'JPY': { rate: 154.0, symbol: '¥' },
    'HKD': { rate: 7.82, symbol: 'HK$' },
    'CAD': { rate: 1.37, symbol: 'C$' },
    'SGD': { rate: 1.35, symbol: 'S$' },
    'NZD': { rate: 1.67, symbol: 'NZ$' }
};

async function refreshExchangeRates() {
    try {
        const resp = await fetch('/api/v1/meta/rates');
        if (resp.ok) {
            const rates = await resp.json();
            EXCHANGE_RATES = rates;
            debugLog('Exchange rates updated:', EXCHANGE_RATES);
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

function formatPrice(value, tickerCurrency = 'USD', forceLocal = false) {
    if (value === null || value === undefined) return 'N/A';

    // Normalize ticker currency
    let tc = tickerCurrency;
    if (tc === 'GBp') tc = 'GBP'; // Convert British Pence to Pounds for rate lookup
    if (!EXCHANGE_RATES[tc]) tc = 'USD';

    // If we're in the default USD view, we prefer to see the LOCAL price
    // for international stocks to avoid misleading symbols (e.g. $6424 for a JPY stock)
    const isDefaultView = currentCurrency === 'USD';
    const useLocal = forceLocal || (isDefaultView && tc !== 'USD');

    const targetCurrency = useLocal ? tc : currentCurrency;

    // 1. Convert Ticker Price -> USD
    let valInTickerBase = value;
    if (tickerCurrency === 'GBp') valInTickerBase = value / 100;

    const tickerRate = EXCHANGE_RATES[tc] ? EXCHANGE_RATES[tc].rate : 1.0;
    const usdValue = valInTickerBase / tickerRate;

    // 2. Convert USD -> Target Currency
    const { rate, symbol } = EXCHANGE_RATES[targetCurrency] || EXCHANGE_RATES['USD'];
    const converted = usdValue * rate;

    const decimals = (targetCurrency === 'JPY') ? 0 : 2;
    return `${symbol}${converted.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    })}`;
}

function formatLargePrice(value, tickerCurrency = 'USD') {
    if (value === null || value === undefined || value === 0) return '—';

    // Normalize ticker currency for symbol lookup
    let tc = tickerCurrency === 'GBp' ? 'GBP' : tickerCurrency;
    if (!EXCHANGE_RATES[tc]) tc = 'USD';

    const isDefaultView = currentCurrency === 'USD';
    const targetCurrency = (isDefaultView && tc !== 'USD') ? tc : currentCurrency;

    // 1. Convert Ticker Price -> USD
    let valInTickerBase = value;
    if (tickerCurrency === 'GBp') valInTickerBase = value / 100;
    const tickerRate = EXCHANGE_RATES[tc] ? EXCHANGE_RATES[tc].rate : 1.0;
    const usdValue = valInTickerBase / tickerRate;

    // 2. Convert USD -> Target Currency
    const { rate, symbol } = EXCHANGE_RATES[targetCurrency] || EXCHANGE_RATES['USD'];
    const v = usdValue * rate;

    if (v >= 1e12) return `${symbol}${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `${symbol}${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${symbol}${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${symbol}${(v / 1e3).toFixed(1)}K`;
    return formatPrice(value, tickerCurrency);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function renderExtendedHours(mkt) {
    // Standardize field names across different API objects
    const pre = mkt.pre_market_price || mkt.preMarketPrice;
    const preChg = mkt.pre_market_change || mkt.preMarketChangePercent;
    const post = mkt.post_market_price || mkt.postMarketPrice;
    const postChg = mkt.post_market_change || mkt.postMarketChangePercent;

    if (!pre && !post) return '';

    let html = '<div style="font-size: 0.65rem; font-weight: 500; color: var(--text-secondary); margin-top: 2px; display: flex; gap: 0.5rem; justify-content: flex-end; align-items: center; opacity: 0.9;">';

    if (pre && pre !== 'None') {
        const chg = parseFloat(preChg || 0);
        const color = chg >= 0 ? '#10b981' : '#f43f5e';
        html += `<span><span style="color:var(--accent); font-weight: 700; font-size: 0.6rem;">PRE</span> ${formatPrice(parseFloat(pre), mkt.currency || 'USD')} <span style="color:${color}; font-size: 0.6rem;">(${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)</span></span>`;
    }
    if (post && post !== 'None') {
        const chg = parseFloat(postChg || 0);
        const color = chg >= 0 ? '#10b981' : '#f43f5e';
        html += `<span><span style="color:var(--accent); font-weight: 700; font-size: 0.6rem;">POST</span> ${formatPrice(parseFloat(post), mkt.currency || 'USD')} <span style="color:${color}; font-size: 0.6rem;">(${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)</span></span>`;
    }

    html += '</div>';
    return html;
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
    initBudgetControls();
    initDiscoverEvents();
});

function initDiscoverEvents() {
    const refreshBtn = document.getElementById('force-discovery-refresh-btn');
    if (!refreshBtn) return;

    refreshBtn.addEventListener('click', async () => {
        const originalHtml = refreshBtn.innerHTML;
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = 'Refining...';
        refreshBtn.classList.add('pulse-animation');

        try {
            const res = await fetch('/api/v1/discover/refresh', { method: 'POST' });
            if (res.ok) {
                showToast('Discovery refresh triggered. This may take 30-60 seconds.');
                // Polling for updates
                setTimeout(() => {
                    fetchDiscoverData();
                }, 5000);
            } else {
                showToast('Failed to trigger refresh.', 'negative');
            }
        } catch (e) {
            showToast('Network error.', 'negative');
        } finally {
            setTimeout(() => {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = originalHtml;
                refreshBtn.classList.remove('pulse-animation');
            }, 3000);
        }
    });
}

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
            if (btn.dataset.tab === 'screener-view') fetchQMJScreener();
        });
    });
}

/* =====================================================
   QMJ Screener — Redesigned Institutional Grid
   ===================================================== */
let allQmjData = [];
let filteredQmjData = [];
let qmjSortKey = 'qmj_score';
let qmjSortDir = 'desc';
let qmjCurrentPage = 1;
let qmjPageSize = 50;

async function fetchQMJScreener() {
    const tbody = document.getElementById('qmj-table-body');
    if (!tbody) return;

    const universe = document.getElementById('qmj-filter-universe')?.value || 'all';

    try {
        const res = await fetch(`/api/v1/screener/qmj?universe=${universe}`);
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success' && data.data.length > 0) {
                allQmjData = data.data;
                populateQmjFilters(allQmjData);
                initQmjTableEvents();
                applyQmjFilters();
            } else {
                tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 4rem; color: var(--text-secondary);">No QMJ data available. Ensure ingestion has run.</td></tr>';
            }
        } else {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 4rem; color: var(--negative);">Failed to load screener data.</td></tr>';
        }
    } catch (e) {
        console.error("Screener fetch failed:", e);
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 4rem; color: var(--negative);">Network error: ${e.message}</td></tr>`;
    }
}

function populateQmjFilters(data) {
    const yearSelect = document.getElementById('qmj-filter-year');
    if (!yearSelect || yearSelect.options.length > 0) return;

    const yearCounts = data.reduce((acc, d) => {
        acc[d.reporting_year] = (acc[d.reporting_year] || 0) + 1;
        return acc;
    }, {});

    const years = Object.keys(yearCounts).sort((a, b) => b - a);
    yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

    let bestYear = years[0];
    let maxCount = 0;
    for (const y of years) {
        if (yearCounts[y] > maxCount) {
            maxCount = yearCounts[y];
            bestYear = y;
        }
    }
    if (years.length > 0) yearSelect.value = bestYear;
}

function initQmjTableEvents() {
    const search = document.getElementById('qmj-search');
    const year = document.getElementById('qmj-filter-year');
    const quarter = document.getElementById('qmj-filter-quarter');
    const universe = document.getElementById('qmj-filter-universe');
    const currency = document.getElementById('screener-currency');

    if (search && !search.dataset.hooked) {
        search.addEventListener('input', debounce(() => { qmjCurrentPage = 1; applyQmjFilters(); }, 300));
        year.addEventListener('change', () => { qmjCurrentPage = 1; applyQmjFilters(); });
        quarter.addEventListener('change', () => { qmjCurrentPage = 1; applyQmjFilters(); });
        universe.addEventListener('change', () => { qmjCurrentPage = 1; fetchQMJScreener(); });
        if (currency) currency.addEventListener('change', renderQMJScreener);
        search.dataset.hooked = "true";

        // Pagination nav
        document.getElementById('qmj-prev-page')?.addEventListener('click', () => {
            if (qmjCurrentPage > 1) { qmjCurrentPage--; renderQMJScreener(); }
        });
        document.getElementById('qmj-next-page')?.addEventListener('click', () => {
            const max = Math.ceil(filteredQmjData.length / qmjPageSize);
            if (qmjCurrentPage < max) { qmjCurrentPage++; renderQMJScreener(); }
        });

        // Page size buttons
        document.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                qmjPageSize = parseInt(btn.dataset.size);
                qmjCurrentPage = 1;
                renderQMJScreener();
            });
        });
    }

    document.querySelectorAll('#qmj-table th.sortable').forEach(th => {
        if (!th.dataset.hooked) {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                if (qmjSortKey === key) {
                    qmjSortDir = qmjSortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    qmjSortKey = key;
                    qmjSortDir = 'desc';
                }
                applyQmjFilters();
            });
            th.dataset.hooked = "true";
        }
    });
}

function applyQmjFilters() {
    const query = document.getElementById('qmj-search')?.value.toLowerCase().trim() || '';
    const year = document.getElementById('qmj-filter-year')?.value || '';
    const quarter = document.getElementById('qmj-filter-quarter')?.value || '';

    filteredQmjData = allQmjData.filter(d => {
        const matchQuery = !query ||
            d.ticker.toLowerCase().includes(query) ||
            d.company_name.toLowerCase().includes(query) ||
            d.industry.toLowerCase().includes(query);
        const matchYear = !year || String(d.reporting_year) === year;
        const matchQuarter = !quarter || String(d.reporting_quarter) === quarter;
        return matchQuery && matchYear && matchQuarter;
    });

    // Sort
    filteredQmjData.sort((a, b) => {
        let valA = a[qmjSortKey];
        let valB = b[qmjSortKey];
        if (typeof valA === 'string') {
            return qmjSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return qmjSortDir === 'asc' ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });

    renderQMJScreener();
}

function renderQMJScreener() {
    const tbody = document.getElementById('qmj-table-body');
    const paginationInfo = document.getElementById('qmj-pagination-info');
    if (!tbody) return;

    const total = filteredQmjData.length;
    const totalPages = Math.ceil(total / qmjPageSize) || 1;
    if (qmjCurrentPage > totalPages) qmjCurrentPage = totalPages;

    const startIdx = (qmjCurrentPage - 1) * qmjPageSize;
    const endIdx = Math.min(startIdx + qmjPageSize, total);
    const pageData = filteredQmjData.slice(startIdx, endIdx);

    paginationInfo.innerText = total > 0 ? `Showing ${startIdx + 1}-${endIdx} of ${total} companies` : 'Showing 0-0 of 0 companies';

    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 4rem; color: var(--text-secondary);">No results match your filters.</td></tr>';
    } else {
        tbody.innerHTML = pageData.map(row => {
            return `
                <tr onclick="openTickerModal('${row.ticker}')" style="cursor:pointer;">
                    <td><span class="screener-ticker">${row.ticker}</span></td>
                    <td><div class="screener-company" title="${row.company_name}">${row.company_name}</div></td>
                    <td style="font-size:0.75rem; color:var(--text-secondary);">${row.report_date}</td>
                    <td style="font-size:0.75rem;">${row.industry}</td>
                    <td class="numeric" style="font-family: monospace;">${formatLargePrice(row.market_cap, 'USD')}</td>
                    <td class="numeric highlight-col">${renderZPill(row.qmj_score, true)}</td>
                    <td class="numeric">${renderZPill(row.z_prof)}</td>
                    <td class="numeric">${renderZPill(row.z_growth)}</td>
                    <td class="numeric">${renderZPill(row.z_safety)}</td>
                    <td class="numeric">${renderZPill(row.z_value)}</td>
                    <td class="numeric">${renderZPill(row.z_mom)}</td>
                </tr>
            `;
        }).join('');
    }

    renderQmjPagination(totalPages);
    updateSortUI();
}

function renderZPill(val, isLarge = false) {
    if (val === null || val === undefined) return '<span class="dim-label">-</span>';
    let cls = 'z-neutral';
    if (val >= 1.5) cls = 'z-extreme-pos';
    else if (val >= 0.5) cls = 'z-pos';
    else if (val <= -1.5) cls = 'z-extreme-neg';
    else if (val <= -0.5) cls = 'z-neg';
    return `<span class="z-pill ${cls}" ${isLarge ? 'style="font-size:0.85rem; padding: 0.3rem 0.6rem;"' : ''}>${val.toFixed(2)}</span>`;
}

function renderQmjPagination(totalPages) {
    const pageNumbers = document.getElementById('qmj-page-numbers');
    if (!pageNumbers) return;

    const prevBtn = document.getElementById('qmj-prev-page');
    const nextBtn = document.getElementById('qmj-next-page');
    if (prevBtn) prevBtn.disabled = qmjCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = qmjCurrentPage === totalPages || totalPages === 0;

    let html = '';
    const maxVisible = 5;
    if (totalPages <= maxVisible + 2) {
        for (let i = 1; i <= totalPages; i++) html += `<div class="page-num ${i === qmjCurrentPage ? 'active' : ''}" onclick="goToQmjPage(${i})">${i}</div>`;
    } else {
        html += `<div class="page-num ${1 === qmjCurrentPage ? 'active' : ''}" onclick="goToQmjPage(1)">1</div>`;
        if (qmjCurrentPage > 3) html += '<span class="page-ellipsis">...</span>';
        let start = Math.max(2, qmjCurrentPage - 1);
        let end = Math.min(totalPages - 1, qmjCurrentPage + 1);
        if (qmjCurrentPage <= 3) end = 4;
        if (qmjCurrentPage >= totalPages - 2) start = totalPages - 3;
        for (let i = start; i <= end; i++) html += `<div class="page-num ${i === qmjCurrentPage ? 'active' : ''}" onclick="goToQmjPage(${i})">${i}</div>`;
        if (qmjCurrentPage < totalPages - 2) html += '<span class="page-ellipsis">...</span>';
        html += `<div class="page-num ${totalPages === qmjCurrentPage ? 'active' : ''}" onclick="goToQmjPage(${totalPages})">${totalPages}</div>`;
    }
    pageNumbers.innerHTML = html;
}

window.goToQmjPage = function (n) {
    qmjCurrentPage = n;
    renderQMJScreener();
    const table = document.querySelector('#qmj-table');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function updateSortUI() {
    document.querySelectorAll('#qmj-table th.sortable').forEach(th => {
        th.classList.remove('active');
        if (th.dataset.sort === qmjSortKey) {
            th.classList.add('active');
            th.innerHTML = th.innerHTML.replace(/[↕↑↓]/g, qmjSortDir === 'asc' ? '↑' : '↓');
        } else {
            th.innerHTML = th.innerHTML.replace(/[↕↑↓]/g, '↕');
        }
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

    // Trend Period Selection
    document.querySelectorAll('.trend-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.trend-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.trend;

            // Refresh all sparklines in insights container
            Object.keys(sparklineInstances).forEach(id => {
                if (id.startsWith('sparkline-card-')) {
                    const ticker = id.replace('sparkline-card-', '');
                    refreshTickerSparkline(ticker, currentPeriod);
                }
            });

            // If modal is open, update its chart too
            if (currentModalTicker) {
                loadModalChart(currentModalTicker, currentPeriod);
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

    // Refresh Button
    const forceRefreshBtn = document.getElementById('force-refresh-btn');
    if (forceRefreshBtn) {
        forceRefreshBtn.addEventListener('click', async () => {
            if (forceRefreshBtn.disabled) return;

            const now = Date.now();
            const lastRefresh = parseInt(forceRefreshBtn.dataset.lastRefresh || "0");
            if (now - lastRefresh < 30000) {
                const remaining = Math.ceil((30000 - (now - lastRefresh)) / 1000);
                showToast(`Please wait ${remaining}s before refreshing again.`, 'info');
                return;
            }

            // 1. Visual Click Feedback (0.1s change)
            const originalHTML = forceRefreshBtn.innerHTML;
            forceRefreshBtn.innerHTML = `<span>Updating...</span>`;
            setTimeout(() => {
                forceRefreshBtn.innerHTML = originalHTML;
            }, 100);

            // 2. Disable button for 30s
            forceRefreshBtn.disabled = true;
            forceRefreshBtn.style.opacity = '0.5';
            forceRefreshBtn.style.cursor = 'not-allowed';
            forceRefreshBtn.dataset.lastRefresh = now.toString();

            // 3. Start refresh
            showToast("System refresh triggered...", "info");

            try {
                // Trigger backend refreshes (Market Caches Only)
                await Promise.all([
                    fetch('/api/v1/discover/refresh', { method: 'POST' }).catch(e => console.error("Discovery refresh failed", e)),
                    fetchDiscoverData(),
                    fetchMarketAndInsights()
                ]);
                showToast("Market data refreshed.", "success");
            } catch (err) {
                console.error("Refresh failed:", err);
                showToast("Refresh partially failed.", "error");
            }

            // 4. Re-enable after 30s
            setTimeout(() => {
                forceRefreshBtn.disabled = false;
                forceRefreshBtn.style.opacity = '1';
                forceRefreshBtn.style.cursor = 'pointer';
            }, 30000);
        });
    }
}

async function refreshTickerSparkline(ticker, period) {
    const elementId = `sparkline-card-${ticker}`;
    const container = document.getElementById(elementId);
    if (!container) return;

    container.style.opacity = '0.5';
    try {
        const res = await fetch(`/api/v1/market/history/${ticker}?period=${period}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.ohlcv && data.ohlcv.length > 0) {
            const closes = data.ohlcv.map(d => d.close).filter(v => v !== null && v > 0);
            if (closes.length > 0) {
                const first = closes[0];
                const last = closes[closes.length - 1];

                // Store the starting price for this period
                periodStartPrices[ticker] = first;

                const diff = last - first;
                const changePct = (diff / first) * 100;
                const trendColor = changePct >= 0 ? '#10b981' : '#f43f5e';

                drawSparkline(elementId, closes, trendColor);

                // Update percentage change label on the card
                const card = container.closest('.insight-card');
                if (card) {
                    const changeEl = card.querySelector('.card-change');
                    if (changeEl) {
                        const sign = changePct >= 0 ? '+' : '';
                        const pillClass = changePct >= 0 ? 'pill-green' : 'pill-red';
                        const cClass = changePct >= 0 ? 'positive' : 'negative';

                        // We use the same classes as updateCard/cardInnerHtml
                        changeEl.className = `${cClass} card-change ${pillClass}`;
                        changeEl.textContent = `${sign}${changePct.toFixed(2)}%`;
                    }
                }
            }
        }
    } catch (e) {
        console.error("Trend refresh failed:", e);
    } finally {
        container.style.opacity = '1';
    }
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
    const selectors = [
        document.getElementById('currency-selector'),
        document.getElementById('discover-currency-main'),
        document.getElementById('screener-currency')
    ];

    selectors.forEach(selector => {
        if (!selector) return;
        selector.addEventListener('change', (e) => {
            currentCurrency = e.target.value;
            // Sync all selectors
            selectors.forEach(s => { if (s && s !== e.target) s.value = currentCurrency; });

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

            // Re-render other tabs
            fetchDiscoverData(); // Fetch is cached, so it just re-renders with new currency
            renderQMJScreener();
        });
    });

    const imperialBtn = document.getElementById('unit-imperial');
    const metricBtn = document.getElementById('unit-metric');

    if (imperialBtn && metricBtn) {
        imperialBtn.addEventListener('click', (e) => {
            currentCommodityUnit = 'Imperial';
            imperialBtn.classList.add('active');
            metricBtn.classList.remove('active');
            renderCommodities(lastDiscoverCommodities || []);
        });
        metricBtn.addEventListener('click', (e) => {
            currentCommodityUnit = 'Metric';
            metricBtn.classList.add('active');
            imperialBtn.classList.remove('active');
            renderCommodities(lastDiscoverCommodities || []);
        });
    }
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

    // Refresh sparklines specifically every 24 hours
    setInterval(() => {
        Object.keys(sparklineInstances).forEach(id => {
            if (id.startsWith('sparkline-card-')) {
                const ticker = id.replace('sparkline-card-', '');
                refreshTickerSparkline(ticker, currentPeriod);
            }
        });
    }, 24 * 60 * 60 * 1000);
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
                            <span style="color: var(--text-secondary); font-size: 0.9rem;">The Daily Discovery Agent is currently hunting for global opportunities and hidden gems... check back in 30s.</span>
                        </div>
                    `;
                    container.style.display = 'block';
                }
                return;
            }

            container.style.display = 'block';
            data.forEach(p => dailyPicksData[p.actual_ticker] = p);

            grid.innerHTML = data.map(pick => {
                const price = parseFloat(pick.last_price || 0);

                // Color-coding for categories
                let categoryColor = 'var(--accent)';
                const normCat = (pick.category || '').toUpperCase();
                if (normCat.includes('S&P')) categoryColor = '#a78bfa';
                if (normCat.includes('GLOBAL') || normCat.includes('INT')) categoryColor = '#10b981';
                if (normCat.includes('GEM')) categoryColor = '#fbbf24';

                // Structured Rationale Renderer (Smart 2-Column Layout)
                let rationaleHtml = '';
                let rationale = pick.rationale;

                // Debugging: Log the rationale structure to see what's actually arriving
                debugLog(`[Discovery] Rationale for ${pick.actual_ticker}:`, rationale);

                // 1. Force Parsing if string
                if (typeof rationale === 'string' && (rationale.startsWith('{') || rationale.startsWith('['))) {
                    try { rationale = JSON.parse(rationale); } catch(e) { console.error("JSON parse failed", e); }
                }
                
                // 2. Prepare for 2-column rendering
                const dashboardKeys = ["WHY", "NUMBERS"];
                let sections = [];

                if (typeof rationale === 'object' && rationale !== null && !Array.isArray(rationale)) {
                    // Normalize keys to uppercase for robust matching
                    const normalizedObj = {};
                    Object.entries(rationale).forEach(([k, v]) => normalizedObj[k.toUpperCase().replace(/\s+/g, '')] = v);
                    
                    dashboardKeys.forEach(k => {
                        if (normalizedObj[k]) {
                            sections.push({ label: k, content: normalizedObj[k] });
                        }
                    });

                    // If no matched keys but we have data, take the first two keys as fallback
                    if (sections.length === 0) {
                        Object.entries(rationale).slice(0, 2).forEach(([k, v]) => {
                            sections.push({ label: k.toUpperCase(), content: v });
                        });
                    }
                } else if (typeof rationale === 'string' && rationale.length > 0) {
                    // LEGACY FALLBACK: Map plain string to the "WHY" column to preserve 2-column layout
                    sections.push({ label: "WHY", content: rationale });
                }

                // 3. Generate HTML
                if (sections.length > 0) {
                    rationaleHtml = sections.map(sec => `
                        <div style="display: flex; gap: 1.5rem; align-items: flex-start; padding: 0.85rem 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                            <div style="min-width: 100px; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); font-weight: 800; padding-top: 4px; opacity: 0.8; line-height: 1.3;">${sec.label}</div>
                            <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; margin: 0; font-weight: 400; flex: 1;">${sec.content}</p>
                        </div>
                    `).join('');
                } else {
                    rationaleHtml = `<p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; opacity: 0.5; margin: 0; padding: 1rem 0;">Analysis synthesis in progress...</p>`;
                }

                return `
                <div class="metric-card glass glow-hover discovery-pick-card" style="cursor: pointer; display: flex; flex-direction: column; gap: 0; padding: 1.5rem; min-height: 480px;" onclick="openDailyPickModal('${pick.actual_ticker}')">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                        <span class="dim-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing: 0.1em; color: ${categoryColor}; font-weight: 800;">${pick.category}</span>
                        <span style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: 600;">Daily Pick</span>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
                        <div style="display: flex; flex-direction: column; align-items: flex-start;">
                            <span style="font-size: 0.65rem; color: var(--accent); text-transform: uppercase; font-weight: 800; margin-bottom: 6px; letter-spacing: 0.05em; opacity: 0.8;">${formatExchange(pick.exchange)}</span>
                            <h3 class="metric-value text-gradient-purple" style="font-size: 2.2rem; line-height: 1; letter-spacing: -1.5px; margin: 0; font-weight: 900;">${pick.actual_ticker}</h3>
                            <span style="font-size: 0.9rem; color: var(--text-primary); margin-top: 8px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${pick.company_name}</span>
                            <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px; font-weight: 500; opacity: 0.7;">${pick.industry}</span>
                        </div>
                        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
                            <div style="display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 8px;">
                                <span style="font-size: 0.6rem; color: var(--accent); font-weight: 800; opacity: 0.8; letter-spacing: 0.1em;">LAST CLOSE</span>
                                <span style="font-size: 1.8rem; font-weight: 800; color: var(--text-primary); line-height: 1; letter-spacing: -0.5px;">${formatPrice(price, pick.currency || 'USD')}</span>
                            </div>
                            ${renderExtendedHours(pick)}
                            <button class="glass-btn primary" style="padding: 0.4rem 1rem; font-size: 0.65rem; border-radius: 8px; margin-top: 1.25rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;"
                                    onclick="event.stopPropagation(); handleAddFeatured('${pick.actual_ticker}', this)">
                                + Track
                            </button>
                        </div>
                    </div>

                    <div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 0.5rem; flex-grow: 1;">
                        ${rationaleHtml}
                    </div>

                    <div style="font-size:0.7rem; color:var(--accent); text-align: right; margin-top: 1.8rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">
                        DETAILED REPORT &rarr;
                    </div>
                </div>
                `;
            }).join('');

            // --- Auto-Healing Logic ---
            const needsHealing = data.some(pick => {
                const isSafetyNet = typeof pick.rationale === 'string' && (
                    pick.rationale.includes('surfaced based on strong 1-month momentum signals') ||
                    pick.rationale.includes('AI synthesis in progress') ||
                    pick.rationale === ''
                );
                return isSafetyNet;
            });

            if (needsHealing && !window._isDiscoveryHealing) {
                debugLog("Discovery Agent: AI synthesis missing. Starting 30s auto-healing loop...");
                window._isDiscoveryHealing = true;

                const tickers = data.map(p => p.actual_ticker);
                triggerTargetedRefresh(tickers);

                const healInterval = setInterval(async () => {
                    const res = await fetch('/api/v1/daily_picks');
                    if (res.ok) {
                        const latestData = await res.json();
                        const stillNeedsHealing = latestData.some(pick => {
                            return typeof pick.rationale === 'string' && (
                                pick.rationale.includes('surfaced based on strong 1-month momentum signals') ||
                                pick.rationale.includes('AI synthesis in progress') ||
                                pick.rationale === ''
                            );
                        });

                        if (!stillNeedsHealing) {
                            debugLog("Discovery Agent: Healing complete. AI intelligence restored.");
                            clearInterval(healInterval);
                            window._isDiscoveryHealing = false;
                            showToast("Discovery AI intelligence restored.", "success");
                        } else {
                            debugLog("Discovery Agent: Still healing... retrying in 30s.");
                            triggerTargetedRefresh(tickers);
                        }
                    }
                }, 30000);
            }
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
        const ONE_HOUR_MS = 60 * 60 * 1000;

        for (const mkt of marketData) {
            const insight = insightMap[mkt.ticker];
            const hasNoInsight = !insight;
            const isStale = insight && (now - new Date(insight.timestamp).getTime()) > ONE_HOUR_MS;
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
                        .catch(() => { });
                }, delay);
            }
        }
    } catch (e) { }
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
    } catch (e) { }
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
    } catch (e) { }
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

            // Update Budget Controls inputs if they are not being edited
            const toggle = document.getElementById('budget-toggle-checkbox');
            const amountInput = document.getElementById('budget-amount-input');
            const totalCard = document.getElementById('budget-total-card');
            const utilizationCard = document.getElementById('budget-utilization-card');

            if (toggle) toggle.checked = data.budget_enabled;
            if (amountInput && !amountInput.dataset.editing) {
                amountInput.value = data.daily_budget_usd.toFixed(2);
            }

            // Hide/Show cards based on enabled status
            if (totalCard) totalCard.style.display = data.budget_enabled ? 'block' : 'none';
            if (utilizationCard) utilizationCard.style.display = data.budget_enabled ? 'block' : 'none';

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
            if (pBar) {
                pBar.style.width = `${Math.min(data.utilization_pct, 100)}%`;
                if (data.utilization_pct > 80) pBar.classList.add('danger');
                else pBar.classList.remove('danger');
            }
        }
    } catch (e) { }
}

function initBudgetControls() {
    const saveBtn = document.getElementById('save-budget-btn');
    const amountInput = document.getElementById('budget-amount-input');
    const toggle = document.getElementById('budget-toggle-checkbox');

    if (!saveBtn) return;

    amountInput.addEventListener('focus', () => { amountInput.dataset.editing = 'true'; });
    amountInput.addEventListener('blur', () => { setTimeout(() => delete amountInput.dataset.editing, 2000); });

    saveBtn.addEventListener('click', async () => {
        const amount = parseFloat(amountInput.value);
        const enabled = toggle.checked;

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            const res = await fetch('/api/v1/costs/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    daily_budget_usd: amount,
                    budget_enabled: enabled
                })
            });

            if (res.ok) {
                saveBtn.textContent = '✓ Saved';
                saveBtn.style.borderColor = 'var(--positive)';
                saveBtn.style.color = 'var(--positive)';
                setTimeout(() => {
                    saveBtn.textContent = 'Save';
                    saveBtn.style.borderColor = '';
                    saveBtn.style.color = '';
                    saveBtn.disabled = false;
                }, 2000);
                fetchCosts();
            } else {
                throw new Error('Save failed');
            }
        } catch (e) {
            saveBtn.textContent = 'Error';
            saveBtn.style.borderColor = 'var(--negative)';
            setTimeout(() => {
                saveBtn.textContent = 'Save';
                saveBtn.style.borderColor = '';
                saveBtn.disabled = false;
            }, 2000);
        }
    });
}

async function fetchDashboardCosts() {
    try {
        const res = await fetch('/api/v1/costs/dashboard');
        if (res.ok) {
            const data = await res.json();
            document.getElementById('dashboard-total-7d').textContent = formatPrice(data.metrics.total_7_days_usd);
            document.getElementById('dashboard-average-7d').textContent = formatPrice(data.metrics.daily_average_usd);
            document.getElementById('dashboard-projected-30d').textContent = formatPrice(data.metrics.projected_30_days_usd);
            drawSparkline('sparkline-7d', [1, 2, 1.5, 3, 2.5, 4, data.metrics.total_7_days_usd * 100], '#38bdf8');
            drawSparkline('sparkline-avg', [1, 1.5, 1.2, 1.8, 1.5, 1.9, data.metrics.daily_average_usd * 500], '#c084fc');
            drawSparkline('sparkline-30d', [10, 12, 11, 15, 14, 18, data.metrics.projected_30_days_usd * 20], '#10b981');
        }
    } catch (e) { }
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

        // Build gradient fill for premium background look (matches Gold commodity card)
        const gradCanvas = container.querySelector('canvas');
        const gradCtx = gradCanvas.getContext('2d');
        const gradient = gradCtx.createLinearGradient(0, 0, 0, 90);
        gradient.addColorStop(0, color + '55');
        gradient.addColorStop(1, color + '00');

        sparklineInstances[elementId] = new Chart(gradCtx, {
            type: 'line',
            data: { labels: dataset.map((_, i) => i), datasets: [{ data: dataset, borderColor: color, borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true, backgroundColor: gradient }] },
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
                        min: minVal - padding,
                        max: maxVal + padding,
                        beginAtZero: false
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

        // Sparkline update is now decoupled from the 15s poll.
        // It will only be drawn on initial load or manual refresh.
        const sparklineId = `sparkline-card-${mkt.ticker}`;
        const canvas = container.querySelector(`#${sparklineId} canvas`);
        if (!canvas && mkt.sparkline && mkt.sparkline.length > 0) {
            const color = mkt.change_pct >= 0 ? '#10b981' : '#f43f5e';
            drawSparkline(sparklineId, mkt.sparkline, color);
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
    wrapper.dataset.ticker = mkt.ticker;
    wrapper.dataset.company = mkt.company_name || '';
    wrapper.dataset.exchange = mkt.exchange || '';
    wrapper.dataset.price = mkt.close_price || 0;
    wrapper.dataset.change = mkt.change_pct || 0;
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

    // Targeted updates to preserve canvas/sparklines
    const priceEl = inner.querySelector('.card-price');
    if (priceEl) priceEl.textContent = formatPrice(mkt.close_price, mkt.currency);

    const changeEl = inner.querySelector('.card-change');
    if (changeEl) {
        let displayPct = mkt.change_pct;

        // If we are NOT in 1D view and we have a cached start price, recalculate
        if (currentPeriod !== '1d' && periodStartPrices[mkt.ticker]) {
            const first = periodStartPrices[mkt.ticker];
            const last = mkt.close_price;
            displayPct = ((last - first) / first) * 100;
        }

        const sign = displayPct >= 0 ? '+' : '';
        const pillClass = displayPct >= 0 ? 'pill-green' : 'pill-red';
        const cClass = displayPct >= 0 ? 'positive' : 'negative';

        changeEl.className = `${cClass} card-change ${pillClass}`;
        changeEl.textContent = `${sign}${displayPct.toFixed(2)}%`;
    }

    const insightEl = inner.querySelector('.insight-text');
    if (insightEl && insight) {
        // Only update text if it changed significantly to avoid flicker
        // For dashboard cards, only show 'WhatsHappening'
        const newText = formatInsight(insight.insight_text, null, ['WhatsHappening']);
        if (insightEl.innerHTML.length !== newText.length) {
            insightEl.innerHTML = newText + (insight ? '<div style="font-size:0.7rem; color:var(--accent); margin-top:0.4rem; opacity:0.8;">Click to expand full analysis →</div>' : '');
        }
    }

    // Update data attributes for filtering/sorting
    wrapper.dataset.price = mkt.close_price || 0;
    wrapper.dataset.change = mkt.change_pct || 0;
    wrapper.dataset.company = mkt.company_name || '';
    wrapper.dataset.exchange = mkt.exchange || '';
}


window.changeCardPeriod = async function (ticker, period) {
    const container = document.getElementById(`sparkline-card-${ticker}`);
    if (!container) return;

    cardPeriods[ticker] = period;

    // Highlight the button immediately
    const card = container.closest('.insight-card');
    if (card) {
        const btns = card.querySelectorAll('.card-period-btn');
        const labels = { '1d': '1D', '1w': '1W', '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y' };
        btns.forEach(b => b.classList.toggle('active', b.innerText === labels[period]));
    }

    container.style.opacity = '0.4';
    try {
        const response = await fetch(`/api/v1/market/history/${ticker}?period=${period}`);
        const data = await response.json();
        if (data.ohlcv && data.ohlcv.length > 0) {
            const closes = data.ohlcv.map(d => d.close).filter(c => c > 0);
            const color = closes[closes.length - 1] >= closes[0] ? '#10b981' : '#f43f5e';
            drawSparkline(`sparkline-card-${ticker}`, closes, color);
        }
    } catch (e) {
        console.error('Failed to update card sparkline', e);
    } finally {
        container.style.opacity = '1';
    }
};

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

    let displayPct = mkt.change_pct;
    // If we are NOT in 1D view and we have a cached start price, recalculate
    if (currentPeriod !== '1d' && periodStartPrices[mkt.ticker]) {
        const first = periodStartPrices[mkt.ticker];
        const last = mkt.close_price;
        displayPct = ((last - first) / first) * 100;
    }

    const isPos = displayPct >= 0;
    const sign = isPos ? '+' : '';
    const changeClass = isPos ? 'pill-green' : 'pill-red';
    const cClass = isPos ? 'positive' : 'negative';
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

            <div class="card-price-box">
                <div style="display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 2px;">
                    <span style="font-size: 0.55rem; color: var(--accent); font-weight: 700; opacity: 0.7; letter-spacing: 0.05em;">CLOSE</span>
                    <span class="card-price">${formatPrice(mkt.close_price, mkt.currency)}</span>
                </div>
                ${renderExtendedHours(mkt)}
                <span class="${cClass} card-change ${changeClass}">${sign}${displayPct.toFixed(2)}%</span>
            </div>
        </div>
        <div id="sparkline-card-${mkt.ticker}" class="card-sparkline-bg"></div>
        <div class="insight-text" style="margin-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.75rem;">
            ${insight ? formatInsight(insight.insight_text, null, ['WhatsHappening']) : 'Awaiting AI synthesis — click to view history.'}
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

    document.getElementById('modal-watchlist-btn').addEventListener('click', async () => {
        if (!currentModalTicker) return;
        await handleAddFeatured(currentModalTicker, document.getElementById('modal-watchlist-btn'));
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
    currentModalMkt = mkt;
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

    // Parse rationale to object if stored as JSON string
    let pickRationale = pick ? pick.rationale : null;
    if (typeof pickRationale === 'string') {
        try { pickRationale = JSON.parse(pickRationale); } catch(e) { /* keep as string */ }
    }

    currentModalInsight = {
        insight_text: pickRationale || 'Fetching full analysis...',
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
    if (!mkt.name) document.getElementById('modal-ticker-name').textContent = 'Loading company info...';

    // Signal badge
    const signal = insight ? (insight.signal || 'HOLD') : 'HOLD';
    const sigBadge = document.getElementById('modal-signal-badge');
    sigBadge.className = `signal-badge ${signal.toLowerCase()}`;
    sigBadge.textContent = signal;

    // Watchlist button
    const watchBtn = document.getElementById('modal-watchlist-btn');
    if (lastMarketData[ticker]) {
        watchBtn.style.display = 'none';
    } else {
        watchBtn.style.display = 'block';
        watchBtn.textContent = '+ Watchlist';
        watchBtn.disabled = false;
        watchBtn.style.borderColor = 'rgba(255,255,255,0.1)';
        watchBtn.style.color = 'var(--text-primary)';
    }

    // Hero stats (price, change, open, high, low)
    renderHeroStats(mkt);

    // AI Insight
    document.getElementById('modal-insight-text').innerHTML =
        insight ? formatInsight(insight.insight_text) : 'No AI synthesis available yet.';
    document.getElementById('modal-insight-meta').textContent =
        insight ? `Model: ${insight.model_used} · Cost: $${(insight.cost_usd || 0).toFixed(6)}` : ''; // Keep cost in USD for FinOps accuracy

    // News articles from card data
    renderModalNews(mkt);

    // If we already have info from a previous load, re-render key stats too
    if (mkt.info) {
        renderKeyStats(mkt.info, mkt);
        renderAboutSection(mkt.info);
    } else {
        // Clear key stats and analyst while loading
        document.getElementById('modal-key-stats').innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Loading statistics...</p>';
        document.getElementById('modal-analyst').innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Loading analyst data...</p>';
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
    const sign = isPos ? '+' : '';
    const changeColor = isPos ? 'var(--positive)' : 'var(--negative)';
    document.getElementById('modal-hero-stats').innerHTML = `
        <div class="hero-stat main">
            <div class="hero-stat-label">CLOSE PRICE</div>
            <div class="hero-stat-value main">${formatPrice(mkt.close_price, mkt.currency)}</div>
            ${renderExtendedHours(mkt)}
        </div>
        <div class="hero-stat main">
            <div class="hero-stat-label">DAY CHANGE</div>
            <div class="hero-stat-value main" style="color:${changeColor}">${sign}${(mkt.change_pct || 0).toFixed(2)}%</div>
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
    const fmtVol = v => v ? (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${(v / 1e3).toFixed(1)}K`) : '—';

    const stats = [
        { label: 'Market Cap', value: formatLargePrice(info.market_cap, mkt.currency) },
        { label: 'P/E Ratio', value: fmt(info.pe_ratio, false, 1) },
        { label: 'Fwd P/E', value: fmt(info.forward_pe, false, 1) },
        { label: 'EPS (TTM)', value: fmt(info.eps, true) },
        { label: 'Div. Yield', value: info.dividend_yield ? `${(info.dividend_yield * 100).toFixed(2)}%` : '—' },
        { label: 'Beta', value: fmt(info.beta, false, 2) },
        { label: '52W High', value: fmt(info['52w_high'], true) },
        { label: '52W Low', value: fmt(info['52w_low'], true) },
        { label: 'Mean Target', value: fmt(info.target_price, true) },
        { label: 'Volume', value: fmtVol(mkt.volume) },
        { label: 'Avg Volume', value: fmtVol(info.avg_volume) },
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
    let links = mkt.headline_links || [];
    const headlines = mkt.headlines || [];

    // Check for daily picks news field
    if (mkt.news) {
        try {
            const parsedNews = JSON.parse(mkt.news);
            if (parsedNews && parsedNews.length > 0) {
                links = parsedNews.map(n => ({
                    title: n.title,
                    url: n.link || n.url,
                    source: n.publisher || n.source,
                    published: (n.provider_publish_time * 1000) || n.published
                }));
            }
        } catch (e) { console.error("Modal news parse failed", e); }
    }

    if (links.length > 0) {
        container.innerHTML = links.slice(0, 5).map(h => {
            if (!h.title) return '';
            const pub = h.published ? new Date(h.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
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
        info.sector ? { label: info.sector } : null,
        info.industry ? { label: info.industry } : null,
        info.country ? { label: info.country } : null,
        info.exchange ? { label: info.exchange } : null,
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
            return period === '1d' ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : dt.toLocaleDateString();
        });
        const closes = data.ohlcv.map(d => d.close);

        // Update company name
        if (data.info && data.info.name) {
            document.getElementById('modal-ticker-name').textContent = data.info.name;
        }

        // Color based on trend
        const trendColor = closes[closes.length - 1] >= closes[0] ? '#10b981' : '#f43f5e';

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
                        ticks: {
                            color: '#94a3b8', callback: v => {
                                const { symbol, rate } = EXCHANGE_RATES[currentCurrency];
                                return `${symbol}${(v * rate).toFixed(0)}`;
                            }
                        },
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

    const total = (summary.strong_buy || 0) + (summary.buy || 0) + (summary.hold || 0) + (summary.sell || 0) + (summary.strong_sell || 0);
    if (total === 0) { container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">No analyst ratings on record.</p>'; return; }

    const rows = [
        { label: 'Strong Buy', count: summary.strong_buy || 0, color: '#10b981' },
        { label: 'Buy', count: summary.buy || 0, color: '#34d399' },
        { label: 'Hold', count: summary.hold || 0, color: '#94a3b8' },
        { label: 'Sell', count: summary.sell || 0, color: '#fb7185' },
        { label: 'Strong Sell', count: summary.strong_sell || 0, color: '#f43f5e' },
    ];

    container.innerHTML = rows.map(r => `
        <div class="analyst-row">
            <span class="analyst-label">${r.label}</span>
            <div class="analyst-bar-bg">
                <div class="analyst-bar-fill" style="width:${total ? (r.count / total * 100) : 0}%; background:${r.color};"></div>
            </div>
            <span class="analyst-count">${r.count}</span>
        </div>
    `).join('');
}

function formatInsight(text, limit = null, showOnly = null) {
    if (!text) return '';

    // Handle JSON strings (parsing if needed)
    let rationale = text;
    if (typeof text === 'string' && text.trim().startsWith('{')) {
        try { rationale = JSON.parse(text); } catch(e) { /* fallback to string */ }
    }

    // Handle structured Rationale (Object)
    if (typeof rationale === 'object' && !Array.isArray(rationale)) {
        let entries = Object.entries(rationale);
        
        // Filter if requested
        if (showOnly) {
            entries = entries.filter(([key]) => showOnly.includes(key));
        }
        
        // Limit if requested
        if (limit) {
            entries = entries.slice(0, limit);
        }

        return entries.map(([key, value]) => {
            // Clean up key name for display (e.g., "WhatsHappening" -> "WHAT'S HAPPENING")
            const label = key.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
            return `
            <div style="display: flex; gap: 1rem; align-items: flex-start; padding: 0.75rem 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                <div style="min-width: 110px; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); font-weight: 700; opacity: 0.8;">${label}</div>
                <p style="font-size: 0.9rem; color: var(--text-primary); line-height: 1.5; margin: 0; flex: 1;">${value}</p>
            </div>`;
        }).join('');
    }

    // Handle legacy strings or arrays
    let rawText = Array.isArray(text) ? text.join('\n') : String(text);
    let formatted = rawText.trim();

    const lines = formatted.split('\n');
    let bullets = [];
    let firstLine = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!firstLine) firstLine = trimmed;

        if (trimmed.match(/^(\d+\.|-|\*)\s?|^\u2022/)) {
            let content = trimmed.replace(/^(\d+\.|-|\*)\s?|^\u2022/, '').trim();
            if (content.includes(':')) {
                const parts = content.split(':');
                const category = parts.shift();
                const rest = parts.join(':');
                content = `<strong>${category}:</strong>${rest}`;
            }
            bullets.push(`<div class="insight-bullet">${content}</div>`);
            if (limit && bullets.length >= limit) break;
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
let _discoverNewsTimer = null;
let currentDiscoverPeriod = '1d';

// All symbols we need sparklines for (indices + commodities)
const DISCOVER_INDEX_SYMBOLS  = ['^AXJO','^GSPC','^IXIC','^STOXX50E','^FTSE','^N225','^HSI'];
const DISCOVER_COMMODITY_SYMBOLS = ['GC=F','SI=F','HG=F','PL=F','PA=F','CL=F'];
const ALL_DISCOVER_SYMBOLS = [...DISCOVER_INDEX_SYMBOLS, ...DISCOVER_COMMODITY_SYMBOLS];

// Sparkline chart instances keyed by symbol
const discoverSparklineInstances = {};

function initDiscoverPeriodSelector() {
    const selector = document.getElementById('discover-period-selector');
    if (!selector || selector.dataset.hooked) return;
    selector.addEventListener('click', (e) => {
        const btn = e.target.closest('.discover-period-btn');
        if (!btn) return;
        selector.querySelectorAll('.discover-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDiscoverPeriod = btn.dataset.period;
        fetchDiscoverSparklines(currentDiscoverPeriod);
    });
    selector.dataset.hooked = 'true';
}

async function fetchDiscoverData() {
    initDiscoverPeriodSelector();
    fetchDiscoverIndices();
    fetchDiscoverMovers();
    fetchDiscoverNews();
    fetchDailyPicks();  // also refresh daily picks when switching to Discover

    // Auto-refresh ALL Discover info every 30 minutes
    clearInterval(_discoverRefreshTimer);
    clearInterval(_discoverNewsTimer);
    _discoverRefreshTimer = setInterval(() => {
        fetchDiscoverIndices();
        fetchDiscoverMovers();
        fetchDiscoverNews();
        fetchDailyPicks();
    }, 30 * 60 * 1000);
}

async function fetchDiscoverIndices() {
    try {
        const res = await fetch('/api/v1/discover/indices');
        if (!res.ok) return;
        const data = await res.json();
        renderMarketIndices(data.regions || []);
        lastDiscoverCommodities = data.commodities || [];
        renderCommodities(lastDiscoverCommodities);
        // Kick off sparklines after cards are rendered
        fetchDiscoverSparklines(currentDiscoverPeriod);
    } catch (e) { console.error('Discover indices failed', e); }
}

let currentMoversFilter = 'all';
let lastMoversData = null;

function initMoversFilterSelector() {
    const selector = document.getElementById('movers-filter-selector');
    if (!selector || selector.dataset.hooked) return;
    selector.addEventListener('click', (e) => {
        const btn = e.target.closest('.discover-period-btn');
        if (!btn) return;
        selector.querySelectorAll('.discover-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMoversFilter = btn.dataset.filter;
        applyMoversFilter();
    });
    selector.dataset.hooked = 'true';
}

function applyMoversFilter() {
    if (!lastMoversData) return;
    const data = lastMoversData[currentMoversFilter] || { gainers: [], losers: [] };
    renderMovers('gainers-table', data.gainers || [], true);
    renderMovers('losers-table', data.losers || [], false);
}

async function fetchDiscoverMovers() {
    initMoversFilterSelector();
    try {
        const res = await fetch('/api/v1/discover/movers');
        if (!res.ok) return;
        const data = await res.json();
        lastMoversData = data;
        applyMoversFilter();

        if (data.as_of) {
            const d = new Date(data.as_of);

            document.getElementById('movers-as-of').textContent =
                `· as of ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
    } catch (e) { console.error('Discover movers failed', e); }
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
                `· updated ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
    } catch (e) { console.error('Discover news failed', e); }
}

/**
 * Async orchestrator: fetches batch sparkline data for all Discover cards in one API call,
 * then draws canvas trend lines on each card. Skeleton pulse shown on cards while loading.
 */
async function fetchDiscoverSparklines(period = '1d') {
    // Show skeleton opacity while loading
    document.querySelectorAll('.discover-sparkline-wrap').forEach(el => {
        el.style.opacity = '0.2';
    });

    try {
        const symbols = ALL_DISCOVER_SYMBOLS.join(',');
        const res = await fetch(`/api/v1/market/batch-history?symbols=${encodeURIComponent(symbols)}&period=${period}`);
        if (!res.ok) return;
        const data = await res.json();

        // Draw sparkline for each card by data-symbol attribute
        document.querySelectorAll('[data-discover-symbol]').forEach(card => {
            const sym = card.dataset.discoverSymbol;
            const closes = data[sym];
            if (!closes || closes.length < 2) return;

            const isPos = closes[closes.length - 1] >= closes[0];
            const color = isPos ? '#10b981' : '#f43f5e';
            const wrap = card.querySelector('.discover-sparkline-wrap');
            if (!wrap) return;

            drawDiscoverSparkline(wrap, sym, closes, color);

            // Update change badge to reflect the selected period
            const pctChange = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
            const badge = card.querySelector('.discover-change-badge');
            if (badge) {
                const sign = pctChange >= 0 ? '+' : '';
                badge.className = `discover-change-badge ${pctChange >= 0 ? 'pos' : 'neg'}`;
                badge.textContent = `${sign}${pctChange.toFixed(2)}%`;
            }

            // Restore opacity
            wrap.style.opacity = '0.5';
        });
    } catch (e) {
        console.error('Discover sparklines failed:', e);
    }
}

function drawDiscoverSparkline(container, symbol, dataset, color) {
    // Destroy stale instance if canvas is gone
    if (discoverSparklineInstances[symbol]) {
        if (!document.body.contains(discoverSparklineInstances[symbol].canvas)) {
            discoverSparklineInstances[symbol].destroy();
            delete discoverSparklineInstances[symbol];
        }
    }

    if (!discoverSparklineInstances[symbol]) {
        container.innerHTML = '<canvas></canvas>';
        const canvas = container.querySelector('canvas');
        const ctx = canvas.getContext('2d');
        const minVal = Math.min(...dataset);
        const maxVal = Math.max(...dataset);
        const range = maxVal - minVal;
        const padding = range === 0 ? 1 : range * 0.05;

        // Gradient fill for premium look
        const gradient = ctx.createLinearGradient(0, 0, 0, 52);
        gradient.addColorStop(0, color + '40');
        gradient.addColorStop(1, color + '00');

        discoverSparklineInstances[symbol] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dataset.map((_, i) => i),
                datasets: [{
                    data: dataset,
                    borderColor: color,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.4,
                    fill: true,
                    backgroundColor: gradient
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false }, datalabels: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false, min: minVal - padding, max: maxVal + padding, beginAtZero: false }
                },
                animation: { duration: 400 }
            }
        });
    } else {
        // Update existing instance
        const chart = discoverSparklineInstances[symbol];
        chart.data.datasets[0].data = dataset;
        chart.data.datasets[0].borderColor = color;
        chart.update('none');
    }
}

function _buildIndexCard(idx) {
    const isPos = idx.change_pct >= 0;
    const sign = isPos ? '+' : '';
    const priceStr = idx.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return `<div class="discover-index-card" data-discover-symbol="${idx.symbol}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div class="discover-index-name">${idx.name}</div>
                    <div style="text-align: right;">
                        <div class="discover-index-price" data-price>${priceStr}</div>
                        <span class="discover-change-badge ${isPos ? 'pos' : 'neg'}" data-badge>${sign}${idx.change_pct.toFixed(2)}%</span>
                    </div>
                </div>
                ${renderExtendedHours(idx)}
                <div class="discover-sparkline-wrap"></div>
            </div>`;
}

function renderMarketIndices(regions) {
    const el = document.getElementById('discover-indices');
    if (!el) return;

    // If cards already exist: patch text only — never destroy DOM or sparklines
    const alreadyBuilt = el.querySelector('[data-discover-symbol]');
    if (alreadyBuilt) {
        regions.forEach(r => {
            (r.indices || []).forEach(idx => {
                const card = el.querySelector(`[data-discover-symbol="${idx.symbol}"]`);
                if (!card) return;
                const isPos = idx.change_pct >= 0;
                const sign = isPos ? '+' : '';
                const priceEl = card.querySelector('[data-price]');
                const badgeEl = card.querySelector('[data-badge]');
                if (priceEl) priceEl.textContent = idx.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
                if (badgeEl) {
                    badgeEl.textContent = `${sign}${idx.change_pct.toFixed(2)}%`;
                    badgeEl.className = `discover-change-badge ${isPos ? 'pos' : 'neg'}`;
                }
            });
        });
        return;
    }

    // First load: build full HTML
    el.innerHTML = regions.map(r => {
        if (!r.indices || !r.indices.length) return '';
        const cards = r.indices.map(idx => _buildIndexCard(idx)).join('');
        return `<div class="discover-region-group">
            <div class="discover-region-label">${r.flag} ${r.region}</div>
            <div class="discover-region-cards">${cards}</div>
        </div>`;
    }).join('');
}

function _buildCommodityCard(c) {
    const isPos = c.change_pct >= 0;
    const sign = isPos ? '+' : '';
    let displayPrice = c.price;
    let displayUnit = c.unit;
    if (currentCommodityUnit === 'Metric') {
        if (c.unit === 'oz') { displayPrice = displayPrice / 28.3495; displayUnit = 'g'; }
        else if (c.unit === 'bbl') { displayPrice = displayPrice / 158.987; displayUnit = 'L'; }
    }
    return `<div class="discover-index-card" data-discover-symbol="${c.symbol}" data-commodity-icon="${c.icon}" data-commodity-name="${c.name}" data-commodity-unit="${c.unit}" data-commodity-currency="${c.currency || 'USD'}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div class="discover-region-label" style="border-bottom: none; margin-bottom: 0; padding-bottom: 0;">${c.icon} ${c.name}</div>
                <div style="text-align: right;">
                    <div style="display: flex; align-items: baseline; gap: 0.2rem; justify-content: flex-end;">
                        <span style="font-size: 1.4rem; font-weight: 700; color: var(--text-primary); line-height: 1;" data-price>${formatPrice(displayPrice, c.currency || 'USD')}</span>
                        <span style="font-size: 0.75rem; color: var(--text-secondary);" data-unit>/${displayUnit}</span>
                    </div>
                    <span class="discover-change-badge ${isPos ? 'pos' : 'neg'}" data-badge>${sign}${c.change_pct.toFixed(2)}%</span>
                </div>
            </div>
            <div class="discover-sparkline-wrap"></div>
        </div>`;
}

function renderCommodities(commodities) {
    const el = document.getElementById('discover-commodities');
    if (!el) return;

    // If cards already exist: patch numbers only — preserve sparkline canvases
    const alreadyBuilt = el.querySelector('[data-discover-symbol]');
    if (alreadyBuilt) {
        commodities.forEach(c => {
            const card = el.querySelector(`[data-discover-symbol="${c.symbol}"]`);
            if (!card) return;
            const isPos = c.change_pct >= 0;
            const sign = isPos ? '+' : '';
            let displayPrice = c.price;
            let displayUnit = c.unit;
            if (currentCommodityUnit === 'Metric') {
                if (c.unit === 'oz') { displayPrice = displayPrice / 28.3495; displayUnit = 'g'; }
                else if (c.unit === 'bbl') { displayPrice = displayPrice / 158.987; displayUnit = 'L'; }
            }
            const priceEl = card.querySelector('[data-price]');
            const unitEl  = card.querySelector('[data-unit]');
            const badgeEl = card.querySelector('[data-badge]');
            if (priceEl) priceEl.textContent = formatPrice(displayPrice, c.currency || 'USD');
            if (unitEl)  unitEl.textContent  = `/${displayUnit}`;
            if (badgeEl) {
                badgeEl.textContent = `${sign}${c.change_pct.toFixed(2)}%`;
                badgeEl.className = `discover-change-badge ${isPos ? 'pos' : 'neg'}`;
            }
        });
        return;
    }

    // First load: build full HTML
    el.innerHTML = commodities.map(c => _buildCommodityCard(c)).join('');
}

function renderMovers(tableId, movers, isGainer) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    if (!movers.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-secondary);text-align:center;padding:1rem;">No data yet</td></tr>';
        return;
    }
    tbody.innerHTML = movers.map((m, i) => {
        const sign = m.change_pct >= 0 ? '+' : '';
        const color = m.change_pct >= 0 ? '#10b981' : '#f43f5e';
        // Truncate long company names
        const name = (m.company_name || m.ticker).length > 22
            ? (m.company_name || m.ticker).substring(0, 20) + '…'
            : (m.company_name || m.ticker);
        return `<tr>
            <td><strong>${m.ticker}</strong></td>
            <td style="color:var(--text-secondary);font-size:0.8rem;">${name}</td>
            <td style="text-align:right;">
                <div>${formatPrice(m.price, m.currency || 'USD')}</div>
                ${renderExtendedHours(m)}
            </td>
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
        // Format: 11 May 2026, 14:30 (UTC+10)
        const dateStr = d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        const timeStr = d ? d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '';
        const tz = a.timezone || 'UTC';

        const fullTime = d ? `${dateStr}, ${timeStr} (${tz})` : '';
        const desc = a.description || '';

        // Remove currency symbols from news headlines (as requested)
        const title = (a.title || '').replace(/[\$\£\€\¥]/g, '');

        return `<div class="news-feed-item">
            <div class="news-feed-meta">
                <div class="news-feed-source" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: normal; line-height: 1.2;" title="${a.source || 'News'}">${a.source || 'News'}</div>
                <div class="news-feed-time" style="font-size: 0.6rem;">${fullTime}</div>
            </div>
            <div class="news-feed-content" style="flex: 1; min-width: 0;">
                <a class="news-feed-title" href="${a.url}" target="_blank" rel="noopener noreferrer" style="display: block;">${title}</a>
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
    NYQ: 'NYSE', NYS: 'NYSE',
    ASX: 'ASX',
    LSE: 'LSE', IOB: 'LSE',
    TYO: 'TSE', JPX: 'TSE',
    HKG: 'HKEX',
};
// Exchange → country bucket
const EXCHANGE_COUNTRY = {
    Nasdaq: 'US', NYSE: 'US',
    ASX: 'AU',
    LSE: 'EU',
    TSE: 'ASIA', HKEX: 'ASIA',
};

let _activeSortKey = 'name';

function initManageFilters() {
    const search = document.getElementById('asset-search');
    const country = document.getElementById('filter-country');
    const exchange = document.getElementById('filter-exchange');

    if (!search) return;

    search.addEventListener('input', applyManageFilters);
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
    const query = (document.getElementById('asset-search')?.value || '').toLowerCase().trim();
    const country = (document.getElementById('filter-country')?.value || '');
    const exchange = (document.getElementById('filter-exchange')?.value || '');

    const cards = Array.from(document.querySelectorAll('#insights-container .insight-card, #insights-container [data-ticker]'));
    if (!cards.length) return;

    cards.forEach(card => {
        const ticker = (card.dataset.ticker || '').toLowerCase();
        const company = (card.dataset.company || '').toLowerCase();
        const exc = EXCHANGE_MAP[card.dataset.exchange] || card.dataset.exchange || '';
        const cntry = EXCHANGE_COUNTRY[exc] || '';

        const matchQuery = !query || ticker.includes(query) || company.includes(query);
        const matchCountry = !country || cntry === country;
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
            case 'price-desc': return bP - aP;
            case 'price-asc': return aP - bP;
            case 'change-desc': return bC - aC;
            case 'change-asc': return aC - bC;
            default: return aT.localeCompare(bT);
        }
    });
    visible.forEach(c => container.appendChild(c));
}


function showToast(message, type = 'positive') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Fade in
    setTimeout(() => toast.classList.add('visible'), 10);

    // Remove after 4s
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

async function triggerTargetedRefresh(tickers) {
    if (!tickers || tickers.length === 0) return;
    try {
        debugLog("Discovery Agent: Triggering targeted refresh for", tickers);
        await fetch('/api/v1/discover/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickers: tickers })
        });
    } catch (e) {
        console.error("Discovery Agent: Targeted refresh failed", e);
    }
}
