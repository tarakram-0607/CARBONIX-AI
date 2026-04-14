/**
 * engine.js — Carbonix AI Intelligence Engine
 * Pure logic module. No DOM access. Exported and consumed by calculator.js and chatbot.js.
 *
 * Responsibilities:
 *  1. Optimization Engine  — brute-force best reduction strategy combos
 *  2. Personalization      — adapt suggestion priority from behavioral history
 *  3. Advanced Prediction  — trend-aware next-month forecast
 *  4. Behavioral Profiling — derive user profile from history records
 */

// ---------------------------------------------------------------------------
// 1. CONSTANTS & EMISSION FACTORS
// ---------------------------------------------------------------------------
export const EMISSION_FACTORS = {
    electricity: 0.82, // kg CO2 per kWh
    travel: 0.21,       // kg CO2 per km
    food: {
        vegetarian: 20,
        mixed: 40,
        meat: 70
    }
};

// Average monthly baseline (used for goal & comparison)
export const GLOBAL_BASELINE = 340; // kg CO2/month

// Reduction strategy step size (10% increments 0–50%)
const STRATEGY_STEPS = [0, 10, 20, 30, 40, 50];

// Feasibility cost: higher reduction = harder to sustain
const FEASIBILITY_PENALTY = { 0: 0, 10: 5, 20: 15, 30: 30, 40: 50, 50: 75 };

// ---------------------------------------------------------------------------
// 2. OPTIMIZATION ENGINE
// ---------------------------------------------------------------------------
/**
 * Tests all combos of [elec%, travel%, food%] reductions (6×6×6 = 216 combos)
 * and returns the top `topN` strategies sorted by net benefit score.
 *
 * @param {Object} current - { electricity, travel, food, total } in kg CO2
 * @param {Object} userProfile - behavioral profile (weights, history flags)
 * @param {number} topN - how many top strategies to return
 * @returns {Array} top strategies [ { elec, travel, food, savedKg, newTotal, score, label } ]
 */
export function optimizationEngine(current, userProfile = {}, topN = 3) {
    if (!current || current.total === 0) return [];

    const strategies = [];
    const weights = personalizeWeight(userProfile);

    for (const e of STRATEGY_STEPS) {
        for (const t of STRATEGY_STEPS) {
            for (const f of STRATEGY_STEPS) {
                const newElec   = current.electricity * (1 - e / 100);
                const newTravel = current.travel       * (1 - t / 100);
                const newFood   = current.food         * (1 - f / 100);
                const newTotal  = newElec + newTravel + newFood;
                const savedKg   = current.total - newTotal;

                // Avoid the trivial "reduce nothing" strategy
                if (e === 0 && t === 0 && f === 0) continue;

                // Feasibility score (lower penalty = easier to achieve)
                const feasibility = 100
                    - FEASIBILITY_PENALTY[e]
                    - FEASIBILITY_PENALTY[t]
                    - FEASIBILITY_PENALTY[f];

                // Savings score: weighted by which category the user is highest in
                const savingsScore = (
                    (current.electricity * e / 100) * weights.electricity +
                    (current.travel       * t / 100) * weights.travel +
                    (current.food         * f / 100) * weights.food
                );

                // Net benefit = savings leverage + feasibility bonus
                const score = savingsScore * 0.7 + feasibility * 0.3;

                strategies.push({
                    elec: e, travel: t, food: f,
                    newTotal: parseFloat(newTotal.toFixed(1)),
                    savedKg:  parseFloat(savedKg.toFixed(1)),
                    feasibility,
                    score:    parseFloat(score.toFixed(2)),
                    label:    buildStrategyLabel(e, t, f),
                    tips:     buildStrategyTips(e, t, f)
                });
            }
        }
    }

    // Sort descending by score, deduplicate near-identical results by rounding
    strategies.sort((a, b) => b.score - a.score);

    // Return top N distinct strategies
    const seen = new Set();
    const top = [];
    for (const s of strategies) {
        const key = `${s.elec}-${s.travel}-${s.food}`;
        if (!seen.has(key)) {
            seen.add(key);
            top.push(s);
            if (top.length >= topN) break;
        }
    }
    return top;
}

