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
let currentPortfolioPeriod = '1d';

let modalChartInstance = null;
let modalFinancialsChartInstance = null;
let modalForecastChartInstance = null;
const sparklineInstances = {};
let currentZoom = 1.0;
let currentModalTicker = null;
let currentPeriod = '1d'; // Start with 1D as default for live change
let currentModalMkt = {};
let currentModalInsight = null;
let currentModalFundamentals = null;
let currentModalEPS = null;
let modalEPSChartInstance = null;
let currentModalHistoryData = null;

// All symbols we need sparklines for (indices + commodities)
const DISCOVER_INDEX_SYMBOLS = ['^AXJO', '^GSPC', '^IXIC', '^STOXX50E', '^FTSE', '^N225', '^HSI', '^GDAXI', '^GSPTSE'];
const DISCOVER_COMMODITY_SYMBOLS = ['GC=F', 'SI=F', 'HG=F', 'PL=F', 'PA=F', 'CL=F'];
const COMMODITY_NAMES = {
    'GC=F': 'Gold',
    'SI=F': 'Silver',
    'HG=F': 'Copper',
    'PL=F': 'Platinum',
    'PA=F': 'Palladium',
    'CL=F': 'Crude Oil'
};
const ALL_DISCOVER_SYMBOLS = [...DISCOVER_INDEX_SYMBOLS, ...DISCOVER_COMMODITY_SYMBOLS];

// Track starting price for the selected trend period
const periodStartPrices = {};
function getSliceLen(period) {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const diff = now - startOfYear;
    const ytdDays = Math.floor(diff / (1000 * 60 * 60 * 24)) * 5/7; // Estimate trading days
    
    const daysMap = { 
        '1d': 1, 
        '1w': 5, 
        '1m': 22, 
        '1mo': 22, 
        '3m': 66, 
        '3mo': 66, 
        '6m': 132, 
        '6mo': 132, 
        'ytd': Math.max(1, Math.round(ytdDays)),
        '1y': 252,
        '5y': 1260
    };
    return daysMap[period] || 252;
}


// Master History Cache (1-Year Daily)
let MASTER_HISTORY = {};
let MASTER_TIMESTAMPS = [];
let isMasterHistorySyncing = false;
let isMasterHistoryLoaded = false;

// Snapshot of last known data for diff-and-patch
let lastMarketData = {};
let lastInsightsData = {};
let dailyPicksData = {};
let lastDiscoverCommodities = [];

let currentCurrency = 'DEFAULT';
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
        'NMS': '🇺🇸 NASDAQ',
        'NGM': '🇺🇸 NASDAQ',
        'NCM': '🇺🇸 NASDAQ',
        'NASDAQ': '🇺🇸 NASDAQ',
        'NYQ': '🇺🇸 NYSE',
        'NYSE': '🇺🇸 NYSE',
        'ASE': '🇺🇸 AMEX',
        'AMEX': '🇺🇸 AMEX',
        'PNK': '🇺🇸 OTC',
        'OTC': '🇺🇸 OTC',
        'BTS': '🇺🇸 BATS',
        'BATS': '🇺🇸 BATS',
        'ASX': '🇦🇺 ASX',
        'LSE': '🇬🇧 LSE',
        'JPX': '🇯🇵 JPX',
        'TSE': '🇯🇵 TSE',
        'TYO': '🇯🇵 TYO',
        'TSX': '🇨🇦 TSX',
        'TOR': '🇨🇦 TSX',
        'DAX': '🇩🇪 DAX',
        'GER': '🇩🇪 GER',
        'FRA': '🇩🇪 FRA',
        'PAR': '🇫🇷 PAR',
        'AMS': '🇳🇱 AMS',
        'MIL': '🇮🇹 MIL',
        'MAD': '🇪🇸 MAD',
        'SWX': '🇨🇭 SWX'
    };
    return map[upper] || upper;
}

function isGlobalOrCommodity(ticker) {
    if (!ticker) return false;
    const t = ticker.toUpperCase();
    return t.startsWith('^') || t.endsWith('=F') || 
           DISCOVER_INDEX_SYMBOLS.includes(t) || 
           DISCOVER_COMMODITY_SYMBOLS.includes(t);
}

function renderSentimentBadges(sentiment_label, sentiment_score, social_volume, ticker = null) {
    if (ticker && isGlobalOrCommodity(ticker)) {
        return '';
    }
    if (!sentiment_label && sentiment_score === undefined && social_volume === undefined) {
        return '';
    }
    
    let html = '<div class="sentiment-row">';
    if (sentiment_label) {
        const label = sentiment_label.toUpperCase();
        const sClass = label.includes('BULLISH') ? 'bullish' : (label.includes('BEARISH') ? 'bearish' : 'neutral');
        const emoji = sClass === 'bullish' ? '📈' : (sClass === 'bearish' ? '📉' : '⚖️');
        const scoreText = (sentiment_score !== undefined && sentiment_score !== null) ? ` (${sentiment_score >= 0 ? '+' : ''}${parseFloat(sentiment_score).toFixed(2)})` : '';
        html += `<span class="sentiment-badge ${sClass}">${emoji} ${label}${scoreText}</span>`;
    }
    if (social_volume !== undefined && social_volume !== null && social_volume > 0) {
        html += `<span class="social-volume-badge">🔥 r/wallstreetbets: ${social_volume}</span>`;
    }
    html += '</div>';
    return html;
}

function generateSentimentExplanation(label, score, volume, ticker = null, changePct = null) {
    if (!label && score === undefined && volume === undefined) return '';

    const labelUpper = (label || '').toUpperCase();
    const isBullish = labelUpper.includes('BULL');
    const isBearish = labelUpper.includes('BEAR');
    const tickerName = ticker ? ticker.toUpperCase() : 'this asset';
    
    // Hash of the ticker name to select unique comment variants
    const hash = ticker ? (ticker.split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0) >>> 0) : 0;
    
    let sentimentDescription = '';
    if (isBullish) {
        const bullishVariants = [
            `retail interest in <strong>${tickerName}</strong> is surging on expectations of near-term growth catalysts and bullish options positioning. Retail traders on r/wallstreetbets are actively discussing call option sweeps and positive earnings momentum.`,
            `momentum buyers are clustering around <strong>${tickerName}</strong>, driving a wave of retail FOMO. Discussion threads highlight strong volume spikes and retail hype, with traders targeting key resistance levels.`,
            `retail sentiment indicates a strong belief that <strong>${tickerName}</strong> is currently undervalued or primed for a turnaround. Board discussions focus on accumulation, with long-term retail holders expressing confidence in the asset's underlying recovery story.`,
            `chatter around <strong>${tickerName}</strong> centers on new product launches, expansion updates, and high retail popularity, causing buyers to dominate discussions with highly optimistic short-term price targets.`
        ];
        sentimentDescription = bullishVariants[hash % bullishVariants.length];
    } else if (isBearish) {
        const bearishVariants = [
            `retail traders are increasingly defensive on <strong>${tickerName}</strong>, with discussions focusing heavily on buying downside protection (puts) and hedging. Caution is driven by perceived overhead resistance and negative technical patterns.`,
            `negative chatter dominates the forums for <strong>${tickerName}</strong>, reflecting concerns over industry-wide headwinds, margin pressures, or disappointing news flow. Active retail short-sellers are targeting support levels.`,
            `a wave of retail disappointment or panic-selling discussions has emerged for <strong>${tickerName}</strong>. Sentiment is weighed down by recent news, with many retail accounts reporting stop-losses being triggered or de-risking positions.`,
            `retail sentiment leans negative as discussions point to overvaluation concerns or sector rotations away from assets like <strong>${tickerName}</strong>, leading to a general consensus of cautious or bearish expectations.`
        ];
        sentimentDescription = bearishVariants[hash % bearishVariants.length];
    } else {
        const neutralVariants = [
            `retail discussion around <strong>${tickerName}</strong> suggests a period of consolidation. Traders are generally on the sidelines, waiting for a definitive breakout or fresh fundamental news before taking new directional positions.`,
            `the retail community is highly divided on the outlook for <strong>${tickerName}</strong>, leading to a balanced, range-bound sentiment. Debate remains active between bulls advocating for accumulation and bears arguing for further correction.`,
            `interest in <strong>${tickerName}</strong> is relatively muted in retail forums, indicating a lack of near-term speculative hype or major retail-driven catalysts. Trading activity is primarily driven by institutional action rather than retail momentum.`,
            `chatter regarding <strong>${tickerName}</strong> is largely macro-focused, with retail investors taking a wait-and-see approach. Discussions are centered on broader interest rate decisions, inflation data, or upcoming industry conferences rather than company-specific events.`
        ];
        sentimentDescription = neutralVariants[hash % neutralVariants.length];
    }

    let dynamicAnalysis = '';
    if (ticker && changePct !== null && changePct !== undefined) {
        const changeVal = parseFloat(changePct);
        const percentStr = `${changeVal >= 0 ? '+' : ''}${changeVal.toFixed(2)}%`;
        
        if (isBullish) {
            if (changeVal > 1.5) {
                const variants = [
                    ` For <strong>${tickerName}</strong>, this retail optimism is highly correlated with the strong upward price momentum (<strong>${percentStr}</strong>) observed in today's trading session, suggesting that retail FOMO and buying pressure are supporting the rally.`,
                    ` The price advance of <strong>${percentStr}</strong> matches the positive buzz in r/wallstreetbets, indicating that retail momentum is acting as a strong wind in the sails of today's upward movement.`,
                    ` As <strong>${tickerName}</strong> advances by <strong>${percentStr}</strong>, the bullish retail commentary shows strong support from momentum-chasers who are targeting higher breakout levels.`
                ];
                dynamicAnalysis = variants[hash % variants.length];
            } else if (changeVal < -1.5) {
                const variants = [
                    ` Notably, despite <strong>${tickerName}</strong>'s price decline of <strong>${percentStr}</strong> today, the bullish retail sentiment indicates strong dip-buying behavior or options accumulation (calls) in r/wallstreetbets, pointing to a contrarian retail view.`,
                    ` Interestingly, while the market has pushed <strong>${tickerName}</strong> down by <strong>${percentStr}</strong> today, the retail crowd is expressing high conviction, viewing the drop as a discount buy opportunity.`,
                    ` Even with <strong>${tickerName}</strong> down <strong>${percentStr}</strong>, retail comments remain stubbornly bullish, suggesting that retail options traders are loading up on calls in anticipation of a fast bounce.`
                ];
                dynamicAnalysis = variants[hash % variants.length];
            } else {
                const variants = [
                    ` For <strong>${tickerName}</strong>, the optimistic retail outlook matches the relatively stable intraday price action (<strong>${percentStr}</strong>), reflecting steady accumulation and constructive expectations for the stock's near-term performance.`,
                    ` With <strong>${tickerName}</strong>'s price consolidating near <strong>${percentStr}</strong> today, the bullish sentiment suggests that the retail community is quietly accumulating shares, anticipating a breakout.`,
                    ` Retail chatter remains positive despite the flat intraday movement of <strong>${percentStr}</strong>, suggesting underlying support and retail patience for the next catalyst.`
                ];
                dynamicAnalysis = variants[hash % variants.length];
            }
        } else if (isBearish) {
            if (changeVal < -1.5) {
                const variants = [
                    ` For <strong>${tickerName}</strong>, this retail negativity aligns with today's sharp price decline of <strong>${percentStr}</strong>, showing that retail traders are actively pricing in negative news, de-risking positions, or purchasing downside protection (puts).`,
                    ` The slide of <strong>${percentStr}</strong> today has reinforced the bearish view in retail channels, with many traders on r/wallstreetbets expressing concern over further downside risks.`,
                    ` As <strong>${tickerName}</strong> drops <strong>${percentStr}</strong>, bearish discussions are surging, with retail users pointing to technical breakdowns and negative news headlines.`
                ];
                dynamicAnalysis = variants[hash % variants.length];
            } else if (changeVal > 1.5) {
                const variants = [
                    ` Interestingly, despite <strong>${tickerName}</strong> rallying <strong>${percentStr}</strong> today, the bearish retail sentiment indicates a significant degree of skepticism or active short-selling/put positioning among retail traders, anticipating a potential trend reversal.`,
                    ` While <strong>${tickerName}</strong> is up <strong>${percentStr}</strong>, the retail crowd remains highly skeptical, treating this rise as a temporary rally to short rather than a sustainable breakout.`,
                    ` The price advance of <strong>${percentStr}</strong> has been met with retail disbelief, with r/wallstreetbets threads focusing on overbought indicators and buying puts.`
                ];
                dynamicAnalysis = variants[hash % variants.length];
            } else {
                const variants = [
                    ` For <strong>${tickerName}</strong>, the defensive retail outlook matches the quiet or flat price movement of <strong>${percentStr}</strong>, reflecting caution and risk-reduction rather than aggressive selling.`,
                    ` With the price consolidating near <strong>${percentStr}</strong>, the bearish sentiment suggests retail traders are slowly trimming their exposure to <strong>${tickerName}</strong>, anticipating near-term pressure.`,
                    ` Quiet price action of <strong>${percentStr}</strong> coincides with retail caution, indicating that market participants are reluctant to enter long positions at current levels.`
                ];
                dynamicAnalysis = variants[hash % variants.length];
            }
        } else { // Neutral
            if (Math.abs(changeVal) > 2) {
                const variants = [
                    ` For <strong>${tickerName}</strong>, despite significant price volatility today (<strong>${percentStr}</strong>), retail sentiment remains neutral, indicating mixed reactions or consensus uncertainty.`,
                    ` Although <strong>${tickerName}</strong> experienced a sharp move of <strong>${percentStr}</strong> today, retail chatter is highly divided, leaving the overall sentiment index in neutral territory as bulls and bears fight for control.`,
                    ` The intraday swing of <strong>${percentStr}</strong> has generated balanced arguments, with retail discussions showing no clear consensus on whether the move represents a breakout or a trap.`
                ];
                dynamicAnalysis = variants[hash % variants.length];
            } else {
                const variants = [
                    ` This neutral sentiment aligns with the range-bound price action of <strong>${percentStr}</strong> today, indicating that retail interest is in a holding pattern awaiting clearer macro or fundamental catalysts.`,
                    ` The quiet trading session (<strong>${percentStr}</strong>) matches the lack of retail conviction, as discussion forums focus on other market sectors instead of <strong>${tickerName}</strong>.`,
                    ` With <strong>${tickerName}</strong> trading flat at <strong>${percentStr}</strong>, the neutral retail response highlights a lack of momentum and a general wait-and-see attitude from retail investors.`
                ];
                dynamicAnalysis = variants[hash % variants.length];
            }
        }
    }

    let scoreExplanation = '';
    if (score !== undefined && score !== null) {
        const absScore = Math.abs(parseFloat(score));
        let strength = 'mild';
        if (absScore > 0.6) strength = 'extreme';
        else if (absScore > 0.3) strength = 'moderate';
        
        if (isBullish) {
            const scoreVariants = [
                ` A sentiment index score of <strong>+${parseFloat(score).toFixed(2)}</strong> reflects a <strong>${strength}</strong> concentration of bullish terms, particularly words like <em>growth, calls, surge, and rally</em>.`,
                ` The positive score of <strong>${parseFloat(score).toFixed(2)}</strong> confirms a <strong>${strength}</strong> dominance of optimistic language (e.g. <em>buy, moon, profit</em>) across scanned retail comments.`,
                ` The score stands at <strong>+${parseFloat(score).toFixed(2)}</strong>, highlighting a <strong>${strength}</strong> preference for bullish setups and long options sentiment among active traders.`
            ];
            scoreExplanation = scoreVariants[hash % scoreVariants.length];
        } else if (isBearish) {
            const scoreVariants = [
                ` A sentiment index score of <strong>${parseFloat(score).toFixed(2)}</strong> reflects a <strong>${strength}</strong> concentration of bearish terms, particularly words like <em>risk, puts, drop, and pressure</em>.`,
                ` The negative score of <strong>${parseFloat(score).toFixed(2)}</strong> confirms a <strong>${strength}</strong> dominance of pessimistic language (e.g. <em>sell, loss, decline</em>) across scanned retail comments.`,
                ` The score stands at <strong>${parseFloat(score).toFixed(2)}</strong>, highlighting a <strong>${strength}</strong> preference for bearish setups and short positioning/puts among active traders.`
            ];
            scoreExplanation = scoreVariants[hash % scoreVariants.length];
        } else {
            const scoreVariants = [
                ` The lexical score of <strong>${parseFloat(score).toFixed(2)}</strong> indicates a balanced density of positive and negative keywords, reflecting uncertainty or lack of directional bias.`,
                ` A score of <strong>${parseFloat(score).toFixed(2)}</strong> shows keyword counts are evenly split, confirming mixed expectations and low directional conviction.`,
                ` Standing at <strong>${parseFloat(score).toFixed(2)}</strong>, the score reveals that neither side is dominant in the current discussion stream.`
            ];
            scoreExplanation = scoreVariants[hash % scoreVariants.length];
        }
    }

    let volumeExplanation = '';
    if (volume !== undefined && volume !== null && volume > 0) {
        if (volume > 50) {
            const volumeVariants = [
                ` A high r/wallstreetbets volume of <strong>${volume}</strong> mentions reveals a massive spike in retail attention, making it a highly discussed meme or high-beta candidate today.`,
                ` The substantial volume of <strong>${volume}</strong> posts shows that <strong>${tickerName}</strong> is currently a hot topic, ranking high in trending retail discussions.`,
                ` With <strong>${volume}</strong> active discussions, <strong>${tickerName}</strong> is attracting intense retail eyes, signifying high liquidity and retail crowd interest.`
            ];
            volumeExplanation = volumeVariants[hash % volumeVariants.length];
        } else if (volume >= 10) {
            const volumeVariants = [
                ` The r/wallstreetbets volume of <strong>${volume}</strong> indicates an active level of discussions in retail communities.`,
                ` Scanned retail forums show a moderate volume of <strong>${volume}</strong> mentions, showing steady interest but not a runaway retail frenzy.`,
                ` The volume of <strong>${volume}</strong> posts indicates that <strong>${tickerName}</strong> remains on the radar of active retail option and swing traders.`
            ];
            volumeExplanation = volumeVariants[hash % volumeVariants.length];
        } else {
            const volumeVariants = [
                ` A low volume of <strong>${volume}</strong> mentions suggests that while <strong>${tickerName}</strong> is discussed, it is not currently the primary focus of retail speculative flow.`,
                ` The <strong>${volume}</strong> posts detected indicate sparse retail chatter, pointing to institutional or fundamental drivers rather than retail speculation.`,
                ` Low volume (<strong>${volume}</strong> posts) shows that the stock is flying under the radar of the main r/wallstreetbets discussion boards.`
            ];
            volumeExplanation = volumeVariants[hash % volumeVariants.length];
        }
    }

    return `
        <div style="font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--accent); letter-spacing: 0.05em; margin-bottom: 0.4rem; display: flex; align-items: center; gap: 0.4rem;">
            <span>🤖 AI Explanation</span>
        </div>
        <p style="margin: 0; color: #e2e8f0; font-size: 0.85rem; line-height: 1.6;">
            Retail sentiment is classified as <strong>${labelUpper || 'NEUTRAL'}</strong>. This means ${sentimentDescription}${dynamicAnalysis}${scoreExplanation}${volumeExplanation}
        </p>
    `;
}

function formatPrice(value, tickerCurrency = 'USD', forceLocal = false, ticker = null) {
    if (value === null || value === undefined) return 'N/A';

    // If it's an index/exchange, format as raw points (no currency symbol, no FX conversion)
    const isIndex = ticker && (ticker.startsWith('^') || DISCOVER_INDEX_SYMBOLS.includes(ticker));
    if (isIndex) {
        return value.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    // Normalize ticker currency
    let tc = tickerCurrency;
    if (tc === 'GBp') tc = 'GBP'; // Convert British Pence to Pounds for rate lookup
    if (!EXCHANGE_RATES[tc]) tc = 'USD';

    // If currentCurrency is DEFAULT, show local currency. Otherwise convert to currentCurrency.
    const isDefaultView = currentCurrency === 'DEFAULT';
    const useLocal = forceLocal || isDefaultView;

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

function formatLargePrice(value, tickerCurrency = 'USD', ticker = null) {
    if (value === null || value === undefined || value === 0) return '—';

    const isIndex = ticker && (ticker.startsWith('^') || DISCOVER_INDEX_SYMBOLS.includes(ticker));
    if (isIndex) {
        return formatPrice(value, tickerCurrency, false, ticker);
    }

    // Normalize ticker currency for symbol lookup
    let tc = tickerCurrency === 'GBp' ? 'GBP' : tickerCurrency;
    if (!EXCHANGE_RATES[tc]) tc = 'USD';

    const isDefaultView = currentCurrency === 'DEFAULT';
    const targetCurrency = isDefaultView ? tc : currentCurrency;

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
    return formatPrice(value, tickerCurrency, false, ticker);
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
   Master History Cache (1-Year Daily)
   ===================================================== */
async function syncMasterHistory() {
    if (isMasterHistorySyncing) return;
    isMasterHistorySyncing = true;

    debugLog("Syncing 1-Year Master History...");

    // Combine all tickers: Portfolio + Discovery
    const portfolioTickers = Object.keys(lastMarketData);
    const discoveryTickers = ALL_DISCOVER_SYMBOLS || [];
    const allTickers = Array.from(new Set([...portfolioTickers, ...discoveryTickers]));

    if (allTickers.length === 0) {
        isMasterHistorySyncing = false;
        return;
    }

    try {
        const res = await fetch(`/api/v1/market/master-history?symbols=${encodeURIComponent(allTickers.join(','))}`);
        if (!res.ok) throw new Error("Master sync failed");

        const data = await res.json();
        if (data && data.data) {
            MASTER_HISTORY = data.data;
            MASTER_TIMESTAMPS = data.timestamps || [];
            isMasterHistoryLoaded = true;
            debugLog(`Master History Synced: ${Object.keys(MASTER_HISTORY).length} symbols, ${MASTER_TIMESTAMPS.length} timestamps`);

            // Trigger UI refresh for any non-1d charts
            if (currentPortfolioPeriod !== '1d') updatePortfolioChart(Object.values(lastMarketData), true);
            if (currentDiscoverPeriod !== '1d') fetchDiscoverSparklines(currentDiscoverPeriod);
        }
    } catch (e) {
        console.error("syncMasterHistory failed:", e);
    } finally {
        isMasterHistorySyncing = false;
    }
}

function calculateChange(start, end) {
    if (!start || start === 0) return 0;
    return ((end - start) / start) * 100;
}

let selectedTimezone = localStorage.getItem('user_market_timezone') || 'auto';

function initLocalClock() {
    const container = document.getElementById('local-clock-container');
    const clockEl = document.getElementById('local-clock-time');
    const dropdown = document.getElementById('timezone-dropdown-menu');
    const autoLabel = document.getElementById('auto-tz-label');
    
    if (!clockEl || !container || !dropdown) return;
    
    // Set active class in list on startup
    const options = dropdown.querySelectorAll('.timezone-option');
    options.forEach(opt => {
        if (opt.dataset.tz === selectedTimezone) {
            opt.classList.add('active');
        } else {
            opt.classList.remove('active');
        }
    });

    // Detect browser auto timezone
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localTzName = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || 'Local';
    if (autoLabel) {
        autoLabel.textContent = localTzName;
    }

    const tzMeta = {
        'America/New_York': { flag: '🇺🇸', name: 'NY' },
        'Europe/London': { flag: '🇬🇧', name: 'LDN' },
        'Asia/Tokyo': { flag: '🇯🇵', name: 'TYO' },
        'Asia/Hong_Kong': { flag: '🇭🇰', name: 'HKG' },
        'Australia/Sydney': { flag: '🇦🇺', name: 'SYD' },
        'Europe/Berlin': { flag: '🇪🇺', name: 'FRA' }
    };

    function updateClock() {
        const now = new Date();
        
        // 1. Render Local Clock (Date before Time, timezone after)
        const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
        const localDateStr = now.toLocaleDateString(undefined, dateOptions);
        
        const localTimeStr = now.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        const localTzPart = new Intl.DateTimeFormat(undefined, {
            timeZoneName: 'short'
        }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || '';
        
        let htmlText = `<div>${localDateStr} · ${localTimeStr} ${localTzPart}</div>`;
        
        // 2. Render Modified Clock next to it if active
        if (selectedTimezone && selectedTimezone !== 'auto') {
            const meta = tzMeta[selectedTimezone] || { flag: '🌐', name: 'TZ' };
            const targetDateStr = now.toLocaleDateString(undefined, {
                timeZone: selectedTimezone,
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            const targetTimeStr = now.toLocaleTimeString('en-US', {
                timeZone: selectedTimezone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            const targetTzPart = new Intl.DateTimeFormat('en-US', {
                timeZone: selectedTimezone,
                timeZoneName: 'short'
            }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || '';
            
            htmlText += `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:0.25rem; display:flex; align-items:center; gap:0.25rem; font-weight: 500;">
                ${meta.flag} ${meta.name}: ${targetDateStr} · ${targetTimeStr} ${targetTzPart}
            </div>`;
            clockEl.style.display = 'flex';
            clockEl.style.flexDirection = 'column';
            clockEl.style.alignItems = 'flex-start';
            clockEl.style.justifyContent = 'center';
        } else {
            clockEl.style.display = '';
            clockEl.style.flexDirection = '';
            clockEl.style.alignItems = '';
            clockEl.style.justifyContent = '';
        }
        
        clockEl.innerHTML = htmlText;
    }

    // Toggle Dropdown when clicking clock
    container.addEventListener('click', (e) => {
        // Prevent click inside option from closing before handling
        if (e.target.closest('.timezone-option')) return;
        dropdown.classList.toggle('show');
    });

    // Handle Timezone Option Clicks
    options.forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent clock container toggle handler
            selectedTimezone = opt.dataset.tz;
            localStorage.setItem('user_market_timezone', selectedTimezone);
            
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            
            dropdown.classList.remove('show');
            updateClock();
        });
    });

    // Close Dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });

    updateClock();
    setInterval(updateClock, 1000);
}

/* =====================================================
   Bootstrap
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
    initLocalClock();
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
    initDefinitionModal();
    initDiscoverTiming();
    initStockSearch();
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
            const reportDate = row.report_date ? row.report_date.split(/[T ]/)[0] : '—';
            return `
                <tr onclick="openTickerModal('${row.ticker}')" style="cursor:pointer;">
                    <td><a href="https://finance.yahoo.com/quote/${row.ticker}" target="_blank" class="screener-ticker" onclick="event.stopPropagation()">${row.ticker}</a></td>
                    <td><div class="screener-company" title="${row.company_name}">${row.company_name}</div></td>
                    <td style="font-size:0.75rem; color:var(--text-secondary);">${reportDate}</td>
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
        const indicator = th.querySelector('.sort-indicator');

        if (th.dataset.sort === qmjSortKey) {
            th.classList.add('active');
            const symbol = qmjSortDir === 'asc' ? '↑' : '↓';
            if (indicator) {
                indicator.textContent = symbol;
            } else {
                th.innerHTML = th.innerHTML.replace(/[↕↑↓]/g, symbol);
            }
        } else {
            if (indicator) {
                indicator.textContent = '↕';
            } else {
                th.innerHTML = th.innerHTML.replace(/[↕↑↓]/g, '↕');
            }
        }
    });
}

const COLUMN_DEFINITIONS = {
    'QMJ Score': '<strong>Quality Minus Junk</strong>: A composite z-score that ranks companies based on Profitability, Growth, Safety, and Momentum. Higher scores indicate higher quality assets relative to their peers.',
    'Profitability': '<strong>Profitability (GP/A)</strong>: Measured as Gross Profits divided by Total Assets. This is a clean measure of economic performance that is less prone to accounting manipulation.',
    'Growth': '<strong>Growth</strong>: Measured as the year-over-year growth in profitability. High growth scores indicate companies that are consistently improving their economic efficiency.',
    'Safety': '<strong>Safety</strong>: A composite of low leverage and low volatility. Quality companies typically maintain manageable debt levels and exhibit stable price behavior.',
    'Value': '<strong>Value (Earnings Yield)</strong>: Measured as EBIT divided by Enterprise Value. Identifies companies that are undervalued relative to their operating earnings.',
    'Momentum': '<strong>12M Momentum</strong>: The price return over the past 12 months, skipping the most recent month to avoid short-term reversals. Quality stocks often exhibit persistent price trends.'
};

window.openDefinitionModal = function (term) {
    const modal = document.getElementById('definition-modal');
    const title = document.getElementById('definition-title');
    const content = document.getElementById('definition-content');

    if (modal && title && content) {
        title.innerText = term;
        content.innerHTML = COLUMN_DEFINITIONS[term] || 'No definition available.';
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
};

window.closeDefinitionModal = function () {
    const modal = document.getElementById('definition-modal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
};

function initDefinitionModal() {
    const backdrop = document.getElementById('definition-modal');
    if (!backdrop) return;
    backdrop.addEventListener('click', e => {
        if (e.target === backdrop) closeDefinitionModal();
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
        if (!managePanel.contains(e.target) && e.target !== manageBtn && !e.target.closest('.modal-backdrop')) {
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

                        // Update card wrapper trend class
                        if (changePct < 0) card.classList.add('trend-negative');
                        else card.classList.remove('trend-negative');
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
    if (!list) return;

    let customOrder = [];
    try {
        customOrder = JSON.parse(localStorage.getItem('insights_custom_ticker_order') || '[]');
    } catch (e) {
        customOrder = [];
    }

    const tickers = Object.keys(lastMarketData);
    tickers.sort((a, b) => {
        const idxA = customOrder.indexOf(a);
        const idxB = customOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    if (tickers.length === 0) {
        list.innerHTML = '<li style="font-size:0.8rem; color:var(--text-secondary); text-align:center; padding:1rem;">Your watchlist is empty</li>';
        return;
    }

    list.innerHTML = tickers.map(t => {
        const companyName = lastMarketData[t]?.company_name || t;
        return `
            <li class="manage-item" draggable="false" data-ticker="${t}" style="cursor: default; display: flex; align-items: center; width: 100%;">
                <div class="manage-item-drag-handle" style="color: var(--text-secondary); opacity: 0.4; margin-right: 0.75rem; cursor: grab; font-family: monospace; font-size: 1.1rem; user-select: none;">⋮⋮</div>
                <span class="manage-item-ticker" style="cursor: pointer; flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 0.5rem;" onclick="event.stopPropagation(); window.open('https://finance.yahoo.com/quote/${encodeURIComponent(t)}', '_blank')" title="View ${t} on Yahoo Finance">
                    <span class="manage-item-company-name" style="font-weight: 600; font-size: 0.85rem; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${companyName}</span>
                    <span class="manage-item-symbol-sub" style="font-size: 0.7rem; color: var(--text-secondary); font-weight: normal; margin-top: 0.1rem;">${t} <span style="font-size: 0.85em; color: var(--accent); opacity: 0.7;">↗</span></span>
                </span>
                <button class="manage-item-delete" onclick="event.stopPropagation(); handleManageDelete('${t}', this)" title="Remove ${t}" style="flex-shrink: 0;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                </button>
            </li>
        `;
    }).join('');

    initDragAndDrop();
}

function initDragAndDrop() {
    const list = document.getElementById('manage-list');
    if (!list) return;
    const items = list.querySelectorAll('.manage-item');
    let dragSrcEl = null;

    items.forEach(item => {
        const handle = item.querySelector('.manage-item-drag-handle');
        if (handle) {
            handle.addEventListener('mousedown', () => {
                item.setAttribute('draggable', 'true');
            });
            handle.addEventListener('mouseup', () => {
                item.setAttribute('draggable', 'false');
            });
            handle.addEventListener('touchstart', () => {
                item.setAttribute('draggable', 'true');
            });
            handle.addEventListener('touchend', () => {
                item.setAttribute('draggable', 'false');
            });
        }

        item.addEventListener('dragstart', function(e) {
            dragSrcEl = this;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', this.innerHTML);
            this.classList.add('dragging');
        });

        item.addEventListener('dragover', function(e) {
            if (e.preventDefault) {
                e.preventDefault();
            }
            e.dataTransfer.dropEffect = 'move';
            return false;
        });

        item.addEventListener('dragenter', function(e) {
            this.classList.add('drag-over');
        });

        item.addEventListener('dragleave', function(e) {
            this.classList.remove('drag-over');
        });

        item.addEventListener('drop', function(e) {
            if (e.stopPropagation) {
                e.stopPropagation();
            }

            if (dragSrcEl !== this) {
                const rect = this.getBoundingClientRect();
                const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                list.insertBefore(dragSrcEl, next ? this.nextSibling : this);
                saveCustomTickerOrder();
            }
            return false;
        });

        item.addEventListener('dragend', function() {
            items.forEach(it => {
                it.classList.remove('drag-over');
                it.classList.remove('dragging');
                it.setAttribute('draggable', 'false');
            });
        });
    });
}

function saveCustomTickerOrder() {
    const ordered = Array.from(document.querySelectorAll('#manage-list .manage-item'))
        .map(el => el.dataset.ticker)
        .filter(Boolean);
    
    localStorage.setItem('insights_custom_ticker_order', JSON.stringify(ordered));

    // Update active sorting controls to Custom
    const customSortBtn = document.getElementById('sort-custom-btn');
    if (customSortBtn) {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        customSortBtn.classList.add('active');
        _activeSortKey = 'custom';
    }

    applyManageFilters();
}

function showDeleteConfirmModal(companyName, ticker) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-delete-modal');
        const message = document.getElementById('confirm-delete-message');
        const cancelBtn = document.getElementById('confirm-delete-cancel');
        const okBtn = document.getElementById('confirm-delete-ok');

        if (!modal || !message || !cancelBtn || !okBtn) {
            resolve(confirm(`Are you sure you want to stop tracking ${companyName} (${ticker})?`));
            return;
        }

        message.innerHTML = `Are you sure you want to stop tracking <strong>${companyName} (${ticker})</strong>?<br><br>This will remove all real-time insights, financial indicators, and recent news charts from your dashboard.`;
        modal.classList.add('open');

        const cleanup = (confirmed) => {
            modal.classList.remove('open');
            cancelBtn.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
            resolve(confirmed);
        };

        function onCancel() { cleanup(false); }
        function onOk() { cleanup(true); }

        cancelBtn.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
    });
}

window.handleManageDelete = async (ticker, btn) => {
    const companyName = lastMarketData[ticker]?.company_name || ticker;
    const confirmed = await showDeleteConfirmModal(companyName, ticker);
    if (!confirmed) return;

    btn.disabled = true;
    const success = await deleteTickerLogic(ticker);
    if (success) {
        // Also remove from custom order list
        try {
            let customOrder = JSON.parse(localStorage.getItem('insights_custom_ticker_order') || '[]');
            customOrder = customOrder.filter(t => t !== ticker);
            localStorage.setItem('insights_custom_ticker_order', JSON.stringify(customOrder));
        } catch (e) {}

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
    initPortfolioPeriodSelector();
    await fetchHealth();
    fetchCosts();
    fetchDashboardCosts();
    await fetchMarketAndInsights();
    await fetchDailyPicks();

    // Warm up the 1-Year Master History Cache
    syncMasterHistory();

    // Background batch: ensure all tickers have synthesis
    triggerBatchSynthesis();

    // Async background refresh — no UI wipe on each tick
    setInterval(() => {
        fetchCosts();
        fetchDashboardCosts();
        fetchMarketAndInsights();
        fetchDailyPicks();

        // Periodic sync to keep 1Y cache fresh (every 4 hours)
        if (Date.now() % (4 * 60 * 60 * 1000) < 15000) {
            syncMasterHistory();
        }
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
                    try { rationale = JSON.parse(rationale); } catch (e) { console.error("JSON parse failed", e); }
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


                // 4. Handle News (Catalysts)
                let catalystsHtml = '';
                if (pick.news) {
                    try {
                        const news = typeof pick.news === 'string' ? JSON.parse(pick.news) : pick.news;
                        if (news && news.length > 0) {
                            catalystsHtml = `
                                <div class="discovery-catalysts">
                                    <div class="catalyst-label">Recent News</div>
                                    <div class="catalyst-list">
                                        ${news.map(n => {
                                            const pubSource = n.publisher || n.source || 'NEWS';
                                            let pubDateRaw = n.provider_publish_time || n.published;
                                            if (pubDateRaw && typeof pubDateRaw === 'number' && pubDateRaw < 10000000000) {
                                                pubDateRaw *= 1000;
                                            }
                                            let pubDate = '';
                                            if (pubDateRaw) {
                                                const d = new Date(pubDateRaw);
                                                if (!isNaN(d.getTime())) {
                                                    const day = String(d.getDate()).padStart(2, '0');
                                                    const monthStr = d.toLocaleDateString('en-US', { month: 'short' });
                                                    const year = d.getFullYear();
                                                    pubDate = `${day} ${monthStr} ${year}`;
                                                }
                                            }
                                            return `
                                                <div class="catalyst-item">
                                                    <span class="catalyst-publisher">${pubSource}${pubDate ? ` · ${pubDate}` : ''}</span>
                                                    <a href="${n.link || n.url}" target="_blank" class="catalyst-link" onclick="event.stopPropagation()">${n.title}</a>
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                            `;
                        }
                    } catch (e) { console.warn("Failed to parse news for Discovery pick", e); }
                }

                const isNeg = (pick.change_pct || 0) < 0;
                const sign = (pick.change_pct || 0) >= 0 ? '+' : '';
                const changeColor = (pick.change_pct || 0) >= 0 ? 'var(--positive)' : 'var(--negative)';

                return `
                <div class="metric-card glass glow-hover discovery-pick-card ${isNeg ? 'trend-negative' : ''}" style="cursor: pointer; display: flex; flex-direction: column; gap: 0; padding: 1.5rem; min-height: 560px;" onclick="openDailyPickModal('${pick.actual_ticker}')">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                        <span class="dim-label" style="font-size:0.75rem; text-transform:uppercase; letter-spacing: 0.1em; color: ${categoryColor}; font-weight: 800;">${pick.category}</span>
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <span style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: 600;">Daily Pick</span>
                            <button class="glass-btn primary" style="padding: 0.25rem 0.75rem; font-size: 0.65rem; border-radius: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;"
                                    onclick="event.stopPropagation(); handleAddFeatured('${pick.actual_ticker}', this)">
                                + Track Ticker
                            </button>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                        <div style="display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0;">
                            <span style="font-size: 0.65rem; color: var(--accent); text-transform: uppercase; font-weight: 800; margin-bottom: 6px; letter-spacing: 0.05em; opacity: 0.8;">${formatExchange(pick.exchange)}</span>
                            <h3 class="metric-value text-gradient-purple" style="font-size: 2.2rem; line-height: 1; letter-spacing: -1.5px; margin: 0; font-weight: 900;">${pick.actual_ticker}</h3>
                            <span style="font-size: 0.9rem; color: var(--text-primary); margin-top: 8px; font-weight: 600; white-space: normal; word-break: break-word; max-width: 100%;">${pick.company_name}</span>
                            <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px; font-weight: 500; opacity: 0.7;">${pick.industry}</span>
                        </div>
                        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; margin-left: 1rem;">
                            <div style="display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 8px;">
                                <span style="font-size: 0.6rem; color: var(--accent); font-weight: 800; opacity: 0.8; letter-spacing: 0.1em;">LAST CLOSE</span>
                                <span style="font-size: 1.8rem; font-weight: 800; color: var(--text-primary); line-height: 1; letter-spacing: -0.5px;">${formatPrice(price, pick.currency || 'USD')}</span>
                                ${pick.change_pct !== undefined ? `<span style="font-size: 0.9rem; font-weight: 700; color: ${changeColor}; margin-top: 2px;">${sign}${pick.change_pct.toFixed(2)}%</span>` : ''}
                            </div>
                            ${renderExtendedHours(pick)}
                        </div>
                    </div>

                    <div style="flex: 1;">
                        ${rationaleHtml}
                    </div>

                    ${catalystsHtml}

                    <div style="margin-top: 1.5rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                        ${renderSentimentBadges(pick.sentiment_label, pick.sentiment_score, pick.social_volume, pick.actual_ticker)}
                        <div style="font-size:0.6rem; color:var(--text-secondary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.6; flex-shrink: 0;">
                            VIEW REPORT &rarr;
                        </div>
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
        const padding = range === 0 ? (minVal * 0.01 || 1) : range * 0.02;

        // Build gradient fill for premium background look (matches Gold commodity card)
        const gradCanvas = container.querySelector('canvas');
        const gradCtx = gradCanvas.getContext('2d');
        const rgb = color === '#10b981' ? '16, 185, 129' : '244, 63, 94';
        const gradient = gradCtx.createLinearGradient(0, 0, 0, 90);
        gradient.addColorStop(0, `rgba(${rgb}, 0.3)`);
        gradient.addColorStop(1, `rgba(${rgb}, 0)`);

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
        const padding = range === 0 ? (minVal * 0.01 || 1) : range * 0.02;

        // Recalculate gradient to match new color
        const gradCanvas = sparklineInstances[elementId].canvas;
        const gradCtx = gradCanvas.getContext('2d');
        const rgb = color === '#10b981' ? '16, 185, 129' : '244, 63, 94';
        const gradient = gradCtx.createLinearGradient(0, 0, 0, 90);
        gradient.addColorStop(0, `rgba(${rgb}, 0.3)`);
        gradient.addColorStop(1, `rgba(${rgb}, 0)`);

        sparklineInstances[elementId].data.labels = dataset.map((_, i) => i);
        sparklineInstances[elementId].data.datasets[0].data = dataset;
        sparklineInstances[elementId].data.datasets[0].borderColor = color;
        sparklineInstances[elementId].data.datasets[0].backgroundColor = gradient;
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

        // Only auto-update portfolio chart if we are in 1D view (real-time).
        // Historical views (1W, 1M, etc) are updated via manual selector clicks.
        if (currentPortfolioPeriod === '1d') {
            await updatePortfolioChart(marketArr, true);
        }
        patchInsightsGrid(newMarket, newInsights);

        lastMarketData = newMarket;
        lastInsightsData = newInsights;

        // Update Master History with latest live price (Timezone-Aware)
        // Guard: Only allow live updates if the 1-Year baseline is fully loaded
        if (MASTER_TIMESTAMPS.length > 0) {
            const lastMasterDate = MASTER_TIMESTAMPS[MASTER_TIMESTAMPS.length - 1].split('T')[0];
            let newDayAdded = false;

            marketArr.forEach(m => {
                if (MASTER_HISTORY[m.ticker] && m.last_trading_day && m.close_price) {
                    const s = MASTER_HISTORY[m.ticker];
                    const liveDate = m.last_trading_day;
                    const price = parseFloat(m.close_price);
                    if (isNaN(price) || price <= 0) return;

                    if (liveDate > lastMasterDate) {
                        // Australia Monday case
                        if (!newDayAdded) {
                            MASTER_TIMESTAMPS.push(`${liveDate}T00:00:00`);
                            newDayAdded = true;
                            Object.keys(MASTER_HISTORY).forEach(t => {
                                MASTER_HISTORY[t].push(MASTER_HISTORY[t][MASTER_HISTORY[t].length - 1] || 0);
                            });
                        }
                        s[s.length - 1] = price;
                    } else if (liveDate === lastMasterDate) {
                        // Update current slot
                        if (s.length > 0) s[s.length - 1] = price;
                    }
                }
            });
        }

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
        const hasCanvas = !!sparklineInstances[sparklineId];
        if (!hasCanvas && mkt.sparkline && mkt.sparkline.length > 0) {
            const color = mkt.change_pct >= 0 ? '#10b981' : '#f43f5e';
            drawSparkline(sparklineId, mkt.sparkline, color);
        }
    });

    // Re-apply sorting/filters and initialize drag-and-drop
    applyManageFilters();
    initGridDragAndDrop();
}

function initGridDragAndDrop() {
    const container = document.getElementById('insights-container');
    if (!container) return;
    const cards = container.querySelectorAll('.insight-card');
    let dragSrcEl = null;

    cards.forEach(card => {
        card.setAttribute('draggable', 'true');
        card.style.cursor = 'grab';

        card.addEventListener('dragstart', function(e) {
            dragSrcEl = this;
            window.isDraggingCard = true;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', this.innerHTML);
            this.classList.add('grid-dragging');
        });

        card.addEventListener('dragover', function(e) {
            if (e.preventDefault) {
                e.preventDefault();
            }
            e.dataTransfer.dropEffect = 'move';
            return false;
        });

        card.addEventListener('dragenter', function(e) {
            this.classList.add('grid-drag-over');
        });

        card.addEventListener('dragleave', function(e) {
            this.classList.remove('grid-drag-over');
        });

        card.addEventListener('drop', function(e) {
            if (e.stopPropagation) {
                e.stopPropagation();
            }

            if (dragSrcEl !== this) {
                const rect = this.getBoundingClientRect();
                const next = (e.clientX - rect.left) / (rect.right - rect.left) > 0.5;
                container.insertBefore(dragSrcEl, next ? this.nextSibling : this);
                saveGridTickerOrder();
            }
            return false;
        });

        card.addEventListener('dragend', function() {
            cards.forEach(c => {
                c.classList.remove('grid-drag-over');
                c.classList.remove('grid-dragging');
            });
            setTimeout(() => {
                window.isDraggingCard = false;
            }, 100);
        });
    });
}

function saveGridTickerOrder() {
    const ordered = Array.from(document.querySelectorAll('#insights-container .insight-card'))
        .map(el => el.dataset.ticker)
        .filter(Boolean);
    
    localStorage.setItem('insights_custom_ticker_order', JSON.stringify(ordered));

    // Update active sort button UI to Custom
    const customSortBtn = document.getElementById('sort-custom-btn');
    if (customSortBtn) {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        customSortBtn.classList.add('active');
        _activeSortKey = 'custom';
    }

    // Instantly sync the Edit Watchlist manager order
    renderManageList();
}

function signalClass(signal) {
    if (!signal) return 'hold';
    return signal.toLowerCase();
}

function statusChip(isOpen) {
    if (isOpen === "Lunch") {
        return `
            <div style="display: flex; align-items: center; gap: 0.35rem; background: rgba(245, 158, 11, 0.1); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.2);">
                <div style="width: 6px; height: 6px; background: #f59e0b; border-radius: 50%;"></div>
                <span style="font-size: 0.6rem; font-weight: 800; color: #f59e0b; letter-spacing: 0.05em;">LUNCH</span>
            </div>
        `;
    }
    if (isOpen === true || isOpen === "True" || isOpen === "true") {
        return `
            <div style="display: flex; align-items: center; gap: 0.35rem; background: rgba(16, 185, 129, 0.1); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.2);">
                <div class="dot pulse-animation" style="width: 6px; height: 6px; background: #10b981; box-shadow: 0 0 6px #10b981;"></div>
                <span style="font-size: 0.6rem; font-weight: 800; color: #10b981; letter-spacing: 0.05em;">OPEN</span>
            </div>
        `;
    }
    return `
        <div style="display: flex; align-items: center; gap: 0.35rem; background: rgba(255, 255, 255, 0.05); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.1);">
            <div style="width: 6px; height: 6px; background: var(--text-secondary); border-radius: 50%; opacity: 0.5;"></div>
            <span style="font-size: 0.6rem; font-weight: 800; color: var(--text-secondary); letter-spacing: 0.05em; opacity: 0.8;">CLOSED</span>
        </div>
    `;
}

function buildNewsHtml(mkt) {
    const links = mkt.headline_links || [];
    const headlines = mkt.headlines || [];

    let itemsHtml = '';

    if (links.length > 0) {
        itemsHtml = links.slice(0, 5).map(h => {
            if (!h.title) return '';
            let pubDate = '';
            if (h.published) {
                const d = new Date(h.published);
                const day = String(d.getDate()).padStart(2, '0');
                const monthStr = d.toLocaleDateString('en-US', { month: 'short' });
                const year = d.getFullYear();
                pubDate = `${day} ${monthStr} ${year}`;
            }
            const pubSource = h.source || 'NEWS';
            if (h.url) {
                return `
                    <div class="catalyst-item">
                        <span class="catalyst-publisher">${pubSource}${pubDate ? ` · ${pubDate}` : ''}</span>
                        <a href="${h.url}" target="_blank" class="catalyst-link" onclick="event.stopPropagation()">${h.title}</a>
                    </div>
                `;
            } else {
                return `
                    <div class="catalyst-item">
                        <span class="catalyst-publisher">${pubSource}${pubDate ? ` · ${pubDate}` : ''}</span>
                        <span class="catalyst-link" style="color:var(--text-secondary); text-decoration:none; cursor:default;">${h.title}</span>
                    </div>
                `;
            }
        }).join('');
    } else if (headlines.length > 0) {
        itemsHtml = headlines.slice(0, 3).map(h => `
            <div class="catalyst-item">
                <span class="catalyst-publisher">NEWS</span>
                <span class="catalyst-link" style="color:var(--text-secondary); text-decoration:none; cursor:default;">${h}</span>
            </div>
        `).join('');
    }

    if (!itemsHtml) {
        return `<div class="discovery-catalysts" style="margin-top: 1rem;"><div class="catalyst-label">Recent News</div><div class="catalyst-list"><div class="catalyst-item"><span style="color:var(--text-secondary);font-size:0.85rem;">No recent headlines found.</span></div></div></div>`;
    }

    return `
        <div class="discovery-catalysts" style="margin-top: 1rem;">
            <div class="catalyst-label">Recent News</div>
            <div class="catalyst-list">
                ${itemsHtml}
            </div>
        </div>
    `;
}

function buildCard(mkt, insight, index) {
    const wrapper = document.createElement('div');
    wrapper.dataset.ticker = mkt.ticker;
    wrapper.dataset.company = mkt.company_name || '';
    wrapper.dataset.exchange = mkt.exchange || '';
    wrapper.dataset.price = mkt.close_price || 0;
    let displayPct = mkt.change_pct || 0;
    if (periodStartPrices[mkt.ticker]) {
        const first = periodStartPrices[mkt.ticker];
        const last = mkt.close_price;
        displayPct = ((last - first) / first) * 100;
    }

    wrapper.dataset.change = displayPct;
    const isNeg = displayPct < 0;
    wrapper.className = 'insight-card' + (isNeg ? ' trend-negative' : '');
    wrapper.style.animationDelay = `${index * 0.05}s`;

    const inner = document.createElement('div');
    inner.className = 'glass';
    inner.style.height = '100%';
    inner.innerHTML = cardInnerHtml(mkt, insight);

    // Card body click → open modal
    inner.addEventListener('click', () => {
        if (window.isDraggingCard) return;
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
    if (priceEl) priceEl.textContent = formatPrice(mkt.close_price, mkt.currency, false, mkt.ticker);

    // Update status chip
    const priceBox = inner.querySelector('.card-price-box div:first-child');
    if (priceBox) {
        const chip = priceBox.querySelector('div:first-child');
        if (chip) chip.outerHTML = statusChip(mkt.is_open);
    }

    const changeEl = inner.querySelector('.card-change');
    let displayPct = mkt.change_pct || 0;

    if (changeEl) {
        // If we are NOT in 1D view and we have a cached start price, recalculate
        if (periodStartPrices[mkt.ticker]) {
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
            insightEl.innerHTML = newText + (insight ? '<div style="font-size:0.82rem; color:var(--accent); margin-top:0.6rem; opacity:0.9; text-align:right; font-weight:500;">Click to expand full analysis →</div>' : '');
        }
    }

    // Refresh card-level sentiment badges
    const sentimentContainer = inner.querySelector('.card-sentiment-container');
    if (sentimentContainer && insight) {
        sentimentContainer.innerHTML = renderSentimentBadges(insight.sentiment_label, insight.sentiment_score, insight.social_volume, mkt.ticker);
    }

    // Update data attributes for filtering/sorting
    wrapper.dataset.price = mkt.close_price || 0;
    wrapper.dataset.change = mkt.change_pct || 0;
    wrapper.dataset.company = mkt.company_name || '';
    wrapper.dataset.exchange = mkt.exchange || '';

    // Update trend class based on displayed percentage
    if (displayPct < 0) wrapper.classList.add('trend-negative');
    else wrapper.classList.remove('trend-negative');
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
                        <span class="ticker-symbol">${mkt.ticker.split('.')[0]}</span>
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
    if (periodStartPrices[mkt.ticker]) {
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
                    <span class="ticker-symbol">${mkt.ticker.split('.')[0]}</span>
                    ${signal ? `<span class="signal-pill ${sClass}">${signal}</span>` : ''}
                </div>
                ${mkt.company_name ? `<span class="card-company-name">${mkt.company_name}</span>` : ''}
            </div>

            <div class="card-price-box">
                <div style="display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 2px;">
                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 2px;">
                        ${statusChip(mkt.is_open)}
                    </div>
                    <span class="card-price">${formatPrice(mkt.close_price, mkt.currency, false, mkt.ticker)}</span>
                </div>
                ${renderExtendedHours(mkt)}
                <span class="${cClass} card-change ${changeClass}">${sign}${displayPct.toFixed(2)}%</span>
            </div>
        </div>
        <div id="sparkline-card-${mkt.ticker}" class="card-sparkline-bg"></div>
        <div class="card-sentiment-container">
            ${insight ? renderSentimentBadges(insight.sentiment_label, insight.sentiment_score, insight.social_volume, mkt.ticker) : ''}
        </div>
        <div class="insight-text" style="margin-top: 0; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.25rem;">
            ${insight ? formatInsight(insight.insight_text, null, ['WhatsHappening']) : 'Awaiting AI synthesis — click to view history.'}
            ${insight ? '<div style="font-size:0.82rem; color:var(--accent); margin-top:0.6rem; opacity:0.9; text-align:right; font-weight:500;">Click to expand full analysis →</div>' : ''}
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
let lastManualChartUpdate = 0;
async function updatePortfolioChart(marketData, isBackground = false) {
    if (isBackground && Date.now() - lastManualChartUpdate < 30000) {
        debugLog("Skipping background portfolio chart update (recently updated manually)");
        return;
    }
    if (!isBackground) lastManualChartUpdate = Date.now();
    if (!marketData || marketData.length === 0) return;
    const active = [...marketData].filter(m => m.status === 'active');

    const loader = document.getElementById('portfolio-loader');
    const statEl = document.getElementById('portfolio-change-stat');

    if (active.length === 0) {
        if (statEl) statEl.innerHTML = '';
        return;
    }

    if (loader) loader.style.display = 'flex';

    let combined = [];
    let labels = [];

    const targetCurr = currentCurrency === 'DEFAULT' ? 'USD' : currentCurrency;
    const { rate, symbol } = EXCHANGE_RATES[targetCurr] || EXCHANGE_RATES['USD'];

    if (currentPortfolioPeriod === '1d') {
        const sparklines = active.map(d => {
            const pts = d.sparkline || [];
            let tc = d.currency || 'USD';
            if (tc === 'GBp') tc = 'GBP';
            const tickerUsdRate = EXCHANGE_RATES[tc] ? EXCHANGE_RATES[tc].rate : 1.0;
            return pts.map(v => (parseFloat(v) / tickerUsdRate) * rate);
        }).filter(s => s.length > 0);

        if (sparklines.length === 0) {
            if (loader) loader.style.display = 'none';
            return;
        }

        const len = Math.max(...sparklines.map(s => s.length));
        combined = Array.from({ length: len }, (_, i) =>
            sparklines.reduce((sum, s) => sum + (s[i] || s[s.length - 1] || 0), 0)
        );

        const nowMs = Date.now();
        labels = combined.map((_, i) => {
            // Estimate timestamps if not provided by backend batch
            const msPerBar = (24 * 60 * 60 * 1000) / len;
            const msAgo = (len - 1 - i) * msPerBar;
            const d = new Date(nowMs - msAgo);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        });
    } else {
        // Master Cache Slicing Logic
        let batch = null;
        const tickers = active.map(m => m.ticker).join(',');

        const sliceLen = getSliceLen(currentPortfolioPeriod);

        // Use master cache if ALL active tickers are present
        const hasMaster = isMasterHistoryLoaded && active.every(m => MASTER_HISTORY[m.ticker] && MASTER_HISTORY[m.ticker].length > 0);

        if (hasMaster && MASTER_TIMESTAMPS.length >= sliceLen) {
            debugLog(`Using MASTER_HISTORY for ${currentPortfolioPeriod} slice`);
            batch = { data: {}, timestamps: [] };
            active.forEach(m => {
                batch.data[m.ticker] = MASTER_HISTORY[m.ticker].slice(-sliceLen);
            });
            batch.timestamps = MASTER_TIMESTAMPS.slice(-sliceLen);
        } else {
            try {
                const resp = await fetch(`/api/v1/market/batch-history?symbols=${tickers}&period=${currentPortfolioPeriod}`);
                if (!resp.ok) throw new Error("Batch fetch failed");
                batch = await resp.json();
            } catch (e) {
                console.error("Portfolio history fetch failed", e);
                if (loader) loader.style.display = 'none';
                return;
            }
        }

        if (!batch || !batch.timestamps || batch.timestamps.length === 0) return;

        debugLog(`Rendering Portfolio Chart: ${batch.timestamps.length} points for period ${currentPortfolioPeriod}`);
        labels = batch.timestamps.map(t => {
            const d = new Date(t);
            const options = (currentPortfolioPeriod === '5y' || currentPortfolioPeriod === '1y') 
                ? { year: '2-digit', month: 'short' } 
                : { month: 'short', day: 'numeric' };
            return d.toLocaleDateString([], options);
        });

        // Track last valid price for each ticker to fill gaps (Forward-Fill)
        const lastPrices = {};
        active.forEach(m => lastPrices[m.ticker] = 0);

        combined = Array.from({ length: batch.timestamps.length }, (_, i) => {
            let total = 0;
            active.forEach(m => {
                const series = (batch.data && batch.data[m.ticker]) ? batch.data[m.ticker] : [];
                let val = series[i];
                // Use !val to catch 0, null, undefined, and NaN
                if (!val || isNaN(val)) {
                    val = lastPrices[m.ticker];
                } else {
                    lastPrices[m.ticker] = val;
                }
                let tc = m.currency || 'USD';
                if (tc === 'GBp') tc = 'GBP';
                const tickerUsdRate = EXCHANGE_RATES[tc] ? EXCHANGE_RATES[tc].rate : 1.0;
                total += (val / tickerUsdRate) * rate;
            });
            return total;
        });
    }

    if (combined.length === 0) {
        if (loader) loader.style.display = 'none';
        return;
    }

    // Calculate Change Metrics
    const startVal = combined[0];
    const endVal = combined[combined.length - 1];
    const diff = endVal - startVal;
    const changePct = startVal !== 0 ? (diff / startVal) * 100 : 0;
    const isPos = changePct >= 0;

    if (statEl) {
        const color = isPos ? 'var(--positive)' : 'var(--negative)';
        const sign = isPos ? '+' : '';
        statEl.style.color = color;
        statEl.innerHTML = `
            <span style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 400; margin-right: 0.25rem;">${currentPortfolioPeriod.toUpperCase()} Perf:</span>
            ${sign}${changePct.toFixed(2)}%
            <span style="font-size: 0.9rem; margin-left: 0.2rem;">(${isPos ? '↑' : '↓'})</span>
        `;
    }

    const ctx = document.getElementById('portfolioChart').getContext('2d');
    const lineColor = isPos ? 'rgba(16,185,129,1)' : 'rgba(244,63,94,1)';
    const fillColor = isPos ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)';

    if (portfolioChartInstance) {
        portfolioChartInstance.data.labels = labels;
        portfolioChartInstance.data.datasets[0].data = combined;
        portfolioChartInstance.data.datasets[0].borderColor = lineColor;
        portfolioChartInstance.data.datasets[0].backgroundColor = fillColor;
        portfolioChartInstance.options.scales.y.ticks.callback = v => `${symbol}${v.toLocaleString()}`;
        portfolioChartInstance.options.plugins.tooltip.callbacks.label = c => ` Combined: ${symbol}${c.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        portfolioChartInstance.update();
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
                    tooltip: {
                        callbacks: {
                            label: c => ` Combined: ${symbol}${c.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 10 }, maxRotation: 0 }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: 'rgba(255,255,255,0.3)',
                            font: { size: 10 },
                            callback: v => `${symbol}${v.toLocaleString()}`
                        }
                    }
                }
            }
        });
    }
    if (loader) loader.style.display = 'none';
}


/* =====================================================
   Modal
   ===================================================== */
function initModal() {
    const backdrop = document.getElementById('ticker-modal');
    const closeBtn = document.getElementById('modal-close-btn');

    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeModal();
            closeDefinitionModal();
        }
    });

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

    document.querySelector('.modal-internal-tabs').addEventListener('click', e => {
        const btn = e.target.closest('.modal-tab-btn');
        if (!btn) return;
        
        // Update active tab button
        document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Hide all panes
        document.querySelectorAll('.modal-tab-pane').forEach(p => {
            p.classList.remove('active');
            p.style.display = 'none';
        });
        
        const targetTab = btn.dataset.modaltab;
        const targetPane = document.getElementById(`modal-tab-${targetTab}`);
        targetPane.classList.add('active');
        targetPane.style.display = 'block';
        
        // Trigger data fetch if needed
        if ((targetTab === 'financials' || targetTab === 'forecasts') && !currentModalFundamentals) {
            fetchAndRenderFundamentals(currentModalTicker);
        }
    });
}

function openModal(ticker) {
    currentModalTicker = ticker;
    currentPeriod = '1mo';
    currentModalFundamentals = null;
    currentModalEPS = null;
    currentModalHistoryData = null;
    
    // Reset tabs
    document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.modaltab === 'overview'));
    document.querySelectorAll('.modal-tab-pane').forEach(p => {
        const isActive = p.id === 'modal-tab-overview';
        p.classList.toggle('active', isActive);
        p.style.display = isActive ? 'block' : 'none';
    });

    // Reset fundamental UI
    document.getElementById('modal-financials-loader').style.display = 'block';
    document.getElementById('modal-financials-loader').textContent = 'Fetching financial statements...';
    document.getElementById('modal-financials-chart-wrapper').style.display = 'none';
    document.getElementById('modal-ownership-section').style.display = 'none';
    document.getElementById('modal-dividends-section').style.display = 'none';
    document.getElementById('modal-target-section').style.display = 'none';
    document.getElementById('modal-eps-section').style.display = 'none';
    document.getElementById('modal-analyst-gauge').innerHTML = '';

    document.querySelectorAll('.period-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === '1mo');
    });

    const mkt = lastMarketData[ticker] || {};
    const insight = lastInsightsData[ticker] || null;
    currentModalMkt = mkt;
    currentModalInsight = insight;

    const isPos = (mkt.change_pct || 0) >= 0;
    const modalPanel = document.querySelector('.modal-panel');
    if (modalPanel) {
        if (!isPos) modalPanel.classList.add('trend-negative');
        else modalPanel.classList.remove('trend-negative');
    }

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

    const pick = dailyPicksData[ticker];

    // Parse rationale to object if stored as JSON string
    let pickRationale = pick ? pick.rationale : null;
    if (typeof pickRationale === 'string') {
        try { pickRationale = JSON.parse(pickRationale); } catch (e) { /* keep as string */ }
    }

    currentModalMkt = {
        ticker: ticker,
        status: 'pending_data',
        news: pick ? pick.news : null
    };

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