function buildStrategyLabel(e, t, f) {
    const parts = [];
    if (e > 0)  parts.push(`↓${e}% electricity`);
    if (t > 0)  parts.push(`↓${t}% travel`);
    if (f > 0)  parts.push(`↓${f}% food impact`);
    return parts.join(' + ') || 'Baseline';
}

function buildStrategyTips(e, t, f) {
    const tips = {};
    if (e >= 10) tips.electricity = ELECTRICITY_TIPS[Math.min(Math.floor(e / 10) - 1, ELECTRICITY_TIPS.length - 1)];
    if (t >= 10) tips.travel      = TRAVEL_TIPS[Math.min(Math.floor(t / 10) - 1, TRAVEL_TIPS.length - 1)];
    if (f >= 10) tips.food        = FOOD_TIPS[Math.min(Math.floor(f / 10) - 1, FOOD_TIPS.length - 1)];
    return tips;
}

// ---------------------------------------------------------------------------
// 3. PERSONALIZATION WEIGHTS
// ---------------------------------------------------------------------------
/**
 * Returns category weights (0.5–2.0) based on user history patterns.
 * Categories that are consistently high get boosted weight so the optimizer
 * focuses strategies there first.
 *
 * @param {Object} userProfile - { avgElectricity, avgTravel, avgFood, streaks }
 * @returns {{ electricity: number, travel: number, food: number }}
 */
export function personalizeWeight(userProfile = {}) {
    const base = { electricity: 1.0, travel: 1.0, food: 1.0 };
    if (!userProfile || !userProfile.avgByCategory) return base;

    const { avgByCategory, streaks = {} } = userProfile;
    const total = (avgByCategory.electricity || 0) + (avgByCategory.travel || 0) + (avgByCategory.food || 0);
    if (total === 0) return base;

    // Proportional weight: category share of total emissions
    base.electricity = parseFloat(((avgByCategory.electricity || 0) / total * 3).toFixed(2));
    base.travel       = parseFloat(((avgByCategory.travel       || 0) / total * 3).toFixed(2));
    base.food         = parseFloat(((avgByCategory.food         || 0) / total * 3).toFixed(2));

    // Streak bonus: if a category has been high 3+ months, boost weight
    if ((streaks.electricity || 0) >= 3) base.electricity = Math.min(base.electricity * 1.5, 2.0);
    if ((streaks.travel       || 0) >= 3) base.travel       = Math.min(base.travel       * 1.5, 2.0);
    if ((streaks.food         || 0) >= 3) base.food         = Math.min(base.food         * 1.5, 2.0);

    return base;
}

// ---------------------------------------------------------------------------
// 4. BEHAVIORAL PROFILING
// ---------------------------------------------------------------------------
/**
 * Derives a userProfile object from an array of historical Firestore records.
 *
 * @param {Array} historyDocs - array of Firestore doc data objects
 * @returns {Object} userProfile
 */