async function openDiscoverAssetModal(ticker) {
    currentModalTicker = ticker;
    currentPeriod = '1mo';
    document.querySelectorAll('.period-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === '1mo');
    });

    currentModalMkt = {
        ticker: ticker,
        status: 'pending_data',
        news: null
    };

    currentModalInsight = null;

    // Reset standard layout elements and render skeleton
    renderModalContent(currentModalMkt, null);

    // Hide AI analysis, Watchlist button, Analyst recommendations, and Signal badges
    document.getElementById('modal-ai-section').style.display = 'none';
    document.getElementById('modal-analyst-section').style.display = 'none';
    document.getElementById('modal-watchlist-btn').style.display = 'none';
    const sigBadge = document.getElementById('modal-signal-badge');
    if (sigBadge) sigBadge.style.display = 'none';

    // Clear and hide the timeline until fetched
    document.getElementById('modal-timeline-section').style.display = 'none';

    // Load full history chart + details (news, fallback business summaries, and timeline calculations)
    await loadModalChart(ticker, '1mo');
}
window.openDiscoverAssetModal = openDiscoverAssetModal;

function renderMarketTimeline(timeline) {
    const section = document.getElementById('modal-timeline-section');
    const wrapper = document.getElementById('modal-timeline-wrapper');
    const statusBadge = document.getElementById('modal-timeline-status-badge');
    
    if (!timeline || !timeline.segments || timeline.segments.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    
    // Set timezone and open/closed status badge
    const status = timeline.status || 'Closed';
    statusBadge.className = `badge ${status.toLowerCase()}`;
    statusBadge.textContent = `${status} (${timeline.timezone_name})`;
    
    let segmentsHtml = '';
    
    // Add 24-hour grid lines and markings (00:00, 06:00, 12:00, 18:00, 24:00)
    const gridMarkings = [
        { pct: 0, label: '00:00' },
        { pct: 25, label: '06:00' },
        { pct: 50, label: '12:00' },
        { pct: 75, label: '18:00' },
        { pct: 100, label: '24:00' }
    ];
    
    gridMarkings.forEach(m => {
        segmentsHtml += `<div class="timeline-grid-line" style="left: ${m.pct}%;"></div>`;
        segmentsHtml += `<div class="timeline-marker" style="left: ${m.pct}%;">${m.label}</div>`;
    });
    
    // Draw session/active segments and lunch breaks
    timeline.segments.forEach(seg => {
        const start = seg.start_pct;
        const end = seg.end_pct;
        const width = end - start;
        const typeClass = seg.type === 'active' ? 'active' : 'lunch';
        const title = seg.type === 'active' ? 'Trading Session' : 'Lunch Break';
        
        segmentsHtml += `<div class="timeline-segment ${typeClass}" style="left: ${start}%; width: ${width}%;" title="${title}"></div>`;
    });
    
    // Draw vertical timeline indicator current local time indicator with tooltip
    const currPct = timeline.current_pct;
    segmentsHtml += `
        <div class="timeline-current-indicator" style="left: ${currPct}%;">
            <div class="timeline-current-tooltip">${timeline.current_local_time}</div>
        </div>
    `;
    
    wrapper.innerHTML = segmentsHtml;
}

function getMarketStatusDetails(ticker) {
    const t = (ticker || '').toUpperCase();
    const isFutures = t.endsWith('=F');
    
    let tzName = "America/New_York";
    let openHour = 9, openMin = 30;
    let closeHour = 16, closeMin = 0;
    let lunchStart = null, lunchEnd = null;
    
    if (isFutures) {
        tzName = "America/New_York";
        openHour = 18; openMin = 0;
        closeHour = 17; closeMin = 0;
    } else if (t.endsWith('.AX') || t === '^AXJO') {
        tzName = "Australia/Sydney";
        openHour = 10; openMin = 0;
        closeHour = 16; closeMin = 0;
    } else if (t.endsWith('.L') || t === '^FTSE') {
        tzName = "Europe/London";
        openHour = 8; openMin = 0;
        closeHour = 16; closeMin = 30;
    } else if (t.endsWith('.T') || t === '^N225') {
        tzName = "Asia/Tokyo";
        openHour = 9; openMin = 0;
        closeHour = 15; closeMin = 30;
        lunchStart = { hour: 11, minute: 30 };
        lunchEnd = { hour: 12, minute: 30 };
    } else if (t.endsWith('.HK') || t === '^HSI') {
        tzName = "Asia/Hong_Kong";
        openHour = 9; openMin = 30;
        closeHour = 16; closeMin = 0;
        lunchStart = { hour: 12, minute: 0 };
        lunchEnd = { hour: 13, minute: 0 };
    } else if (t.endsWith('.PA') || t.endsWith('.AS') || t.endsWith('.BR') || t === '^STOXX50E') {
        tzName = "Europe/Paris";
        openHour = 9; openMin = 0;
        closeHour = 17; closeMin = 30;
    } else if (t.endsWith('.DE') || t === '^GDAXI') {
        tzName = "Europe/Berlin";
        openHour = 9; openMin = 0;
        closeHour = 17; closeMin = 30;
    } else if (t.endsWith('.TO') || t === '^GSPTSE') {
        tzName = "America/Toronto";
        openHour = 9; openMin = 30;
        closeHour = 16; closeMin = 0;
    }
    
    const now = new Date();
    let localTime;
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tzName,
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
        });
        const parts = formatter.formatToParts(now);
        const dict = {};
        parts.forEach(p => dict[p.type] = p.value);
        localTime = new Date(`${dict.year}-${String(dict.month).padStart(2, '0')}-${String(dict.day).padStart(2, '0')}T${String(dict.hour).padStart(2, '0')}:${String(dict.minute).padStart(2, '0')}:${String(dict.second).padStart(2, '0')}`);
    } catch (e) {
        localTime = new Date();
    }
    
    const weekday = localTime.getDay(); // 0 Sunday, 1 Monday, etc.
    const isWeekend = (weekday === 0 || weekday === 6);
    
    const currentMins = localTime.getHours() * 60 + localTime.getMinutes();
    const openMins = openHour * 60 + openMin;
    const closeMins = closeHour * 60 + closeMin;
    
    const timeToMins = (h, m) => h * 60 + m;
    
    function formatDiff(mins) {
        const hours = Math.floor(mins / 60);
        const minutes = mins % 60;
        if (hours > 0) {
            const hr_str = hours === 1 ? 'hour' : 'hours';
            const min_str = minutes === 1 ? 'minute' : 'minutes';
            return `${hours} ${hr_str}${minutes > 0 ? ` and ${minutes} ${min_str}` : ''}`;
        }
        const min_str = minutes === 1 ? 'minute' : 'minutes';
        return `${Math.max(1, minutes)} ${min_str}`;
    }
    
    if (isFutures) {
        const isClosed = (weekday === 5 && currentMins >= timeToMins(17, 0)) ||
                         (weekday === 6) ||
                         (weekday === 0 && currentMins < timeToMins(18, 0));
        const isMaintenance = (!isClosed && currentMins >= timeToMins(17, 0) && currentMins < timeToMins(18, 0));
        
        if (isClosed) {
            let daysToSunday = 0;
            if (weekday === 5) daysToSunday = 2;
            else if (weekday === 6) daysToSunday = 1;
            
            const totalRemaining = daysToSunday * 1440 + (timeToMins(18, 0) - currentMins);
            return { status: "Closed", message: `opening in ${formatDiff(totalRemaining)}`, segments: getSegments(isFutures, lunchStart, lunchEnd, openMins, closeMins), tzName, localTime };
        } else if (isMaintenance) {
            const totalRemaining = timeToMins(18, 0) - currentMins;
            return { status: "Closed", message: `re-opening in ${formatDiff(totalRemaining)}`, segments: getSegments(isFutures, lunchStart, lunchEnd, openMins, closeMins), tzName, localTime };
        } else {
            let remaining = timeToMins(17, 0) - currentMins;
            if (remaining < 0) remaining += 1440;
            return { status: "Open", message: `closing in ${formatDiff(remaining)}`, segments: getSegments(isFutures, lunchStart, lunchEnd, openMins, closeMins), tzName, localTime };
        }
    }
    
    if (!isWeekend && lunchStart && lunchEnd) {
        const startMins = timeToMins(lunchStart.hour, lunchStart.minute);
        const endMins = timeToMins(lunchEnd.hour, lunchEnd.minute);
        if (currentMins >= startMins && currentMins < endMins) {
            const remaining = endMins - currentMins;
            return { status: "Lunch", message: `re-opening in ${formatDiff(remaining)}`, segments: getSegments(isFutures, lunchStart, lunchEnd, openMins, closeMins), tzName, localTime };
        }
    }
    
    const isOpen = !isWeekend && (currentMins >= openMins && currentMins < closeMins);
    if (isOpen) {
        if (lunchStart && currentMins < timeToMins(lunchStart.hour, lunchStart.minute)) {
            const lStartMins = timeToMins(lunchStart.hour, lunchStart.minute);
            const remaining = lStartMins - currentMins;
            return { status: "Open", message: `closing for lunch in ${formatDiff(remaining)}`, segments: getSegments(isFutures, lunchStart, lunchEnd, openMins, closeMins), tzName, localTime };
        } else {
            const remaining = closeMins - currentMins;
            return { status: "Open", message: `closing in ${formatDiff(remaining)}`, segments: getSegments(isFutures, lunchStart, lunchEnd, openMins, closeMins), tzName, localTime };
        }
    }
    
    let daysToAdd = 0;
    if (currentMins >= closeMins) {
        daysToAdd = 1;
    }
    let checkDay = (weekday + daysToAdd) % 7;
    while (checkDay === 0 || checkDay === 6) {
        daysToAdd++;
        checkDay = (weekday + daysToAdd) % 7;
    }
    
    const totalRemaining = daysToAdd * 1440 + (openMins - currentMins);
    return { status: "Closed", message: `opening in ${formatDiff(totalRemaining)}`, segments: getSegments(isFutures, lunchStart, lunchEnd, openMins, closeMins), tzName, localTime };
}

function getSegments(isFutures, lunchStart, lunchEnd, openMins, closeMins) {
    const open_pct = parseFloat(((openMins / 1440) * 100).toFixed(2));
    const close_pct = parseFloat(((closeMins / 1440) * 100).toFixed(2));
    const segments = [];
    if (isFutures) {
        segments.push({ start_pct: 0, end_pct: parseFloat(((1020 / 1440) * 100).toFixed(2)), type: "active" });
        segments.push({ start_pct: parseFloat(((1080 / 1440) * 100).toFixed(2)), end_pct: 100, type: "active" });
    } else if (lunchStart && lunchEnd) {
        const l_start_mins = lunchStart.hour * 60 + lunchStart.minute;
        const l_end_mins = lunchEnd.hour * 60 + lunchEnd.minute;
        segments.push({ start_pct: open_pct, end_pct: parseFloat(((l_start_mins / 1440) * 100).toFixed(2)), type: "active" });
        segments.push({ start_pct: parseFloat(((l_start_mins / 1440) * 100).toFixed(2)), end_pct: parseFloat(((l_end_mins / 1440) * 100).toFixed(2)), type: "lunch" });
        segments.push({ start_pct: parseFloat(((l_end_mins / 1440) * 100).toFixed(2)), end_pct: close_pct, type: "active" });
    } else {
        segments.push({ start_pct: open_pct, end_pct: close_pct, type: "active" });
    }
    return segments;
}

function initDiscoverTiming() {
    setInterval(() => {
        // 1. Tick visible index cards countdown
        document.querySelectorAll('[data-discover-symbol]').forEach(card => {
            const sym = card.dataset.discoverSymbol;
            const details = getMarketStatusDetails(sym);
            
            const badge = card.querySelector('[data-status-badge]');
            if (badge) {
                badge.className = `market-status-badge ${details.status.toLowerCase()}`;
                badge.innerHTML = `<span class="market-status-dot"></span>${details.status}`;
            }
            
            const msgEl = card.querySelector('[data-status-msg]');
            if (msgEl) {
                msgEl.textContent = details.message || '';
            }
        });

        // 2. Tick details modal timeline
        const modal = document.getElementById('market-modal');
        if (currentModalMkt && modal && modal.style.display === 'flex') {
            const sym = currentModalMkt.ticker;
            const details = getMarketStatusDetails(sym);
            
            const statusBadge = document.getElementById('modal-timeline-status-badge');
            if (statusBadge) {
                statusBadge.className = `badge ${details.status.toLowerCase()}`;
                statusBadge.textContent = `${details.status} (${details.tzName})`;
            }
            
            const wrapper = document.getElementById('modal-timeline-wrapper');
            if (wrapper) {
                const currentMins = details.localTime.getHours() * 60 + details.localTime.getMinutes();
                const currentPct = parseFloat(((currentMins / 1440) * 100).toFixed(2));
                const formattedTime = details.localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                
                const indicator = wrapper.querySelector('.timeline-current-indicator');
                if (indicator) {
                    indicator.style.left = `${currentPct}%`;
                    const tooltip = indicator.querySelector('.timeline-current-tooltip');
                    if (tooltip) {
                        tooltip.textContent = formattedTime;
                    }
                }
            }
        }
    }, 10000);
}

function renderModalContent(mkt, insight) {
    const ticker = mkt.ticker || currentModalTicker;

    // Reset standard layout visibility defaults
    document.getElementById('modal-ai-section').style.display = 'block';
    document.getElementById('modal-analyst-section').style.display = 'block';
    const sigBadge = document.getElementById('modal-signal-badge');
    if (sigBadge) sigBadge.style.display = 'inline-block';
    document.getElementById('modal-timeline-section').style.display = 'none';

    // Show/hide tab headers depending on whether it's a global market index or commodity
    const isGlobalComm = isGlobalOrCommodity(ticker);
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
        const tab = btn.dataset.modaltab;
        if (isGlobalComm && (tab === 'financials' || tab === 'forecasts')) {
            btn.style.display = 'none';
        } else {
            btn.style.display = '';
        }
    });

    if (isGlobalComm) {
        // Force overview tab to be active if a hidden tab is active
        const activeTabBtn = document.querySelector('.modal-tab-btn.active');
        if (activeTabBtn && (activeTabBtn.dataset.modaltab === 'financials' || activeTabBtn.dataset.modaltab === 'forecasts')) {
            document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.modaltab === 'overview'));
            document.querySelectorAll('.modal-tab-pane').forEach(p => {
                const isActive = p.id === 'modal-tab-overview';
                p.classList.toggle('active', isActive);
                p.style.display = isActive ? 'block' : 'none';
            });
        }
    }

    // Show/hide Quick Stats section depending on whether it's a Discover/Exchange asset
    const isDiscover = !insight || ALL_DISCOVER_SYMBOLS.includes(ticker);
    if (isDiscover) {
        document.getElementById('modal-stats-section').style.display = 'none';
    } else {
        document.getElementById('modal-stats-section').style.display = 'block';
    }

    // Sentiment section — show when insight has sentiment data (never for global markets/commodities)
    const sentimentSection = document.getElementById('modal-sentiment-section');
    const sentimentBadges = document.getElementById('modal-sentiment-badges');
    const sentimentExplanation = document.getElementById('modal-sentiment-explanation');
    if (sentimentSection && sentimentBadges) {
        const hasSentiment = !isGlobalComm && insight && (insight.sentiment_label || insight.sentiment_score !== undefined || insight.social_volume !== undefined);
        if (hasSentiment && !isDiscover) {
            sentimentBadges.innerHTML = renderSentimentBadges(insight.sentiment_label, insight.sentiment_score, insight.social_volume, mkt.ticker);
            if (sentimentExplanation) {
                sentimentExplanation.innerHTML = generateSentimentExplanation(insight.sentiment_label, insight.sentiment_score, insight.social_volume, mkt.ticker, mkt.change_pct);
                const label = (insight.sentiment_label || '').toUpperCase();
                if (label.includes('BULL')) {
                    sentimentExplanation.style.borderLeftColor = '#22c55e'; // green
                    sentimentExplanation.style.background = 'rgba(34, 197, 94, 0.05)';
                } else if (label.includes('BEAR')) {
                    sentimentExplanation.style.borderLeftColor = '#ef4444'; // red
                    sentimentExplanation.style.background = 'rgba(239, 68, 68, 0.05)';
                } else {
                    sentimentExplanation.style.borderLeftColor = 'var(--text-secondary)'; // gray
                    sentimentExplanation.style.background = 'rgba(255, 255, 255, 0.03)';
                }
            }
            sentimentSection.style.display = 'block';
        } else {
            sentimentSection.style.display = 'none';
        }
    }

    // Header
    const commodityName = COMMODITY_NAMES[ticker];
    if (commodityName) {
        document.getElementById('modal-ticker-title').innerHTML = `
            ${mkt.exchange ? `<span style="font-size: 0.75rem; color: var(--accent); display: block; margin-bottom: 2px; letter-spacing: 0.05em;">${formatExchange(mkt.exchange)}</span>` : ''}
            <a href="https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}" target="_blank" style="color: inherit; text-decoration: none; border-bottom: 1px dashed var(--accent);" title="View ${ticker} on Yahoo Finance">${commodityName} <span style="font-size: 0.8em; color: var(--accent); vertical-align: middle;">↗</span></a>
        `;
        document.getElementById('modal-ticker-name').style.display = 'none';
        document.getElementById('modal-ticker-name').textContent = '';
    } else {
        document.getElementById('modal-ticker-name').style.display = 'block';
        document.getElementById('modal-ticker-title').innerHTML = `
            ${mkt.exchange ? `<span style="font-size: 0.75rem; color: var(--accent); display: block; margin-bottom: 2px; letter-spacing: 0.05em;">${formatExchange(mkt.exchange)}</span>` : ''}
            <a href="https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}" target="_blank" style="color: inherit; text-decoration: none; border-bottom: 1px dashed var(--accent);" title="View ${ticker} on Yahoo Finance">${ticker} <span style="font-size: 0.8em; color: var(--accent); vertical-align: middle;">↗</span></a>
        `;
        if (mkt.name) {
            document.getElementById('modal-ticker-name').textContent = mkt.name;
        } else {
            document.getElementById('modal-ticker-name').textContent = 'Loading company info...';
        }
    }

    // Signal badge
    const signal = insight ? (insight.signal || 'HOLD') : 'HOLD';
    if (sigBadge) {
        sigBadge.className = `signal-badge ${signal.toLowerCase()}`;
        sigBadge.textContent = signal;
    }

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
    const isDiscover = !currentModalInsight || ALL_DISCOVER_SYMBOLS.includes(mkt.ticker);
    const highLabel = isDiscover ? "52W HIGH" : "HIGH";
    const lowLabel = isDiscover ? "52W LOW" : "LOW";

    if (mkt.status === 'pending_data') {
        document.getElementById('modal-hero-stats').innerHTML = `
            <div class="hero-stat main"><div class="hero-stat-label">LAST PRICE</div><div class="hero-stat-value main">--</div></div>
            <div class="hero-stat main"><div class="hero-stat-label">DAY CHANGE</div><div class="hero-stat-value main">--</div></div>
            <div class="hero-stat"><div class="hero-stat-label">OPEN</div><div class="hero-stat-value">--</div></div>
            <div class="hero-stat"><div class="hero-stat-label">${highLabel}</div><div class="hero-stat-value">--</div></div>
            <div class="hero-stat"><div class="hero-stat-label">${lowLabel}</div><div class="hero-stat-value">--</div></div>
        `;
        return;
    }

    const isPos = (mkt.change_pct || 0) >= 0;
    const sign = isPos ? '+' : '';
    const changeColor = isPos ? 'var(--positive)' : 'var(--negative)';
    const statsBox = document.getElementById('modal-hero-stats');
    const modalPanel = document.querySelector('.modal-panel');

    if (!isPos) {
        statsBox.classList.add('trend-negative');
        if (modalPanel) modalPanel.classList.add('trend-negative');
    } else {
        statsBox.classList.remove('trend-negative');
        if (modalPanel) modalPanel.classList.remove('trend-negative');
    }

    let highValue = mkt.high_price ? formatPrice(mkt.high_price, mkt.currency, false, mkt.ticker) : "--";
    let lowValue = mkt.low_price ? formatPrice(mkt.low_price, mkt.currency, false, mkt.ticker) : "--";

    if (isDiscover) {
        if (mkt.info && mkt.info['52w_high'] !== undefined && mkt.info['52w_high'] !== null) {
            highValue = formatPrice(mkt.info['52w_high'], mkt.currency, false, mkt.ticker);
        } else if (mkt.high_52w !== undefined && mkt.high_52w !== null) {
            highValue = formatPrice(mkt.high_52w, mkt.currency, false, mkt.ticker);
        } else {
            highValue = "--";
        }

        if (mkt.info && mkt.info['52w_low'] !== undefined && mkt.info['52w_low'] !== null) {
            lowValue = formatPrice(mkt.info['52w_low'], mkt.currency, false, mkt.ticker);
        } else if (mkt.low_52w !== undefined && mkt.low_52w !== null) {
            lowValue = formatPrice(mkt.low_52w, mkt.currency, false, mkt.ticker);
        } else {
            lowValue = "--";
        }
    }

    statsBox.innerHTML = `
        <div class="hero-stat main">
            <div class="hero-stat-label">CLOSE PRICE</div>
            <div class="hero-stat-value main">${formatPrice(mkt.close_price, mkt.currency, false, mkt.ticker)}</div>
            ${renderExtendedHours(mkt)}
        </div>
        <div class="hero-stat main">
            <div id="modal-change-label" class="hero-stat-label">DAY CHANGE</div>
            <div id="modal-change-value" class="hero-stat-value main" style="color:${changeColor}">${sign}${(mkt.change_pct || 0).toFixed(2)}%</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">OPEN</div>
            <div class="hero-stat-value">${formatPrice(mkt.open_price, mkt.currency, false, mkt.ticker)}</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">${highLabel}</div>
            <div class="hero-stat-value">${highValue}</div>
        </div>
        <div class="hero-stat">
            <div class="hero-stat-label">${lowLabel}</div>
            <div class="hero-stat-value">${lowValue}</div>
        </div>
    `;
}