export function buildUserProfile(historyDocs) {
    if (!historyDocs || historyDocs.length === 0) {
        return {
            avgByCategory: { electricity: 0, travel: 0, food: 0 },
            avgTotal: 0,
            trend: 'stable',
            streaks: { electricity: 0, travel: 0, food: 0 },
            recordCount: 0,
            highestCategory: null
        };
    }

    const n = historyDocs.length;
    const sumElec   = historyDocs.reduce((s, d) => s + (d.electricityUsage || 0), 0);
    const sumTravel = historyDocs.reduce((s, d) => s + (d.travelDistance    || 0), 0);
    const sumFood   = historyDocs.reduce((s, d) => s + (d.foodType          || 0), 0);
    const sumTotal  = historyDocs.reduce((s, d) => s + (d.totalCarbon       || 0), 0);

    const avgElec   = sumElec   / n;
    const avgTravel = sumTravel / n;
    const avgFood   = sumFood   / n;
    const avgTotal  = sumTotal  / n;

    // Trend: compare first half vs second half of history
    const midpoint  = Math.floor(n / 2);
    const firstHalf = historyDocs.slice(midpoint).reduce((s, d) => s + (d.totalCarbon || 0), 0) / Math.max(n - midpoint, 1);
    const lastHalf  = historyDocs.slice(0, midpoint).reduce((s, d) => s + (d.totalCarbon || 0), 0) / Math.max(midpoint, 1);
    const trendDelta = lastHalf - firstHalf;
    const trend = trendDelta > 20 ? 'increasing' : trendDelta < -20 ? 'decreasing' : 'stable';

    // Streak: how many consecutive recent records had this category as highest
    const streaks = { electricity: 0, travel: 0, food: 0 };
    for (const doc of historyDocs) {
        const { electricityUsage = 0, travelDistance = 0, foodType = 0 } = doc;
        const highest = electricityUsage >= travelDistance && electricityUsage >= foodType
            ? 'electricity'
            : travelDistance >= foodType ? 'travel' : 'food';
        streaks[highest]++;
    }

    const highestCategory = avgElec >= avgTravel && avgElec >= avgFood
        ? 'electricity'
        : avgTravel >= avgFood ? 'travel' : 'food';

    return {
        avgByCategory: {
            electricity: parseFloat(avgElec.toFixed(1)),
            travel:       parseFloat(avgTravel.toFixed(1)),
            food:         parseFloat(avgFood.toFixed(1))
        },
        avgTotal:        parseFloat(avgTotal.toFixed(1)),
        trend,
        streaks,
        recordCount:     n,
        highestCategory
    };
}

// ---------------------------------------------------------------------------
// 5. ADVANCED PREDICTION ENGINE
// ---------------------------------------------------------------------------
/**
 * Predicts next month's emissions using a trend-aware weighted average +
 * optional reduction strategy offsets.
 *
 * @param {Object} current - { electricity, travel, food, total }
 * @param {Object} userProfile - behavioral profile
 * @param {Object} reductions - { elec: %, travel: %, food: % } to apply
 * @returns {Object} { predicted, breakdown, trendFactor, label }
 */
export function predictNextMonth(current, userProfile = {}, reductions = { elec: 0, travel: 0, food: 0 }) {
    if (!current || current.total === 0) {
        return { predicted: 0, breakdown: { electricity: 0, travel: 0, food: 0 }, trendFactor: 1.05, label: 'No data' };
    }

    // Trend factor: if emissions are increasing, predict higher; if decreasing, lower
    let trendFactor = 1.05; // default 5% growth
    if (userProfile.trend === 'decreasing') trendFactor = 0.97;
    if (userProfile.trend === 'increasing') trendFactor = 1.10;
    if (userProfile.trend === 'stable')     trendFactor = 1.02;

    const baseElec   = current.electricity * trendFactor * (1 - reductions.elec   / 100);
    const baseTravel = current.travel       * trendFactor * (1 - reductions.travel / 100);
    const baseFood   = current.food         * trendFactor * (1 - reductions.food   / 100);
    const predicted  = parseFloat((baseElec + baseTravel + baseFood).toFixed(1));

    const trendLabel = userProfile.trend === 'increasing' ? '⚠️ Your emissions are trending up'
                     : userProfile.trend === 'decreasing' ? '✅ Your emissions are improving'
                     : '→ Your emissions are stable';

    return {
        predicted,
        breakdown: {
            electricity: parseFloat(baseElec.toFixed(1)),
            travel:       parseFloat(baseTravel.toFixed(1)),
            food:         parseFloat(baseFood.toFixed(1))
        },
        trendFactor,
        label: trendLabel
    };
}

// ---------------------------------------------------------------------------
// 6. SUGGESTION RANKER (wraps top strategies into display-ready objects)
// ---------------------------------------------------------------------------
/**
 * Returns ranked, display-ready suggestion cards for the Suggestions panel.
 * Each card has: title, tip, savings, badge, icon, color.
 */