function updateModalPerformance(closes, period) {
    const labelEl = document.getElementById('modal-change-label');
    const valueEl = document.getElementById('modal-change-value');
    if (!labelEl || !valueEl || !closes || closes.length === 0) return;

    let displayLabel = 'DAY CHANGE';
    let perf = 0;

    if (period === '1d') {
        displayLabel = 'DAY CHANGE';
        // Use the default market data change if available for 1D
        if (currentModalMkt && typeof currentModalMkt.change_pct === 'number') {
            perf = currentModalMkt.change_pct;
        } else {
            const start = closes[0];
            const end = closes[closes.length - 1];
            perf = start ? ((end - start) / start) * 100 : 0;
        }
    } else {
        const start = closes[0];
        const end = closes[closes.length - 1];
        perf = start ? ((end - start) / start) * 100 : 0;

        const periodMap = {
            '1w': '1W CHANGE',
            '1mo': '1M CHANGE',
            '3mo': '3M CHANGE',
            '6mo': '6M CHANGE',
            'ytd': 'YTD CHANGE',
            '1y': '1Y CHANGE',
            '5y': '5Y CHANGE',
            'max': 'MAX (ALL TIME)'
        };
        displayLabel = periodMap[period] || `${period.toUpperCase()} CHANGE`;
    }

    const sign = perf >= 0 ? '+' : '';
    const color = perf >= 0 ? 'var(--positive)' : 'var(--negative)';

    labelEl.textContent = displayLabel;
    valueEl.textContent = `${sign}${perf.toFixed(2)}%`;
    valueEl.style.color = color;
}

function renderKeyStats(info, mkt) {
    const fmt = (v, isPrice, dec) => {
        if (v === null || v === undefined || v === '—') return '—';
        if (isPrice) return formatPrice(parseFloat(v), mkt.currency, false, mkt.ticker);
        return parseFloat(v).toFixed(dec || 2);
    };
    const fmtVol = v => v ? (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${(v / 1e3).toFixed(1)}K`) : '—';

    let stats = [
        { label: 'Market Cap', value: formatLargePrice(info.market_cap, mkt.currency, mkt.ticker) },
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

    // Only display 52W High and 52W Low for Discover Assets (which don't have AI insight)
    if (!currentModalInsight) {
        stats = stats.filter(s => s.label === '52W High' || s.label === '52W Low');
    }

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
                links = parsedNews.map(n => {
                    let pubVal = n.provider_publish_time || n.published;
                    if (pubVal && typeof pubVal === 'number' && pubVal < 10000000000) {
                        pubVal *= 1000;
                    }
                    return {
                        title: n.title,
                        url: n.link || n.url,
                        source: n.publisher || n.source,
                        published: pubVal
                    };
                });
            }
        } catch (e) { console.error("Modal news parse failed", e); }
    }

    if (links.length > 0) {
        container.innerHTML = links.slice(0, 5).map(h => {
            if (!h.title) return '';
            let pub = '';
            if (h.published) {
                const d = new Date(h.published);
                const day = String(d.getDate()).padStart(2, '0');
                const monthStr = d.toLocaleDateString('en-US', { month: 'short' });
                const year = d.getFullYear();
                pub = `${day} ${monthStr} ${year}`;
            }
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
    if (modalFinancialsChartInstance) {
        modalFinancialsChartInstance.destroy();
        modalFinancialsChartInstance = null;
    }
    if (modalForecastChartInstance) {
        modalForecastChartInstance.destroy();
        modalForecastChartInstance = null;
    }
    if (modalEPSChartInstance) {
        modalEPSChartInstance.destroy();
        modalEPSChartInstance = null;
    }
    currentModalTicker = null;
    currentModalFundamentals = null;
    currentModalEPS = null;
    currentModalHistoryData = null;
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
        currentModalHistoryData = { labels, closes };

        // Update company name
        if (data.info && data.info.name) {
            if (COMMODITY_NAMES[ticker]) {
                document.getElementById('modal-ticker-name').style.display = 'none';
                document.getElementById('modal-ticker-name').textContent = '';
            } else {
                document.getElementById('modal-ticker-name').style.display = 'block';
                document.getElementById('modal-ticker-name').textContent = data.info.name;
            }
        }

        // Color based on trend - use current day change if available, else period trend
        const dayChangeVal = (currentModalMkt && typeof currentModalMkt.change_pct === 'number') ? currentModalMkt.change_pct : (closes[closes.length - 1] - closes[0]);
        const isUp = dayChangeVal >= 0;
        const trendColor = isUp ? '#10b981' : '#f43f5e';
        const rgb = isUp ? '16, 185, 129' : '244, 63, 94';

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

        // Dynamically update the header performance metrics based on selected period
        updateModalPerformance(closes, period);

        if (modalChartInstance) { modalChartInstance.destroy(); modalChartInstance = null; }
        const ctx = document.getElementById('modal-history-chart').getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 350);
        gradient.addColorStop(0, `rgba(${rgb}, 0.25)`);
        gradient.addColorStop(1, `rgba(${rgb}, 0)`);

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
                        callbacks: { label: ctx => ` ${ctx.label}: ${formatPrice(ctx.parsed.y, currentModalMkt ? currentModalMkt.currency : 'USD', false, currentModalTicker)}` }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8', maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
                    y: {
                        beginAtZero: false,
                        ticks: {
                            color: '#94a3b8', callback: v => {
                                const isIndex = currentModalTicker && (currentModalTicker.startsWith('^') || DISCOVER_INDEX_SYMBOLS.includes(currentModalTicker));
                                if (isIndex) {
                                    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
                                }
                                const tc = (currentModalMkt && currentModalMkt.currency) ? (currentModalMkt.currency === 'GBp' ? 'GBP' : currentModalMkt.currency) : 'USD';
                                const tickerRate = EXCHANGE_RATES[tc] ? EXCHANGE_RATES[tc].rate : 1.0;
                                const usdValue = v / tickerRate;
                                const targetCurr = currentCurrency === 'DEFAULT' ? tc : currentCurrency;
                                const { symbol, rate } = EXCHANGE_RATES[targetCurr] || EXCHANGE_RATES['USD'];
                                return `${symbol}${(usdValue * rate).toFixed(0)}`;
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

        // Populating dynamic news headlines retrieved from backend
        if (data.news && data.news.length > 0) {
            currentModalMkt.headline_links = data.news.map(n => {
                let pubVal = n.provider_publish_time || n.published;
                if (pubVal && typeof pubVal === 'number' && pubVal < 10000000000) {
                    pubVal *= 1000;
                }
                return {
                    title: n.title,
                    url: n.link || n.url,
                    source: n.publisher || n.source,
                    published: pubVal
                };
            });
            renderModalNews(currentModalMkt);
        } else {
            renderModalNews(currentModalMkt);
        }

        // Render schedule timeline progress bar
        let timeline = data.market_timeline;
        if (!timeline) {
            const details = getMarketStatusDetails(ticker);
            const currentMins = details.localTime.getHours() * 60 + details.localTime.getMinutes();
            const currentPct = parseFloat(((currentMins / 1440) * 100).toFixed(2));
            const formattedTime = details.localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            
            timeline = {
                status: details.status,
                message: details.message,
                segments: details.segments,
                current_pct: currentPct,
                current_local_time: formattedTime
            };
        }

        if (timeline && timeline.segments && timeline.segments.length > 0) {
            renderMarketTimeline(timeline);
        } else {
            document.getElementById('modal-timeline-section').style.display = 'none';
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
        try { rationale = JSON.parse(text); } catch (e) { /* fallback to string */ }
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
let currentDiscoverPeriod = '1mo';

// Sparkline chart instances keyed by symbol

// Sparkline chart instances keyed by symbol
const discoverSparklineInstances = {};

function initDiscoverPeriodSelector() {
    ['discover-period-selector', 'commodity-period-selector'].forEach(id => {
        const selector = document.getElementById(id);
        if (!selector || selector.dataset.hooked) return;
        selector.addEventListener('click', (e) => {
            const btn = e.target.closest('.discover-period-btn');
            if (!btn) return;

            const period = btn.dataset.period;
            currentDiscoverPeriod = period;

            // Sync all discover selectors
            document.querySelectorAll('.discover-period-selector').forEach(s => {
                s.querySelectorAll('.discover-period-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.period === period);
                });
            });

            fetchDiscoverSparklines(currentDiscoverPeriod);
        });
        selector.dataset.hooked = 'true';
    });
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

        // Update Master History with latest live price
        (data.regions || []).forEach(r => {
            (r.indices || []).forEach(idx => {
                if (MASTER_HISTORY[idx.symbol]) {
                    const s = MASTER_HISTORY[idx.symbol];
                    if (s.length > 0) s[s.length - 1] = parseFloat(idx.price);
                }
            });
        });
        (data.commodities || []).forEach(c => {
            if (MASTER_HISTORY[c.symbol]) {
                const s = MASTER_HISTORY[c.symbol];
                if (s.length > 0) s[s.length - 1] = parseFloat(c.price);
            }
        });

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
async function fetchDiscoverSparklines(period = '3mo') {
    // Show skeleton opacity while loading
    document.querySelectorAll('.discover-sparkline-wrap').forEach(el => {
        el.style.opacity = '0.2';
    });

    try {
        const sliceLen = getSliceLen(period);
        const useMaster = (period !== '1d' && period !== '1w' && period !== '5y') && Object.keys(MASTER_HISTORY).length > 0;

        const renderGroup = (groupData) => {
            if (!groupData) return;
            document.querySelectorAll('[data-discover-symbol]').forEach(card => {
                const sym = card.dataset.discoverSymbol;
                if (!groupData[sym]) return;

                const closes = groupData[sym];
                if (!closes || closes.length === 0) return;

                const wrap = card.querySelector('.discover-sparkline-wrap');
                if (wrap) wrap.style.opacity = '0.5';

                const isPos = closes[closes.length - 1] >= closes[0];
                const color = isPos ? '#10b981' : '#f43f5e';
                if (!wrap) return;

                drawDiscoverSparkline(wrap, sym, closes, color);

                const pctChange = calculateChange(closes[0], closes[closes.length - 1]);
                const badge = card.querySelector('.discover-change-badge');
                if (badge && !isNaN(pctChange) && isFinite(pctChange)) {
                    const sign = pctChange >= 0 ? '+' : '';
                    badge.className = `discover-change-badge ${pctChange >= 0 ? 'pos' : 'neg'}`;
                    badge.textContent = `${sign}${pctChange.toFixed(2)}%`;
                }
            });
        };

        if (useMaster) {
            debugLog(`Using MASTER_HISTORY for Discover ${period}`);
            const masterData = {};
            ALL_DISCOVER_SYMBOLS.forEach(sym => {
                if (MASTER_HISTORY[sym]) {
                    masterData[sym] = MASTER_HISTORY[sym].slice(-sliceLen);
                }
            });
            renderGroup(masterData);
        } else {
            debugLog(`Fetching high-res batch for Discover ${period}`);
            try {
                // Fetch all symbols in one batch to ensure synchronization
                const res = await fetch(`/api/v1/market/batch-history?symbols=${encodeURIComponent(ALL_DISCOVER_SYMBOLS.join(','))}&period=${period}`);
                if (!res.ok) throw new Error(`Batch fetch failed: ${res.status}`);
                const json = await res.json();

                if (json.data) {
                    const receivedCount = Object.keys(json.data).length;
                    const emptyCount = Object.values(json.data).filter(d => !d || d.length === 0).length;
                    debugLog(`Received ${receivedCount} sparklines (${emptyCount} empty)`);
                    renderGroup(json.data);
                }
            } catch (e) {
                console.error('Discover batch fetch failed:', e);
                // Reset opacity on error so cards don't stay hidden
                document.querySelectorAll('.discover-sparkline-wrap').forEach(el => el.style.opacity = '1');
            }
        }
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

        // Aggressive Smart Scaling: Ensure we see movement even for stable assets
        const minVal = Math.min(...dataset);
        const maxVal = Math.max(...dataset);
        const range = maxVal - minVal;

        // Use a tighter padding (2%) for better dynamic feel, with a minimum floor to avoid Infinity
        const padding = range === 0 ? (minVal * 0.01 || 1) : range * 0.02;

        // Premium Gradient Aesthetic
        const rgb = color === '#10b981' ? '16, 185, 129' : '244, 63, 94';
        const gradient = ctx.createLinearGradient(0, 0, 0, 80);
        gradient.addColorStop(0, `rgba(${rgb}, 0.28)`);
        gradient.addColorStop(0.6, `rgba(${rgb}, 0.05)`);
        gradient.addColorStop(1, `rgba(${rgb}, 0)`);

        discoverSparklineInstances[symbol] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dataset.map((_, i) => i),
                datasets: [{
                    data: dataset,
                    borderColor: color,
                    borderWidth: 1.8,
                    pointRadius: 0,
                    tension: 0.45,
                    fill: true,
                    backgroundColor: gradient,
                    borderCapStyle: 'round'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false }, datalabels: { display: false } },
                scales: {
                    x: { display: false },
                    y: {
                        display: false,
                        min: minVal - padding,
                        max: maxVal + padding,
                        beginAtZero: false
                    }
                },
                animation: { duration: 600, easing: 'easeOutQuart' }
            }
        });
    } else {
        // Update existing instance
        const chart = discoverSparklineInstances[symbol];
        const ctx = chart.ctx;

        // Recalculate gradient to match new color
        const rgb = color === '#10b981' ? '16, 185, 129' : '244, 63, 94';
        const gradient = ctx.createLinearGradient(0, 0, 0, 52);
        gradient.addColorStop(0, `rgba(${rgb}, 0.25)`);
        gradient.addColorStop(1, `rgba(${rgb}, 0)`);

        chart.data.labels = dataset.map((_, i) => i);
        chart.data.datasets[0].data = dataset;
        chart.data.datasets[0].borderColor = color;
        chart.data.datasets[0].backgroundColor = gradient;

        // Update scale bounds for new data range (match new smart scaling logic)
        const minVal = Math.min(...dataset);
        const maxVal = Math.max(...dataset);
        const range = maxVal - minVal;
        const padding = range === 0 ? (minVal * 0.01 || 1) : range * 0.02;

        chart.options.scales.y.min = minVal - padding;
        chart.options.scales.y.max = maxVal + padding;

        chart.update('none');
    }
}

function _buildIndexCard(idx) {
    const details = getMarketStatusDetails(idx.symbol);
    const status = details.status;
    const statusClass = status.toLowerCase();
    const isPos = idx.change_pct >= 0;
    const sign = isPos ? '+' : '';
    const priceStr = idx.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const flagHtml = idx.flag ? `<span style="margin-right: 0.4rem; font-size: 1.1rem; vertical-align: middle;">${idx.flag}</span>` : '';
    
    return `<div class="discover-index-card" data-discover-symbol="${idx.symbol}" style="cursor: pointer;" onclick="openDiscoverAssetModal('${idx.symbol}')">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div class="discover-index-name">${flagHtml}${idx.name}</div>
                        <div style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-start;">
                            <span class="market-status-badge ${statusClass}" data-status-badge style="margin-top: 0;">
                                <span class="market-status-dot"></span>
                                ${status}
                            </span>
                            <span class="market-status-msg" data-status-msg style="margin-top: 0;">${details.message || ''}</span>
                        </div>
                    </div>
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
                const statusEl = card.querySelector('[data-status-badge]');
                const statusMsgEl = card.querySelector('[data-status-msg]');
                
                if (priceEl) priceEl.textContent = idx.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
                if (badgeEl) {
                    badgeEl.textContent = `${sign}${idx.change_pct.toFixed(2)}%`;
                    badgeEl.className = `discover-change-badge ${isPos ? 'pos' : 'neg'}`;
                }
                
                const details = getMarketStatusDetails(idx.symbol);
                if (statusEl) {
                    statusEl.className = `market-status-badge ${details.status.toLowerCase()}`;
                    statusEl.innerHTML = `<span class="market-status-dot"></span>${details.status}`;
                }
                if (statusMsgEl) {
                    statusMsgEl.textContent = details.message || '';
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
        if (c.unit === 'oz') {
            if (c.symbol === 'SI=F' || c.name.toLowerCase().includes('silver')) {
                displayPrice = displayPrice / 0.0283495;
                displayUnit = 'kg';
            } else {
                displayPrice = displayPrice / 28.3495;
                displayUnit = 'g';
            }
        }
        else if (c.unit === 'lb') {
            displayPrice = displayPrice * 2.20462;
            displayUnit = 'kg';
        }
        // Oil ('bbl') stays barrel unit unchanged
    }
    return `<div class="discover-index-card" data-discover-symbol="${c.symbol}" data-commodity-icon="${c.icon}" data-commodity-name="${c.name}" data-commodity-unit="${c.unit}" data-commodity-currency="${c.currency || 'USD'}" style="cursor: pointer;" onclick="openDiscoverAssetModal('${c.symbol}')">
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
                if (c.unit === 'oz') {
                    if (c.symbol === 'SI=F' || c.name.toLowerCase().includes('silver')) {
                        displayPrice = displayPrice / 0.0283495;
                        displayUnit = 'kg';
                    } else {
                        displayPrice = displayPrice / 28.3495;
                        displayUnit = 'g';
                    }
                }
                else if (c.unit === 'lb') {
                    displayPrice = displayPrice * 2.20462;
                    displayUnit = 'kg';
                }
                // Oil ('bbl') stays barrel unit unchanged
            }
            const priceEl = card.querySelector('[data-price]');
            const unitEl = card.querySelector('[data-unit]');
            const badgeEl = card.querySelector('[data-badge]');
            if (priceEl) priceEl.textContent = formatPrice(displayPrice, c.currency || 'USD');
            if (unitEl) unitEl.textContent = `/${displayUnit}`;
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
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary);text-align:center;padding:1rem;">No data yet</td></tr>';
        return;
    }

    const getRegionFlag = (ticker) => {
        if (ticker.endsWith('.AX')) return '🇦🇺 AUS';
        if (ticker.endsWith('.T')) return '🇯🇵 JPN';
        if (ticker.endsWith('.HK')) return '🇭🇰 HKG';
        if (ticker.endsWith('.L')) return '🇬🇧 GBR';
        if (ticker.endsWith('.PA')) return '🇫🇷 FRA';
        if (ticker.endsWith('.AS')) return '🇳🇱 NLD';
        if (ticker.endsWith('.DE')) return '🇩🇪 DEU';
        if (ticker.endsWith('.NS')) return '🇮🇳 IND';
        if (ticker.endsWith('.TO')) return '🇨🇦 CAN';
        return '🇺🇸 USA';
    };

    tbody.innerHTML = movers.map((m, i) => {
        const sign = m.change_pct >= 0 ? '+' : '';
        const color = m.change_pct >= 0 ? '#10b981' : '#f43f5e';
        const region = getRegionFlag(m.ticker);

        // Remove truncation, allow wrapping in CSS
        const name = m.company_name || m.ticker;

        return `<tr style="cursor: pointer;" onclick="window.open('https://finance.yahoo.com/quote/${encodeURIComponent(m.ticker)}', '_blank')" title="View ${m.ticker} on Yahoo Finance">
            <td style="vertical-align: top;"><strong>${m.ticker}</strong></td>
            <td style="vertical-align: top;">
                <div class="movers-company-name">${name}</div>
            </td>
            <td style="vertical-align: top; color:var(--text-secondary); font-size: 0.7rem; font-weight: 600;">${region}</td>
            <td style="text-align:right; vertical-align: top;">
                <div style="font-weight: 500;">${formatPrice(m.price, m.currency || 'USD')}</div>
                ${renderExtendedHours(m)}
            </td>
            <td style="text-align:right; color:${color}; font-weight: 700; vertical-align: top;">${sign}${m.change_pct.toFixed(2)}%</td>
        </tr>`;
    }).join('');
}

function renderTopNews(articles) {
    const el = document.getElementById('discover-news');
    if (!el) return;
    if (!articles.length) { el.innerHTML = '<p style="color:var(--text-secondary)">No news available yet.</p>'; return; }
    el.innerHTML = articles.map(a => {
        const d = a.published ? new Date(a.published) : null;
        const day = d ? String(d.getDate()).padStart(2, '0') : '';
        const monthStr = d ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
        const year = d ? d.getFullYear() : '';
        const dateStr = d ? `${day} ${monthStr} ${year}` : '';
        const timeStr = d ? d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '';
        const fullTime = d ? `${dateStr}, ${timeStr}` : '';
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

let _activeSortKey = localStorage.getItem('insights_custom_ticker_order') ? 'custom' : 'name';

function initManageFilters() {
    const search = document.getElementById('asset-search');
    const country = document.getElementById('filter-country');
    const exchange = document.getElementById('filter-exchange');

    if (!search) return;

    search.addEventListener('input', applyManageFilters);
    country.addEventListener('change', applyManageFilters);
    exchange.addEventListener('change', applyManageFilters);

    // Style the initial sort button active state
    document.querySelectorAll('.sort-btn').forEach(btn => {
        if (btn.dataset.sort === _activeSortKey) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

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
            case 'custom': {
                let customOrder = [];
                try {
                    customOrder = JSON.parse(localStorage.getItem('insights_custom_ticker_order') || '[]');
                } catch (e) {}
                const idxA = customOrder.indexOf(aT);
                const idxB = customOrder.indexOf(bT);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return aT.localeCompare(bT);
            }
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
function initPortfolioPeriodSelector() {
    const selector = document.getElementById('portfolio-period-selector');
    if (!selector) return;

    selector.addEventListener('click', async e => {
        const btn = e.target.closest('.period-btn');
        if (!btn) return;

        // Don't re-fetch if already active
        if (btn.classList.contains('active')) return;

        document.querySelectorAll('#portfolio-period-selector .period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPortfolioPeriod = btn.dataset.period;

        // Trigger a fresh calculation/fetch for the portfolio chart
        const marketArr = Object.values(lastMarketData);
        if (marketArr.length > 0) {
            await updatePortfolioChart(marketArr);
        }
    });
}

/* =====================================================
   Ticker Fundamentals & Forecasts Fetch & Render
   ===================================================== */
async function fetchAndRenderFundamentals(ticker) {
    if (currentModalFundamentals) return;
    
    const loader = document.getElementById('modal-financials-loader');
    if (loader) {
        loader.style.display = 'block';
        loader.textContent = 'Fetching financial statements...';
    }
    
    try {
        const [fundRes, epsRes] = await Promise.all([
            fetch(`/api/v1/market/fundamentals/${ticker}`),
            fetch(`/api/v1/market/eps/${ticker}`)
        ]);
        
        if (!fundRes.ok) throw new Error('Failed to fetch fundamentals');
        const data = await fundRes.json();
        
        let epsData = { ticker, eps: [] };
        if (epsRes.ok) {
            epsData = await epsRes.json();
        }
        
        currentModalFundamentals = data;
        currentModalEPS = epsData;
        if (loader) loader.style.display = 'none';
        
        // Render all segments
        renderModalFinancialsChart(data);
        renderModalOwnership(data);
        renderModalDividends(data);
        renderModalForecasts(data, epsData);
        
    } catch (e) {
        console.error("Error fetching fundamentals:", e);
        if (loader) loader.textContent = 'Failed to load fundamental data.';
    }
}

function renderModalFinancialsChart(data) {
    const wrapper = document.getElementById('modal-financials-chart-wrapper');
    if (!wrapper) return;
    
    if (!data.financials || !data.financials.periods || data.financials.periods.length === 0) {
        wrapper.style.display = 'none';
        return;
    }
    
    wrapper.style.display = 'block';
    
    // Data is ordered oldest to newest from the backend
    const labels = data.financials.periods;
    const revenue = data.financials.revenue;
    const grossProfit = data.financials.gross_profit;
    const operatingIncome = data.financials.operating_income;
    const netIncome = data.financials.net_income;

    if (modalFinancialsChartInstance) {
        modalFinancialsChartInstance.destroy();
    }

    const ctx = document.getElementById('modal-financials-chart').getContext('2d');
    
    // Bar styling
    const formatter = (value) => {
        if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B';
        if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
        return value;
    };

    modalFinancialsChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Revenue',
                    data: revenue,
                    backgroundColor: 'rgba(56, 189, 248, 0.8)',
                    borderRadius: 4,
                },
                {
                    label: 'Gross Profit',
                    data: grossProfit,
                    backgroundColor: 'rgba(129, 140, 248, 0.8)',
                    borderRadius: 4,
                },
                {
                    label: 'Operating Income',
                    data: operatingIncome,
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderRadius: 4,
                },
                {
                    label: 'Net Income',
                    data: netIncome,
                    backgroundColor: 'rgba(245, 158, 11, 0.8)',
                    borderRadius: 4,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: 'rgba(255, 255, 255, 0.7)', font: { size: 11 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.9)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: $${formatter(ctx.raw)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: 'rgba(255, 255, 255, 0.5)' }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.5)',
                        callback: function(value) { return '$' + formatter(value); }
                    }
                }
            }
        }
    });
}

function renderModalOwnership(data) {
    const section = document.getElementById('modal-ownership-section');
    const bar = document.getElementById('modal-ownership-bar');
    if (!section || !bar) return;
    
    if (!data.ownership) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    
    const instPct = data.ownership.institutions || 0;
    const insPct = data.ownership.insiders || 0;
    let pubPct = data.ownership.public || 0;
    if (pubPct < 0) pubPct = 0;
    
    bar.innerHTML = `
        <div class="ownership-segment institutions" style="width: ${instPct}%">${instPct > 5 ? instPct.toFixed(1) + '%' : ''}</div>
        <div class="ownership-segment insiders" style="width: ${insPct}%">${insPct > 5 ? insPct.toFixed(1) + '%' : ''}</div>
        <div class="ownership-segment public" style="width: ${pubPct}%">${pubPct > 5 ? pubPct.toFixed(1) + '%' : ''}</div>
    `;
    
    document.getElementById('modal-ownership-legend').innerHTML = `
        <div class="legend-item"><div class="legend-dot institutions"></div>Institutions (${instPct.toFixed(1)}%)</div>
        <div class="legend-item"><div class="legend-dot insiders"></div>Insiders (${insPct.toFixed(1)}%)</div>
        <div class="legend-item"><div class="legend-dot public"></div>Public/Other (${pubPct.toFixed(1)}%)</div>
    `;
}

function renderModalDividends(data) {
    const section = document.getElementById('modal-dividends-section');
    const tbody = document.querySelector('#modal-dividends-table tbody');
    if (!section || !tbody) return;
    
    if (!data.dividends || data.dividends.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    
    tbody.innerHTML = data.dividends.map(div => {
        // Date comes in as string 'YYYY-MM-DD'
        const d = new Date(div.date);
        const day = String(d.getUTCDate()).padStart(2, '0');
        const monthStr = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
        const year = d.getUTCFullYear();
        
        return `
            <tr>
                <td>${day} ${monthStr} ${year}</td>
                <td style="font-weight:600; color:var(--positive);">$${div.amount.toFixed(3)}</td>
            </tr>
        `;
    }).join('');
}

function renderModalForecasts(data, epsData) {
    const info = currentModalMkt?.info || {};

    // 1. Analyst Rating Gauge
    const gaugeWrapper = document.getElementById('modal-analyst-gauge');
    if (gaugeWrapper && info.recommendation) {
        const rec = info.recommendation.replace('_', ' ').toUpperCase();
        gaugeWrapper.innerHTML = `<div class="analyst-gauge-label">${rec}</div>`;
        
        // Also show the mean target if available in text
        if (info.target_price) {
            gaugeWrapper.innerHTML += `<div style="margin-left: 2rem; display: flex; flex-direction: column;">
                <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Mean Target</span>
                <span style="font-size: 1.2rem; font-weight: 700; color: var(--positive);">$${info.target_price.toFixed(2)}</span>
            </div>`;
        }
    } else if (gaugeWrapper) {
        gaugeWrapper.innerHTML = `<div class="analyst-gauge-label" style="font-size: 1rem; color: var(--text-secondary);">NO RATING AVAILABLE</div>`;
    }

    // 2. TradingView-Style Price Target Forecast Cone
    const targetSection = document.getElementById('modal-target-section');
    if (targetSection) {
        if (!info.target_low || !info.target_high || !info.target_price) {
            targetSection.style.display = 'none';
        } else {
            targetSection.style.display = 'block';
            
            if (modalForecastChartInstance) {
                modalForecastChartInstance.destroy();
            }

            const ctx = document.getElementById('modal-forecast-chart').getContext('2d');
            
            // Build historical context + future forecast cone
            const currentPrice = currentModalMkt?.close_price || info.target_low;
            
            let histLabels = [];
            let histValues = [];
            
            if (currentModalHistoryData && currentModalHistoryData.labels && currentModalHistoryData.labels.length > 0) {
                // Take last 30 points of daily history for context
                const count = Math.min(30, currentModalHistoryData.labels.length);
                histLabels = currentModalHistoryData.labels.slice(-count);
                histValues = currentModalHistoryData.closes.slice(-count);
            } else {
                // Fallback context if no history loaded
                histLabels = ['Past Month', 'Current'];
                histValues = [currentPrice * 0.98, currentPrice];
            }
            
            const lastHistIndex = histValues.length - 1;
            
            // Create Future forecast labels (12 months ahead)
            const futureLabels = [];
            const currentDate = new Date();
            for (let i = 1; i <= 12; i++) {
                const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
                futureLabels.push(nextMonth.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
            }
            
            // Combine Labels
            const allLabels = [...histLabels, ...futureLabels];
            
            // Build datasets for High, Mean, Low
            // High Target dataset: starts at currentPrice, branches to target_high
            const highData = new Array(histValues.length).fill(null);
            highData[lastHistIndex] = currentPrice;
            for (let i = 0; i < 12; i++) {
                highData.push(currentPrice + ((info.target_high - currentPrice) * (i + 1) / 12));
            }
            
            // Low Target dataset: starts at currentPrice, branches to target_low
            const lowData = new Array(histValues.length).fill(null);
            lowData[lastHistIndex] = currentPrice;
            for (let i = 0; i < 12; i++) {
                lowData.push(currentPrice + ((info.target_low - currentPrice) * (i + 1) / 12));
            }
            
            // Mean Target dataset: starts at currentPrice, branches to target_price
            const meanData = new Array(histValues.length).fill(null);
            meanData[lastHistIndex] = currentPrice;
            for (let i = 0; i < 12; i++) {
                meanData.push(currentPrice + ((info.target_price - currentPrice) * (i + 1) / 12));
            }
            
            // Historical dataset (null for future part)
            const histDataset = [...histValues, ...new Array(12).fill(null)];
            
            modalForecastChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: allLabels,
                    datasets: [
                        {
                            label: 'Low Forecast Bound',
                            data: lowData,
                            borderColor: 'rgba(239, 68, 68, 0.4)',
                            borderWidth: 1.5,
                            borderDash: [4, 4],
                            fill: false,
                            pointStyle: 'none',
                            pointRadius: 0
                        },
                        {
                            label: 'Forecast Range Area',
                            data: highData,
                            borderColor: 'rgba(34, 197, 94, 0.4)',
                            borderWidth: 1.5,
                            borderDash: [4, 4],
                            fill: 0, // Fills space between this dataset and dataset 0 (Low Target)
                            backgroundColor: 'rgba(16, 185, 129, 0.05)',
                            pointStyle: 'none',
                            pointRadius: 0
                        },
                        {
                            label: 'Consensus Target',
                            data: meanData,
                            borderColor: '#eab308', // Gold
                            borderWidth: 2,
                            borderDash: [6, 4],
                            fill: false,
                            pointRadius: (ctx) => ctx.dataIndex === ctx.dataset.data.length - 1 ? 6 : 0,
                            pointBackgroundColor: '#eab308',
                            pointBorderColor: '#fff',
                            pointHoverRadius: 8
                        },
                        {
                            label: 'Historical Close',
                            data: histDataset,
                            borderColor: '#38bdf8', // Accent blue
                            borderWidth: 2.5,
                            fill: false,
                            pointRadius: 0,
                            pointHoverRadius: 5
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                color: 'rgba(255, 255, 255, 0.6)',
                                font: { size: 10 },
                                filter: (item) => ['Consensus Target', 'Historical Close'].includes(item.text)
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(15,23,42,0.95)',
                            titleColor: '#94a3b8',
                            bodyColor: '#f8fafc',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            callbacks: {
                                label: (context) => {
                                    if (context.raw === null) return null;
                                    return ` ${context.dataset.label}: $${context.raw.toFixed(2)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255,255,255,0.03)' },
                            ticks: {
                                color: 'rgba(255, 255, 255, 0.4)',
                                maxRotation: 0,
                                autoSkip: true,
                                maxTicksLimit: 8
                            }
                        },
                        y: {
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: {
                                color: 'rgba(255, 255, 255, 0.6)',
                                callback: (v) => '$' + v
                            }
                        }
                    }
                }
            });
        }
    }

    // 3. EPS Earnings Performance Panel
    const epsSection = document.getElementById('modal-eps-section');
    if (epsSection) {
        if (!epsData || !epsData.eps || epsData.eps.length === 0) {
            epsSection.style.display = 'none';
        } else {
            epsSection.style.display = 'block';
            
            // Format and display EPS Dual-Bar Chart
            // The EPS data is returned newest-first. We want oldest-first for the chart timeline
            let filteredEps = [...epsData.eps].reverse();
            
            // Limit to standard 8 quarters to prevent UI clutter
            filteredEps = filteredEps.slice(-8);

            // EPS Toggle behavior
            let currentView = 'quarterly'; // default
            
            const renderEpsElements = (view) => {
                if (modalEPSChartInstance) {
                    modalEPSChartInstance.destroy();
                }

                const ctx = document.getElementById('modal-eps-chart').getContext('2d');
                
                let labels = [];
                let estimates = [];
                let reported = [];
                let listData = [];

                if (view === 'annual' && currentModalFundamentals && currentModalFundamentals.financials) {
                    // Pull from Fundamentals annual metrics
                    const fin = currentModalFundamentals.financials;
                    labels = fin.periods || [];
                    reported = fin.net_income || [];
                    
                    // In yfinance, standard estimated EPS is quarterly. 
                    // For annual estimate we can show a nice bar of Net Income vs. Gross Profit, or simply map the annual Net Income!
                    // Let's make it easy: if 'annual' selected, we render corporate Net Income vs. Operating Income as a custom comparative bar,
                    // which is incredibly high-value since corporate EPS aggregates to Net Income!
                    // Let's map net_income vs gross_profit or net_income alone:
                    estimates = fin.operating_income || [];
                    
                    modalEPSChartInstance = new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: labels,
                            datasets: [
                                {
                                    label: 'Operating Income ($B)',
                                    data: estimates.map(v => v / 1e9),
                                    backgroundColor: 'rgba(148, 163, 184, 0.4)',
                                    borderColor: 'rgba(148, 163, 184, 0.8)',
                                    borderWidth: 1,
                                    borderRadius: 4
                                },
                                {
                                    label: 'Net Income ($B)',
                                    data: reported.map(v => v / 1e9),
                                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                                    borderColor: '#3b82f6',
                                    borderWidth: 1,
                                    borderRadius: 4
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    display: true,
                                    position: 'top',
                                    labels: { color: 'rgba(255, 255, 255, 0.6)', font: { size: 10 } }
                                },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => ` ${ctx.dataset.label}: $${ctx.raw.toFixed(2)}B`
                                    }
                                }
                            },
                            scales: {
                                x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: 'rgba(255, 255, 255, 0.5)' } },
                                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255, 255, 255, 0.6)', callback: (v) => '$' + v + 'B' } }
                            }
                        }
                    });

                    // Render Annual table rows
                    const tbody = document.getElementById('modal-eps-tbody');
                    tbody.innerHTML = labels.map((p, idx) => {
                        const netVal = reported[idx] ? `$${(reported[idx] / 1e9).toFixed(2)}B` : 'N/A';
                        const opVal = estimates[idx] ? `$${(estimates[idx] / 1e9).toFixed(2)}B` : 'N/A';
                        return `
                            <tr style="border-bottom: 1px solid var(--glass-border); hover: background: rgba(255,255,255,0.02)">
                                <td style="padding: 0.75rem 1rem; color: #fff; font-weight: 500;">FY ${p}</td>
                                <td style="padding: 0.75rem 1rem; color: #94a3b8;">${opVal} (Oper.)</td>
                                <td style="padding: 0.75rem 1rem; color: #3b82f6; font-weight: 600;">${netVal} (Net)</td>
                                <td style="padding: 0.75rem 1rem; text-align: right;"><span class="surprise-pill neutral">Corporate</span></td>
                            </tr>
                        `;
                    }).reverse().join('');

                } else {
                    // Render standard Quarterly EPS
                    labels = filteredEps.map(e => {
                        const d = new Date(e.date);
                        return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                    });
                    estimates = filteredEps.map(e => e.estimate);
                    reported = filteredEps.map(e => e.reported);
                    listData = filteredEps;

                    modalEPSChartInstance = new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: labels,
                            datasets: [
                                {
                                    label: 'Estimate EPS',
                                    data: estimates,
                                    backgroundColor: 'rgba(148, 163, 184, 0.35)',
                                    borderColor: 'rgba(148, 163, 184, 0.7)',
                                    borderWidth: 1,
                                    borderRadius: 4
                                },
                                {
                                    label: 'Reported EPS',
                                    data: reported,
                                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                                    borderColor: '#3b82f6',
                                    borderWidth: 1,
                                    borderRadius: 4
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    display: true,
                                    position: 'top',
                                    labels: { color: 'rgba(255, 255, 255, 0.6)', font: { size: 10 } }
                                },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => ` ${ctx.dataset.label}: $${ctx.raw.toFixed(2)}`
                                    }
                                }
                            },
                            scales: {
                                x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: 'rgba(255, 255, 255, 0.5)' } },
                                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255, 255, 255, 0.6)', callback: (v) => '$' + v } }
                            }
                        }
                    });

                    // Render table rows (newest first)
                    const tbody = document.getElementById('modal-eps-tbody');
                    const reversedList = [...listData].reverse();
                    tbody.innerHTML = reversedList.map(e => {
                        const est = e.estimate !== null ? `$${e.estimate.toFixed(2)}` : 'N/A';
                        const rep = e.reported !== null ? `$${e.reported.toFixed(2)}` : 'N/A';
                        
                        let surpriseBadge = '';
                        if (e.surprise !== null) {
                            const isPositive = e.surprise >= 0;
                            const sign = isPositive ? '+' : '';
                            const statusClass = isPositive ? 'positive' : 'negative';
                            surpriseBadge = `<span class="surprise-pill ${statusClass}">${sign}${e.surprise.toFixed(1)}%</span>`;
                        } else {
                            surpriseBadge = `<span class="surprise-pill neutral">N/A</span>`;
                        }

                        const d = new Date(e.date);
                        const formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

                        return `
                            <tr style="border-bottom: 1px solid var(--glass-border); hover: background: rgba(255,255,255,0.02)">
                                <td style="padding: 0.75rem 1rem; color: #fff; font-weight: 500;">${formattedDate}</td>
                                <td style="padding: 0.75rem 1rem; color: #94a3b8;">${est}</td>
                                <td style="padding: 0.75rem 1rem; color: #3b82f6; font-weight: 600;">${rep}</td>
                                <td style="padding: 0.75rem 1rem; text-align: right;">${surpriseBadge}</td>
                            </tr>
                        `;
                    }).join('');
                }
            };

            // Set up button selectors
            const qBtn = document.getElementById('eps-toggle-quarterly');
            const aBtn = document.getElementById('eps-toggle-annual');
            
            if (qBtn && aBtn) {
                qBtn.onclick = () => {
                    qBtn.classList.add('active');
                    aBtn.classList.remove('active');
                    currentView = 'quarterly';
                    renderEpsElements('quarterly');
                };

                aBtn.onclick = () => {
                    aBtn.classList.add('active');
                    qBtn.classList.remove('active');
                    currentView = 'annual';
                    renderEpsElements('annual');
                };
            }

            // Initial quarterly render
            renderEpsElements('quarterly');
        }
    }
}