export function getRankedSuggestions(current, userProfile) {
    const topStrategies = optimizationEngine(current, userProfile, 3);

    if (topStrategies.length === 0) return [];

    return topStrategies.map((s, i) => {
        const badge = i === 0 ? '🏆 Best Strategy' : i === 1 ? '🥈 Good Option' : '🥉 Alternative';
        const iconMap = {
            electricity: 'fa-bolt text-yellow',
            travel:      'fa-car text-blue',
            food:        'fa-utensils text-green'
        };

        // Primary tip is the one for the dominant reduction axis
        const dominantAxis = s.elec >= s.travel && s.elec >= s.food ? 'electricity'
                           : s.travel >= s.food ? 'travel' : 'food';
        const primaryTip   = s.tips[dominantAxis] || 'Small consistent changes add up significantly.';
        const icon         = iconMap[dominantAxis];

        const allTips = Object.values(s.tips).filter(Boolean);

        return {
            rank:       i + 1,
            badge,
            label:      s.label,
            savedKg:    s.savedKg,
            newTotal:   s.newTotal,
            feasibility:s.feasibility,
            icon,
            primaryTip,
            allTips
        };
    });
}

// ---------------------------------------------------------------------------
// 7. KNOWLEDGE BASE — Context-aware chatbot response library
// ---------------------------------------------------------------------------
export const CHATBOT_KEYWORDS = [
    'carbon', 'footprint', 'energy', 'electricity', 'power', 'kwh',
    'transport', 'transportation', 'car', 'flight', 'travel', 'drive', 'bus', 'train', 'cycle',
    'food', 'diet', 'meat', 'vegan', 'vegetarian', 'eat',
    'sustainability', 'sustainable', 'eco', 'green', 'environment', 'climate', 'co2', 'emission',
    'reduce', 'goal', 'target', 'offset', 'recycle', 'renewable', 'solar', 'wind',
    'tip', 'advice', 'help', 'improve', 'better', 'less', 'lower', 'cut',
    'prediction', 'forecast', 'trend', 'history', 'track', 'data', 'month'
];

export const CHATBOT_REJECTION_PHRASES = [
    "I'm Carbonix AI, specialized in sustainability topics only. Try asking about energy, travel, food habits, or emission reduction!",
    "That's outside my expertise. I'm your Carbonix AI sustainability advisor — ask me about reducing your carbon footprint!",
    "I can only assist with sustainability-related questions as your Carbonix AI engine. Try: 'How do I reduce my electricity emissions?'",
];

// Knowledge base: topic → template functions (receive userCtx = { current, profile })
export const CHATBOT_KNOWLEDGE = {
    electricity: (ctx) => {
        const kwh = ctx.current?.electricity || 0;
        const avg = ctx.profile?.avgByCategory?.electricity || 0;
        const streak = ctx.profile?.streaks?.electricity || 0;
        let msg = kwh > 0
            ? `Your electricity emissions this month are **${kwh} kg** CO₂.`
            : 'Electricity is typically the largest household emission source.';
        if (avg > 0) msg += ` Your 3-month average is **${avg} kg**.`;
        if (streak >= 3) msg += ` ⚠️ Electricity has been your highest category for ${streak} months in a row.`;
        msg += ' Tips: switch to LED lighting (save up to 80%), unplug standby devices, set AC/heating 1–2°C less aggressively, and consider a smart power strip.';
        return msg;
    },
    travel: (ctx) => {
        const km = ctx.current?.travel || 0;
        const avg = ctx.profile?.avgByCategory?.travel || 0;
        let msg = km > 0
            ? `Your travel emissions this month are **${km} kg** CO₂.`
            : 'Transportation is one of the top contributors to personal carbon footprints.';
        if (avg > 0) msg += ` Your average is **${avg} kg/month**.`;
        msg += ' Tips: carpool or use public transit (cuts emissions by up to 75%), combine errands, walk/cycle for trips under 3km, and avoid short-haul flights when rail is available.';
        return msg;
    },
    food: (ctx) => {
        const food = ctx.current?.food || 0;
        let msg = food > 0
            ? `Your diet contributes **${food} kg** CO₂ this month.`
            : 'Food choices have a surprisingly large carbon impact.';
        msg += ' A heavy meat diet emits ~3.5× more CO₂ than a vegetarian one. Try Meatless Mondays, swap beef for chicken or legumes, and buy local seasonal produce.';
        return msg;
    },
    goal: (ctx) => {
        const total = ctx.current?.total || 0;
        const goal = GLOBAL_BASELINE * 0.9;
        if (total > 0) {
            const diff = total - goal;
            return diff > 0
                ? `Your current total is **${total} kg** vs. a 10% reduction goal of **${goal.toFixed(0)} kg**. You need to cut **${diff.toFixed(0)} more kg** this month. Focus on your highest category!`
                : `🎉 Goal achieved! Your ${total} kg is below the 10% reduction target of ${goal.toFixed(0)} kg. Keep it up!`;
        }
        return `A great starting goal is a 10% reduction from the average baseline of ${GLOBAL_BASELINE} kg/month. That means staying under ${goal.toFixed(0)} kg. Track your data to see progress!`;
    },
    trend: (ctx) => {
        const trend = ctx.profile?.trend || 'stable';
        const total = ctx.current?.total || 0;
        const avg   = ctx.profile?.avgTotal || 0;
        let msg = `Your emission trend is **${trend}**.`;
        if (avg > 0 && total > 0) {
            const delta = ((total - avg) / avg * 100).toFixed(1);
            msg += ` This month (${total} kg) is ${delta > 0 ? '+' : ''}${delta}% vs. your ${avg} kg average.`;
        }
        if (trend === 'increasing') msg += ' ⚠️ Try targeting your highest category urgently.';
        if (trend === 'decreasing') msg += ' ✅ Great progress — keep the momentum.';
        return msg;
    },
    general: (ctx) => {
        const highest = ctx.profile?.highestCategory || ctx.current?.highest || null;
        if (highest) {
            return `Your biggest opportunity for reduction is **${highest}**. Small consistent changes in this area will have the highest impact. Ask me specifically about ${highest} for targeted tips!`;
        }
        return "Tracking your carbon footprint is the first step toward meaningful change. Start by logging your electricity usage, travel distance, and diet type — I'll personalize my recommendations from there!";
    }
};

// ---------------------------------------------------------------------------
// 8. TIP LIBRARIES (for optimization engine strategy labels)
// ---------------------------------------------------------------------------
const ELECTRICITY_TIPS = [
    "Switch to LED lighting and unplug standby devices to cut 10% of electricity emissions.",
    "Optimize AC/heating schedules and use smart power strips — target 20% reduction.",
    "Invest in energy-efficient appliances (A++ rated) and consider rooftop solar offsets.",
    "Conduct a home energy audit and eliminate phantom loads from all circuits.",
    "Transition lighting, heating and cooling to renewable energy sources."
];

const TRAVEL_TIPS = [
    "Combine errands and carpool at least once a week to trim travel by 10%.",
    "Use public transit for commutes and walk/cycle for trips under 3km.",
    "Work from home 1–2 days per week, reducing commute distance by ~20–30%.",
    "Shift to an electric or hybrid vehicle for primary transportation.",
    "Eliminate car usage for routine trips; rely on transit, cycling, and remote work."
];

const FOOD_TIPS = [
    "Try one vegetarian meal per day to reduce food emissions by ~10%.",
    "Adopt Meatless Mondays and replace beef with chicken or legumes.",
    "Shift to a majority plant-based diet — proven to halve food emissions.",
    "Buy local, seasonal produce only and reduce packaged/processed food consumption.",
    "Adopt a fully plant-based or vegan diet for maximum food footprint reduction."
];