/* =====================================================
   Stock Search & Comparison Functionality
   ===================================================== */
let currentSearchTicker = null;
let currentSearchPeriod = '1mo';
let currentSearchChart = null;
let comparisonTickers = [];
let comparisonData = {};

// Helper functions for client-side technical indicators
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    let sum = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        sum += prices[i];
    }
    return sum / period;
}

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateEMASeries(prices, period) {
    const emaSeries = [];
    if (prices.length === 0) return emaSeries;
    const k = 2 / (period + 1);
    let ema = prices[0];
    emaSeries.push(ema);
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
        emaSeries.push(ema);
    }
    return emaSeries;
}

function calculateRSI(prices, period = 20) {
    if (prices.length < period + 1) return 50.0;
    
    let gains = [];
    let losses = [];
    for (let i = 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) {
            gains.push(diff);
            losses.push(0);
        } else {
            gains.push(0);
            losses.push(-diff);
        }
    }
    
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
        avgGain += gains[i];
        avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    
    if (avgLoss === 0) return 100.0;
    const rs = avgGain / avgLoss;
    return 100.0 - (100.0 / (1.0 + rs));
}

function calculateStochastic(highs, lows, closes, period = 20) {
    if (closes.length < period) return { k: 50.0, d: 50.0 };
    
    const kSeries = [];
    const startIdx = Math.max(0, closes.length - period - 10);
    for (let i = startIdx; i < closes.length; i++) {
        if (i < period - 1) continue;
        
        let lowestLow = Infinity;
        let highestHigh = -Infinity;
        for (let j = i - period + 1; j <= i; j++) {
            if (lows[j] < lowestLow) lowestLow = lows[j];
            if (highs[j] > highestHigh) highestHigh = highs[j];
        }
        
        const denom = highestHigh - lowestLow;
        const k = denom === 0 ? 50.0 : ((closes[i] - lowestLow) / denom) * 100;
        kSeries.push(k);
    }
    
    const kVal = kSeries[kSeries.length - 1];
    let dVal = kVal;
    if (kSeries.length >= 3) {
        dVal = (kSeries[kSeries.length - 1] + kSeries[kSeries.length - 2] + kSeries[kSeries.length - 3]) / 3;
    }
    
    return { k: kVal, d: dVal };
}

function calculateWeightedAlpha(ohlcv) {
    const N = ohlcv.length;
    if (N < 5) return 0.0;
    
    const weeklyCloses = [];
    for (let i = 0; i <= 52; i++) {
        const idx = N - 1 - i * 5;
        if (idx >= 0) {
            weeklyCloses.push(ohlcv[idx].close);
        } else {
            break;
        }
    }
    
    if (weeklyCloses.length < 2) return 0.0;
    
    let weightedSum = 0;
    let sumWeights = 0;
    const numReturns = weeklyCloses.length - 1;
    
    for (let i = 0; i < numReturns; i++) {
        const val_today = weeklyCloses[i];
        const val_prev = weeklyCloses[i + 1];
        if (val_prev <= 0) continue;
        
        const ret = ((val_today - val_prev) / val_prev) * 100;
        const wt = Math.max(1, 52 - i);
        
        weightedSum += ret * wt;
        sumWeights += wt;
    }
    
    return sumWeights > 0 ? (weightedSum / sumWeights) : 0.0;
}

function calculateOpinion(closes, highs, lows, sma20, sma50, sma100, rsi20, stochK, stochD) {
    const N = closes.length;
    if (N < 20) return { score: 50, opinion: 'Neutral' };
    
    const currentPrice = closes[N - 1];
    let buyRules = 0;
    
    if (sma20 && currentPrice > sma20) buyRules++;
    if (sma50 && currentPrice > sma50) buyRules++;
    if (sma100 && currentPrice > sma100) buyRules++;
    if (sma20 && sma50 && sma20 > sma50) buyRules++;
    if (rsi20 > 50) buyRules++;
    if (stochK > 50) buyRules++;
    if (stochK > stochD) buyRules++;
    
    const ema12Series = calculateEMASeries(closes, 12);
    const ema26Series = calculateEMASeries(closes, 26);
    const macdLineSeries = [];
    for (let i = 0; i < closes.length; i++) {
        macdLineSeries.push(ema12Series[i] - ema26Series[i]);
    }
    const signalLineSeries = calculateEMASeries(macdLineSeries, 9);
    
    const currentMacd = macdLineSeries[macdLineSeries.length - 1];
    const currentSignal = signalLineSeries[signalLineSeries.length - 1];
    if (currentMacd > currentSignal) buyRules++;
    
    const price5d = closes[N - 6] || closes[0];
    if (currentPrice > price5d) buyRules++;
    
    const price20d = closes[N - 21] || closes[0];
    if (currentPrice > price20d) buyRules++;
    
    const percentage = buyRules * 10;
    let opinion = 'Neutral';
    if (buyRules >= 8) opinion = 'Strong Buy';
    else if (buyRules >= 6) opinion = 'Buy';
    else if (buyRules <= 2) opinion = 'Strong Sell';
    else if (buyRules <= 4) opinion = 'Sell';
    
    return { score: percentage, opinion: opinion };
}

function calculateAllIndicatorsForTicker(ticker) {
    const data = comparisonData[ticker];
    if (!data || !data.ohlcv || data.ohlcv.length === 0) return null;
    
    const closes = data.ohlcv.map(d => d.close);
    const highs = data.ohlcv.map(d => d.high);
    const lows = data.ohlcv.map(d => d.low);
    
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const sma100 = calculateSMA(closes, 100);
    const rsi20 = calculateRSI(closes, 20);
    const stoch = calculateStochastic(highs, lows, closes, 20);
    const weightedAlpha = calculateWeightedAlpha(data.ohlcv);
    const opinion = calculateOpinion(closes, highs, lows, sma20, sma50, sma100, rsi20, stoch.k, stoch.d);
    
    return {
        sma20,
        sma50,
        sma100,
        rsi20,
        stochK: stoch.k,
        stochD: stoch.d,
        weightedAlpha,
        opinionScore: opinion.score,
        opinionText: opinion.opinion
    };
}

function populateFinancialsTable(headersElId, bodyElId, finData, currency, ticker) {
    const headersEl = document.getElementById(headersElId);
    const bodyEl = document.getElementById(bodyElId);
    if (!headersEl || !bodyEl) return;

    if (!finData || !finData.periods || finData.periods.length === 0) {
        headersEl.innerHTML = '<th>Metric</th><th>No Data</th>';
        bodyEl.innerHTML = '<tr><td colspan="2" style="text-align: center; color: var(--text-secondary);">No financial statements found.</td></tr>';
        return;
    }

    const periods = finData.periods;
    headersEl.innerHTML = '<th>Metric</th>' + periods.map(p => `<th>${p}</th>`).join('');

    const metricsList = [
        { label: 'Revenue', values: finData.revenue },
        { label: 'Gross Profit', values: finData.gross_profit },
        { label: 'Operating Income', values: finData.operating_income },
        { label: 'Net Income', values: finData.net_income }
    ];

    bodyEl.innerHTML = metricsList.map(m => {
        const valCols = m.values.map(val => {
            const formatted = formatLargePrice(val, currency, ticker);
            return `<td style="font-family: monospace; text-align: right;">${formatted}</td>`;
        }).join('');
        return `
            <tr>
                <td style="font-weight: 600; color: var(--text-primary);">${m.label}</td>
                ${valCols}
            </tr>
        `;
    }).join('');
}

function initStockSearch() {
    const searchInput = document.getElementById('stock-search-input');
    const searchDropdown = document.getElementById('stock-search-autocomplete');
    const compareInput = document.getElementById('comparison-add-input');
    const compareDropdown = document.getElementById('comparison-autocomplete');
    const summaryToggle = document.getElementById('search-summary-toggle');
    const summaryEl = document.getElementById('search-business-summary');
    
    if (searchInput && searchDropdown) {
        setupAutocomplete(searchInput, searchDropdown, (symbol) => {
            selectSearchedTicker(symbol);
        });
    }
    
    if (compareInput && compareDropdown) {
        setupAutocomplete(compareInput, compareDropdown, (symbol) => {
            addComparisonTicker(symbol);
        });
        compareInput.placeholder = `Add ticker (0/5) to compare (e.g. MSFT)...`;
    }
    
    // Period Selector clicks
    const periodButtons = document.querySelectorAll('#search-period-selector .period-btn');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (!currentSearchTicker) return;
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSearchPeriod = btn.dataset.period;
            loadSearchData(currentSearchTicker, currentSearchPeriod);
        });
    });
    
    // Summary Toggle
    if (summaryToggle && summaryEl) {
        summaryToggle.addEventListener('click', () => {
            if (summaryEl.style.display === '-webkit-box') {
                summaryEl.style.display = 'block';
                summaryEl.style.webkitLineClamp = '';
                summaryToggle.textContent = 'Show Less';
            } else {
                summaryEl.style.display = '-webkit-box';
                summaryEl.style.webkitLineClamp = '3';
                summaryToggle.textContent = 'Show More';
            }
        });
    }
    
    // Track button click
    const trackBtn = document.getElementById('search-track-btn');
    if (trackBtn) {
        trackBtn.addEventListener('click', async () => {
            if (!currentSearchTicker) return;
            
            try {
                const activeTickers = await (await fetch('/api/v1/tickers')).json();
                if (activeTickers.length >= 30) {
                    showToast('Watchlist limit of 30 tickers reached!', 'negative');
                    return;
                }
                
                trackBtn.disabled = true;
                trackBtn.textContent = 'Tracking...';
                
                const res = await fetch('/api/v1/tickers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ticker: currentSearchTicker })
                });
                
                if (res.ok) {
                    showToast(`Successfully tracking ${currentSearchTicker}`);
                    await fetchMarketAndInsights(); // Updates main dashboard grid
                    await updateTrackStatus(currentSearchTicker);
                } else {
                    const data = await res.json();
                    showToast(data.detail || `Failed to track ${currentSearchTicker}`, 'negative');
                    trackBtn.disabled = false;
                    trackBtn.textContent = 'Track Ticker';
                }
            } catch (err) {
                console.error('Failed to track ticker:', err);
                showToast('Network error', 'negative');
                trackBtn.disabled = false;
                trackBtn.textContent = 'Track Ticker';
            }
        });
    }
}

function setupAutocomplete(inputEl, dropdownEl, onSelect) {
    const handleSearch = debounce(async () => {
        const val = inputEl.value.trim();
        if (!val || val.length < 1) {
            dropdownEl.innerHTML = '';
            dropdownEl.classList.remove('active');
            return;
        }
        
        try {
            const res = await fetch(`/api/v1/search?q=${encodeURIComponent(val)}`);
            if (!res.ok) return;
            const items = await res.json();
            
            dropdownEl.innerHTML = '';
            
            if (items.length > 0) {
                dropdownEl.classList.add('active');
                items.forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'autocomplete-item';
                    li.dataset.symbol = item.symbol;
                    li.innerHTML = `
                        <span class="autocomplete-exchange">${formatExchange(item.exchange) || '🇺🇸 NYSE'}</span>
                        <span class="autocomplete-symbol">${item.symbol}</span>
                        <span class="autocomplete-name">${item.name || ''}</span>
                    `;
                    li.addEventListener('click', () => {
                        inputEl.value = item.symbol;
                        dropdownEl.innerHTML = '';
                        dropdownEl.classList.remove('active');
                        onSelect(item.symbol);
                    });
                    dropdownEl.appendChild(li);
                });
            } else {
                dropdownEl.classList.remove('active');
            }
        } catch (err) {
            console.error('Autocomplete fetch error:', err);
        }
    }, 250);
    
    inputEl.addEventListener('input', handleSearch);
    
    document.addEventListener('click', (e) => {
        if (e.target !== inputEl && e.target !== dropdownEl) {
            dropdownEl.innerHTML = '';
            dropdownEl.classList.remove('active');
        }
    });
}

async function selectSearchedTicker(symbol) {
    if (!symbol) return;
    currentSearchTicker = symbol.toUpperCase().trim();
    
    // Reset toggle
    const summaryEl = document.getElementById('search-business-summary');
    const summaryToggle = document.getElementById('search-summary-toggle');
    if (summaryEl) {
        summaryEl.style.display = '-webkit-box';
        summaryEl.style.webkitLineClamp = '3';
        if (summaryToggle) summaryToggle.textContent = 'Show More';
    }
    
    await Promise.all([
        loadSearchData(currentSearchTicker, currentSearchPeriod),
        updateTrackStatus(currentSearchTicker)
    ]);
}

async function loadSearchData(ticker, period) {
    const loadingEl = document.getElementById('search-chart-loading');
    if (loadingEl) loadingEl.style.display = 'flex';
    
    try {
        const [histRes, fundRes] = await Promise.all([
            fetch(`/api/v1/market/history/${ticker}?period=${period}`),
            fetch(`/api/v1/market/fundamentals/${ticker}`)
        ]);
        
        if (!histRes.ok) throw new Error('Failed to load history');
        const data = await histRes.json();
        
        let fundData = null;
        if (fundRes.ok) {
            fundData = await fundRes.json();
        }
        
        // Show panel, hide placeholder
        const placeholderPanel = document.getElementById('search-placeholder-panel');
        const detailPanel = document.getElementById('search-detail-panel');
        if (placeholderPanel) placeholderPanel.style.display = 'none';
        if (detailPanel) detailPanel.style.display = 'block';
        
        const info = data.info || {};
        const companyNameEl = document.getElementById('search-company-name');
        const symbolEl = document.getElementById('search-ticker-symbol');
        const exchangeEl = document.getElementById('search-exchange-sector');
        
        if (companyNameEl) companyNameEl.textContent = info.name || ticker;
        if (symbolEl) symbolEl.textContent = ticker;
        
        const sectorText = (info.sector || info.industry) ? `${info.sector || ''} ${info.industry ? '· ' + info.industry : ''}` : 'Index / Commodity';
        if (exchangeEl) {
            const formatted = formatExchange(info.exchange);
            exchangeEl.textContent = formatted ? `${formatted} · ${sectorText}` : sectorText;
        }
        
        // Current Price
        const priceEl = document.getElementById('search-current-price');
        if (priceEl) {
            priceEl.textContent = formatPrice(info.current_price, info.currency || 'USD', false, ticker);
        }
        
        // 1-Day change badge
        const changeEl = document.getElementById('search-price-change');
        if (changeEl) {
            const changePct = info.previous_close ? ((info.current_price - info.previous_close) / info.previous_close) * 100 : 0;
            const isPos = changePct >= 0;
            changeEl.className = `discover-change-badge ${isPos ? 'pos' : 'neg'}`;
            changeEl.textContent = `${isPos ? '+' : ''}${changePct.toFixed(2)}%`;
        }
        
        // Key Metrics
        const mcEl = document.getElementById('search-metric-market-cap');
        const peEl = document.getElementById('search-metric-pe');
        const epsEl = document.getElementById('search-metric-eps');
        const yieldEl = document.getElementById('search-metric-yield');
        const betaEl = document.getElementById('search-metric-beta');
        const rangeEl = document.getElementById('search-metric-52w');
        
        if (mcEl) mcEl.textContent = info.market_cap ? formatLargePrice(info.market_cap, info.currency || 'USD', ticker) : '—';
        if (peEl) peEl.textContent = (info.pe_ratio !== null && info.pe_ratio !== undefined) ? info.pe_ratio.toFixed(2) : '—';
        if (epsEl) epsEl.textContent = (info.eps !== null && info.eps !== undefined) ? info.eps.toFixed(2) : '—';
        if (yieldEl) yieldEl.textContent = info.dividend_yield ? `${(info.dividend_yield * 100).toFixed(2)}%` : '—';
        if (betaEl) betaEl.textContent = (info.beta !== null && info.beta !== undefined) ? info.beta.toFixed(2) : '—';
        
        if (rangeEl) {
            if (info['52w_high'] && info['52w_low']) {
                const low = formatPrice(info['52w_low'], info.currency || 'USD', false, ticker);
                const high = formatPrice(info['52w_high'], info.currency || 'USD', false, ticker);
                rangeEl.textContent = `${low} - ${high}`;
            } else {
                rangeEl.textContent = '—';
            }
        }
        
        // Summary
        const businessSummaryEl = document.getElementById('search-business-summary');
        if (businessSummaryEl) {
            businessSummaryEl.textContent = info.business_summary || 'No profile description available.';
        }
        
        // Populate financials tables
        if (fundData) {
            populateFinancialsTable('search-financials-annual-headers', 'search-financials-annual-body', fundData.financials, fundData.currency || info.currency || 'USD', ticker);
            populateFinancialsTable('search-financials-quarterly-headers', 'search-financials-quarterly-body', fundData.quarterly_financials, fundData.currency || info.currency || 'USD', ticker);
        } else {
            populateFinancialsTable('search-financials-annual-headers', 'search-financials-annual-body', null);
            populateFinancialsTable('search-financials-quarterly-headers', 'search-financials-quarterly-body', null);
        }

        // Render News
        const newsListEl = document.getElementById('search-news-list');
        if (newsListEl) {
            if (data.news && data.news.length > 0) {
                newsListEl.innerHTML = data.news.map(art => {
                    const dateStr = art.published ? new Date(art.published).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                    const sourceBadge = art.source ? `<span style="font-size: 0.7rem; background: rgba(255,255,255,0.06); padding: 0.15rem 0.4rem; border-radius: 4px; color: var(--text-secondary);">${art.source}</span>` : '';
                    const dateBadge = dateStr ? `<span style="font-size: 0.7rem; color: var(--text-secondary);">${dateStr}</span>` : '';
                    const meta = (sourceBadge || dateBadge) ? `<div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.25rem;">${sourceBadge} ${dateBadge}</div>` : '';
                    return `
                        <div style="border-bottom: 1px solid rgba(255, 255, 255, 0.04); padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
                            <a href="${art.url}" target="_blank" rel="noopener noreferrer" style="font-size: 0.85rem; font-weight: 500; color: #3b82f6; text-decoration: none; display: block; line-height: 1.4; transition: color 0.2s;">
                                ${art.title}
                            </a>
                            ${meta}
                        </div>
                    `;
                }).join('');
            } else {
                newsListEl.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem; font-style: italic;">No recent news articles found.</p>';
            }
        }

        // Render Chart
        renderSearchChart(data, period);
    } catch (err) {
        console.error('Failed to load search details:', err);
        showToast(`Failed to load data for ${ticker}`, 'negative');
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

function renderSearchChart(data, period) {
    if (currentSearchChart) {
        currentSearchChart.destroy();
        currentSearchChart = null;
    }
    
    const canvas = document.getElementById('searchChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const closes = data.ohlcv.map(d => d.close);
    const labels = data.ohlcv.map(d => {
        const dt = new Date(d.time);
        return period === '1d' ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : dt.toLocaleDateString();
    });
    
    const firstClose = closes[0];
    const lastClose = closes[closes.length - 1];
    const chartChangePct = firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0;
    const isUp = chartChangePct >= 0;
    const trendColor = isUp ? '#10b981' : '#f43f5e';
    const rgb = isUp ? '16, 185, 129' : '244, 63, 94';
    
    const changeEl = document.getElementById('search-chart-change');
    if (changeEl) {
        changeEl.style.color = trendColor;
        changeEl.textContent = `${isUp ? '+' : ''}${chartChangePct.toFixed(2)}%`;
    }
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, `rgba(${rgb}, 0.25)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    
    currentSearchChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: data.ticker,
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
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.9)',
                    titleColor: '#94a3b8',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${formatPrice(ctx.parsed.y, data.info ? data.info.currency : 'USD', false, data.ticker)}`
                    }
                }
            },
            scales: {
                x: { ticks: { color: '#94a3b8', maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
                y: {
                    beginAtZero: false,
                    ticks: {
                        color: '#94a3b8',
                        callback: v => {
                            const isIndex = data.ticker && (data.ticker.startsWith('^') || DISCOVER_INDEX_SYMBOLS.includes(data.ticker));
                            if (isIndex) {
                                return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
                            }
                            const tc = (data.info && data.info.currency) ? (data.info.currency === 'GBp' ? 'GBP' : data.info.currency) : 'USD';
                            const tickerRate = EXCHANGE_RATES[tc] ? EXCHANGE_RATES[tc].rate : 1.0;
                            const usdValue = v / tickerRate;
                            const targetCurr = currentCurrency === 'DEFAULT' ? tc : currentCurrency;
                            const { symbol, rate } = EXCHANGE_RATES[targetCurr] || EXCHANGE_RATES['USD'];
                            return `${symbol}${(usdValue * rate).toFixed(0)}`;
                        }
                    },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                }
            }
        }
    });
}

async function updateTrackStatus(ticker) {
    try {
        const res = await fetch('/api/v1/tickers');
        if (!res.ok) return;
        const activeTickers = await res.json();
        
        const count = activeTickers.length;
        const statusEl = document.getElementById('search-track-status');
        if (statusEl) {
            statusEl.textContent = `Current Watchlist: ${count}/30.`;
        }
        
        const btn = document.getElementById('search-track-btn');
        if (btn) {
            if (activeTickers.includes(ticker)) {
                btn.disabled = true;
                btn.textContent = '✓ Tracked';
                btn.className = 'glass-btn';
            } else {
                btn.disabled = false;
                btn.textContent = 'Track Ticker';
                btn.className = 'glass-btn primary';
            }
        }
    } catch (e) {
        console.error('Failed to update track status:', e);
    }
}

async function addComparisonTicker(ticker) {
    ticker = ticker.toUpperCase().trim();
    if (comparisonTickers.includes(ticker)) {
        showToast(`${ticker} is already added to comparison.`, 'warning');
        return;
    }
    if (comparisonTickers.length >= 5) {
        showToast('Maximum 5 tickers can be compared.', 'warning');
        return;
    }
    
    const addInput = document.getElementById('comparison-add-input');
    if (addInput) {
        addInput.disabled = true;
        addInput.placeholder = `Loading ${ticker}...`;
    }
    
    try {
        const res = await fetch(`/api/v1/market/history/${ticker}?period=1y`);
        if (!res.ok) throw new Error('Ticker not found');
        const data = await res.json();
        
        comparisonTickers.push(ticker);
        comparisonData[ticker] = data;
        comparisonData[ticker].indicators = calculateAllIndicatorsForTicker(ticker);
        
        if (addInput) {
            addInput.value = '';
            addInput.placeholder = `Add ticker (${comparisonTickers.length}/5) to compare (e.g. MSFT)...`;
        }
        
        updateComparisonUI();
    } catch (err) {
        console.error('Failed to load comparison ticker:', err);
        showToast(`Failed to load data for ${ticker}`, 'negative');
        if (addInput) {
            addInput.placeholder = `Add ticker (${comparisonTickers.length}/5) to compare (e.g. MSFT)...`;
        }
    } finally {
        if (addInput) {
            addInput.disabled = false;
        }
    }
}

window.removeComparisonTicker = function(ticker) {
    ticker = ticker.toUpperCase().trim();
    comparisonTickers = comparisonTickers.filter(t => t !== ticker);
    delete comparisonData[ticker];
    updateComparisonUI();
    const addInput = document.getElementById('comparison-add-input');
    if (addInput) {
        addInput.placeholder = `Add ticker (${comparisonTickers.length}/5) to compare (e.g. MSFT)...`;
    }
};

function calculateRowWinners() {
    const winners = {};
    if (comparisonTickers.length === 0) return winners;
    
    // Row 1: Change % (highest is best)
    let bestChange = -Infinity;
    let changeWinner = null;
    comparisonTickers.forEach(t => {
        const info = comparisonData[t].info || {};
        const changePct = info.previous_close ? ((info.current_price - info.previous_close) / info.previous_close) * 100 : 0;
        if (changePct > bestChange) {
            bestChange = changePct;
            changeWinner = t;
        }
    });
    winners['change'] = changeWinner;
    
    // Row 2: Market Cap (highest is best)
    let bestCap = -Infinity;
    let capWinner = null;
    comparisonTickers.forEach(t => {
        const info = comparisonData[t].info || {};
        const cap = info.market_cap || 0;
        if (cap > bestCap && cap > 0) {
            bestCap = cap;
            capWinner = t;
        }
    });
    winners['market_cap'] = capWinner;
    
    // Row 3: P/E (lowest positive is best)
    let bestPe = Infinity;
    let peWinner = null;
    comparisonTickers.forEach(t => {
        const info = comparisonData[t].info || {};
        const pe = info.pe_ratio;
        if (pe !== null && pe !== undefined && pe > 0) {
            if (pe < bestPe) {
                bestPe = pe;
                peWinner = t;
            }
        }
    });
    winners['pe'] = peWinner;
    
    // Row 4: EPS (highest is best)
    let bestEps = -Infinity;
    let epsWinner = null;
    comparisonTickers.forEach(t => {
        const info = comparisonData[t].info || {};
        const eps = info.eps;
        if (eps !== null && eps !== undefined) {
            if (eps > bestEps) {
                bestEps = eps;
                epsWinner = t;
            }
        }
    });
    winners['eps'] = epsWinner;
    
    // Row 5: Yield (highest is best)
    let bestYield = -Infinity;
    let yieldWinner = null;
    comparisonTickers.forEach(t => {
        const info = comparisonData[t].info || {};
        const y = info.dividend_yield || 0;
        if (y > bestYield && y > 0) {
            bestYield = y;
            yieldWinner = t;
        }
    });
    winners['yield'] = yieldWinner;
    
    // Row 6: Beta (lowest raw beta is best)
    let bestBeta = Infinity;
    let betaWinner = null;
    comparisonTickers.forEach(t => {
        const info = comparisonData[t].info || {};
        const b = info.beta;
        if (b !== null && b !== undefined) {
            if (b < bestBeta) {
                bestBeta = b;
                betaWinner = t;
            }
        }
    });
    winners['beta'] = betaWinner;

    // Row 7: Weighted Alpha (highest is best)
    let bestAlpha = -Infinity;
    let alphaWinner = null;
    comparisonTickers.forEach(t => {
        const ind = comparisonData[t].indicators || {};
        const alpha = ind.weightedAlpha || 0;
        if (alpha > bestAlpha) {
            bestAlpha = alpha;
            alphaWinner = t;
        }
    });
    winners['weighted_alpha'] = alphaWinner;

    // Row 8: Opinion Score (highest is best)
    let bestOpinion = -Infinity;
    let opinionWinner = null;
    comparisonTickers.forEach(t => {
        const ind = comparisonData[t].indicators || {};
        const op = ind.opinionScore || 0;
        if (op > bestOpinion) {
            bestOpinion = op;
            opinionWinner = t;
        }
    });
    winners['opinion'] = opinionWinner;
    
    return winners;
}

function renderVerdictCard() {
    const verdictCard = document.getElementById('comparison-verdict-card');
    if (!verdictCard) return;
    
    const scores = {};
    comparisonTickers.forEach(t => { scores[t] = 0; });
    
    const infoMap = {};
    comparisonTickers.forEach(t => { infoMap[t] = comparisonData[t].info || {}; });
    
    const awardPoints = (winnerList, points) => {
        if (winnerList && winnerList.length > 0) {
            winnerList.forEach(t => {
                scores[t] = (scores[t] || 0) + points;
            });
        }
    };
    
    // PE winner (lowest positive PE) - 25 points
    let minPe = Infinity;
    let peWinners = [];
    comparisonTickers.forEach(t => {
        const pe = infoMap[t].pe_ratio;
        if (pe !== null && pe !== undefined && pe > 0) {
            if (pe < minPe) {
                minPe = pe;
                peWinners = [t];
            } else if (pe === minPe) {
                peWinners.push(t);
            }
        }
    });
    awardPoints(peWinners, 25);
    
    // EPS winner (highest EPS) - 25 points
    let maxEps = -Infinity;
    let epsWinners = [];
    comparisonTickers.forEach(t => {
        const eps = infoMap[t].eps;
        if (eps !== null && eps !== undefined) {
            if (eps > maxEps) {
                maxEps = eps;
                epsWinners = [t];
            } else if (eps === maxEps) {
                epsWinners.push(t);
            }
        }
    });
    awardPoints(epsWinners, 25);
    
    // Consensus (analyst recommendation rating) - 20 points
    const recScores = {
        'strong_buy': 5, 'strongBuy': 5,
        'buy': 4,
        'hold': 3,
        'sell': 2,
        'underperform': 1,
        'strong_sell': 1, 'strongSell': 1
    };
    let maxRec = -1;
    let recWinners = [];
    comparisonTickers.forEach(t => {
        const key = infoMap[t].recommendation || 'hold';
        const rating = recScores[key] || 3;
        if (rating > maxRec) {
            maxRec = rating;
            recWinners = [t];
        } else if (rating === maxRec) {
            recWinners.push(t);
        }
    });
    awardPoints(recWinners, 20);
    
    // Volatility (Beta, lower is better/safer) - 15 points
    let minBeta = Infinity;
    let betaWinners = [];
    comparisonTickers.forEach(t => {
        const beta = infoMap[t].beta;
        if (beta !== null && beta !== undefined) {
            if (beta < minBeta) {
                minBeta = beta;
                betaWinners = [t];
            } else if (beta === minBeta) {
                betaWinners.push(t);
            }
        }
    });
    awardPoints(betaWinners, 15);
    
    // Momentum (1-day change, highest is best) - 15 points
    let maxChange = -Infinity;
    let changeWinners = [];
    comparisonTickers.forEach(t => {
        const info = infoMap[t];
        const changePct = info.previous_close ? ((info.current_price - info.previous_close) / info.previous_close) * 100 : 0;
        if (changePct > maxChange) {
            maxChange = changePct;
            changeWinners = [t];
        } else if (changePct === maxChange) {
            changeWinners.push(t);
        }
    });
    awardPoints(changeWinners, 15);

    // Long-Term Momentum (Weighted Alpha, highest is best) - 15 points
    let maxAlpha = -Infinity;
    let alphaWinners = [];
    comparisonTickers.forEach(t => {
        const ind = comparisonData[t].indicators || {};
        const alpha = ind.weightedAlpha || 0;
        if (alpha > maxAlpha) {
            maxAlpha = alpha;
            alphaWinners = [t];
        } else if (alpha === maxAlpha) {
            alphaWinners.push(t);
        }
    });
    awardPoints(alphaWinners, 15);

    // Technical Indicators Opinion (highest is best) - 15 points
    let maxOpinion = -Infinity;
    let opinionWinners = [];
    comparisonTickers.forEach(t => {
        const ind = comparisonData[t].indicators || {};
        const op = ind.opinionScore || 0;
        if (op > maxOpinion) {
            maxOpinion = op;
            opinionWinners = [t];
        } else if (op === maxOpinion) {
            opinionWinners.push(t);
        }
    });
    awardPoints(opinionWinners, 15);
    
    // Determine winner
    let winner = null;
    let maxScore = -1;
    let tie = false;
    let tieWinners = [];
    
    comparisonTickers.forEach(t => {
        const s = scores[t];
        if (s > maxScore) {
            maxScore = s;
            winner = t;
            tie = false;
            tieWinners = [t];
        } else if (s === maxScore) {
            tie = true;
            tieWinners.push(t);
        }
    });
    
    let explanation = '';
    if (tie) {
        explanation = `The comparison results in a tie between <strong>${tieWinners.join(' and ')}</strong> with a matching score of <strong>${maxScore} points</strong>. `;
    } else {
        explanation = `Based on our financial weighted scoring algorithm, <strong>${winner} (${infoMap[winner].name || winner})</strong> is the winner with a total score of <strong>${maxScore} points</strong>! `;
    }
    
    const reasons = [];
    if (peWinners.length > 0) {
        reasons.push(`<strong>Valuation (25% weight):</strong> ${peWinners.join(', ')} won with the lowest positive P/E ratio (${minPe.toFixed(2)}).`);
    }
    if (epsWinners.length > 0) {
        reasons.push(`<strong>Profitability (25% weight):</strong> ${epsWinners.join(', ')} won with the highest EPS (${maxEps.toFixed(2)}).`);
    }
    if (recWinners.length > 0) {
        reasons.push(`<strong>Consensus (20% weight):</strong> ${recWinners.join(', ')} won with the strongest analyst recommendation rating.`);
    }
    if (betaWinners.length > 0) {
        reasons.push(`<strong>Volatility/Risk (15% weight):</strong> ${betaWinners.join(', ')} won with the lowest Beta (${minBeta.toFixed(2)}), offering superior downside protection.`);
    }
    if (changeWinners.length > 0) {
        reasons.push(`<strong>Short-Term Momentum (15% weight):</strong> ${changeWinners.join(', ')} won with the highest 1-day change (${maxChange.toFixed(2)}%).`);
    }
    if (alphaWinners.length > 0) {
        reasons.push(`<strong>Long-Term Momentum (15% weight):</strong> ${alphaWinners.join(', ')} won with the highest Weighted Alpha (${maxAlpha.toFixed(2)}%).`);
    }
    if (opinionWinners.length > 0) {
        reasons.push(`<strong>Technical Indicators Opinion (15% weight):</strong> ${opinionWinners.join(', ')} won with the strongest technical indicators matching opinion (${maxOpinion}% Buy rules).`);
    }
    
    explanation += 'Here is the category breakdown:<br><br>' + reasons.map(r => `• ${r}`).join('<br>');
    
    if (tie) {
        verdictCard.className = 'verdict-container glass';
    } else {
        verdictCard.className = 'verdict-container gold glass';
    }
    
    verdictCard.innerHTML = `
        <div class="verdict-header">
            <span class="verdict-badge">${tie ? 'Tie' : 'Winner'}</span>
            <h3 class="verdict-title">${tie ? `Tie: ${tieWinners.join(' vs ')}` : `Winner Verdict: ${winner}`}</h3>
        </div>
        <p class="verdict-summary-text">${explanation}</p>
        <div class="verdict-breakdown-grid">
            ${comparisonTickers.map(t => `
                <div class="verdict-score-card glass">
                    <span class="verdict-score-label">${t} Score</span>
                    <span class="verdict-score-value">${scores[t]} pts</span>
                    ${(!tie && t === winner) ? '<span class="verdict-score-winner">👑 Winner</span>' : ''}
                    ${(tie && tieWinners.includes(t)) ? '<span class="verdict-score-winner" style="color: var(--accent);">⚖️ Tied</span>' : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function updateComparisonUI() {
    const pillsContainer = document.getElementById('comparison-pills-container');
    const tableWrapper = document.getElementById('comparison-table-wrapper');
    const verdictCard = document.getElementById('comparison-verdict-card');
    
    if (comparisonTickers.length === 0) {
        pillsContainer.innerHTML = '<span style="font-size: 0.85rem; color: var(--text-secondary); font-style: italic;">No tickers added to comparison yet. Add tickers above.</span>';
        tableWrapper.style.display = 'none';
        verdictCard.style.display = 'none';
        return;
    }
    
    pillsContainer.innerHTML = comparisonTickers.map(t => `
        <span class="comparison-pill">
            ${t}
            <button class="comparison-pill-remove" onclick="removeComparisonTicker('${t}')">&times;</button>
        </span>
    `).join('');
    
    tableWrapper.style.display = 'block';
    
    const headersTr = document.getElementById('comparison-table-headers');
    headersTr.innerHTML = '<th>Metric</th>' + comparisonTickers.map(t => `<th>${t}</th>`).join('');
    
    const categories = [
        {
            name: 'Key Stats',
            metrics: [
                { key: 'name', label: 'Company Name', type: 'text' },
                { key: 'sector', label: 'Sector / Industry', type: 'text' },
                { key: 'price', label: 'Current Price', type: 'price' },
                { key: 'market_cap', label: 'Market Capitalisation', type: 'market_cap' },
                { key: 'pe', label: 'Trailing P/E (TTM)', type: 'pe' },
                { key: 'eps', label: 'EPS (TTM)', type: 'eps' },
                { key: 'yield', label: 'Dividend Yield', type: 'yield' }
            ]
        },
        {
            name: 'Performance',
            metrics: [
                { key: 'change', label: '1-Day Change', type: 'change' },
                { key: 'range52w', label: '52-Week Range', type: 'text' },
                { key: 'recommendation', label: 'Analyst Recommendation', type: 'text' }
            ]
        },
        {
            name: 'Technicals',
            metrics: [
                { key: 'sma20', label: '20-Day SMA', type: 'sma20' },
                { key: 'stochK', label: '20-Day Stochastic %K', type: 'stochK' },
                { key: 'rsi20', label: '20-Day RSI', type: 'rsi20' },
                { key: 'weighted_alpha', label: 'Weighted Alpha', type: 'weighted_alpha' },
                { key: 'opinion', label: 'Technical Opinion', type: 'opinion' },
                { key: 'beta', label: 'Beta (Volatility)', type: 'beta' }
            ]
        }
    ];
    
    const winners = calculateRowWinners();
    const tbody = document.getElementById('comparison-table-body');
    tbody.innerHTML = '';
    
    categories.forEach(category => {
        // Render category header row
        const catTr = document.createElement('tr');
        catTr.className = 'comparison-category-row';
        const catTd = document.createElement('td');
        catTd.colSpan = comparisonTickers.length + 1;
        catTd.textContent = category.name;
        catTr.appendChild(catTd);
        tbody.appendChild(catTr);
        
        category.metrics.forEach(metric => {
            const tr = document.createElement('tr');
            
            const tdLabel = document.createElement('td');
            tdLabel.textContent = metric.label;
            tr.appendChild(tdLabel);
            
            comparisonTickers.forEach(t => {
                const td = document.createElement('td');
                const data = comparisonData[t];
                const info = data.info || {};
                const ind = data.indicators || {};
                
                let val = '—';
                let className = '';
                
                if (winners[metric.key] === t) {
                    className = 'comparison-winner-cell';
                }
                
                switch (metric.type) {
                    case 'text':
                        if (metric.key === 'name') val = info.name || t;
                        else if (metric.key === 'sector') val = (info.sector || info.industry) ? `${info.sector || ''} ${info.industry ? '/ ' + info.industry : ''}` : 'Index';
                        else if (metric.key === 'range52w') {
                            if (info['52w_high'] && info['52w_low']) {
                                const low = formatPrice(info['52w_low'], info.currency || 'USD', false, t);
                                const high = formatPrice(info['52w_high'], info.currency || 'USD', false, t);
                                val = `${low} - ${high}`;
                            }
                        } else if (metric.key === 'recommendation') val = info.recommendation ? info.recommendation.replace('_', ' ').toUpperCase() : '—';
                        break;
                        
                    case 'price':
                        val = formatPrice(info.current_price, info.currency || 'USD', false, t);
                        break;
                        
                    case 'change':
                        const changePct = info.previous_close ? ((info.current_price - info.previous_close) / info.previous_close) * 100 : 0;
                        const isPos = changePct >= 0;
                        val = `<span style="color: ${isPos ? 'var(--positive)' : 'var(--negative)'}; font-weight:700;">${isPos ? '+' : ''}${changePct.toFixed(2)}%</span>`;
                        break;
                        
                    case 'market_cap':
                        val = info.market_cap ? formatLargePrice(info.market_cap, info.currency || 'USD', t) : '—';
                        break;
                        
                    case 'pe':
                        val = (info.pe_ratio !== null && info.pe_ratio !== undefined) ? info.pe_ratio.toFixed(2) : '—';
                        break;
                        
                    case 'eps':
                        val = (info.eps !== null && info.eps !== undefined) ? info.eps.toFixed(2) : '—';
                        break;
                        
                    case 'yield':
                        val = info.dividend_yield ? `${(info.dividend_yield * 100).toFixed(2)}%` : '—';
                        break;
                        
                    case 'beta':
                        val = (info.beta !== null && info.beta !== undefined) ? info.beta.toFixed(2) : '—';
                        break;

                    case 'sma20':
                        val = ind.sma20 ? formatPrice(ind.sma20, info.currency || 'USD', false, t) : '—';
                        break;

                    case 'stochK':
                        val = ind.stochK !== undefined && ind.stochK !== null ? `${ind.stochK.toFixed(2)}%` : '—';
                        break;

                    case 'rsi20':
                        val = ind.rsi20 !== undefined && ind.rsi20 !== null ? ind.rsi20.toFixed(2) : '—';
                        break;

                    case 'weighted_alpha':
                        const alphaVal = ind.weightedAlpha || 0;
                        const alphaPos = alphaVal >= 0;
                        val = `<span style="color: ${alphaPos ? 'var(--positive)' : 'var(--negative)'}; font-weight:600;">${alphaPos ? '+' : ''}${alphaVal.toFixed(2)}%</span>`;
                        break;

                    case 'opinion':
                        if (ind.opinionText) {
                            const opColor = ind.opinionText.includes('Buy') ? 'var(--positive)' : (ind.opinionText.includes('Sell') ? 'var(--negative)' : 'var(--text-secondary)');
                            val = `<span style="color: ${opColor}; font-weight:700;">${ind.opinionScore}% ${ind.opinionText}</span>`;
                        } else {
                            val = '—';
                        }
                        break;
                }
                
                td.innerHTML = val;
                if (className) td.className = className;
                tr.appendChild(td);
            });
            
            tbody.appendChild(tr);
        });
    });
    
    if (comparisonTickers.length >= 2) {
        verdictCard.style.display = 'block';
        renderVerdictCard();
    } else {
        verdictCard.style.display = 'none';
    }
}

