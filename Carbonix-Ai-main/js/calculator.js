/**
 * calculator.js — Enhanced with real-time intelligence engine
 *
 * Changes vs. original:
 *  - Fetches last 12 months of history to build userProfile
 *  - Debounced real-time suggestions on input change (no submit needed)
 *  - Optimization engine provides top-3 ranked reduction strategies
 *  - Saves richer data: userProfile doc + predictions collection to Firestore
 *  - Trend-aware prediction via engine.predictNextMonth()
 *  - Exposes currentMonthData & userProfile on window for chatbot
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
    collection, addDoc, getDocs, setDoc, doc,
    query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

import {
    optimizationEngine,
    buildUserProfile,
    predictNextMonth,
    getRankedSuggestions,
    EMISSION_FACTORS
} from "./engine.js";

// ---------------------------------------------------------------------------
// Shared State (exposed on window so chatbot.js can read it)
// ---------------------------------------------------------------------------
window.currentMonthData = { electricity: 0, travel: 0, food: 0, total: 0 };
window.userProfile = {};

// Historical records (raw Firestore docs)
let historyDocs = [];

// Past months for trend chart labels
const MONTH_LABELS = ['7mo ago', '6mo ago', '5mo ago', '4mo ago', '3mo ago', '2mo ago', 'Last mo', 'This mo'];

// Custom goal (loaded from Firestore userProfile)
let customGoalKg = null; // null = not set

// ---------------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------------
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;

    // UI Elements
    const dataForm   = document.getElementById('data-entry-form');
    const saveStatus = document.getElementById('save-status');
    const totalEl    = document.getElementById('total-emissions');
    const elecEl     = document.getElementById('elec-emissions');
    const travelEl   = document.getElementById('travel-emissions');
    const foodEl     = document.getElementById('food-emissions');

    // Simulators
    const simOcrBtn    = document.getElementById('sim-ocr-btn');
    const simTravelBtn = document.getElementById('sim-travel-btn');
    const ocrSim       = document.getElementById('ocr-simulation');
    const travelSim    = document.getElementById('travel-simulation');
    const uploadZone   = document.getElementById('upload-zone');
    const applyTravel  = document.getElementById('apply-travel');
    const userCity     = document.getElementById('user-city');

    // Prediction sliders
    const reduceElecSlider   = document.getElementById('reduce-elec');
    const reduceTravelSlider = document.getElementById('reduce-travel');

    // -----------------------------------------------------------------------
    // Real-Time Input Listeners — debounced 300ms
    // -----------------------------------------------------------------------
    const liveInputIds = ['electricity', 'travel', 'food'];
    const onLiveInput = debounce(() => {
        const preview = computeFromInputs();
        if (preview.total > 0) {
            updateSuggestionsDisplay(preview);
        }
    }, 300);

    liveInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', onLiveInput);
        if (el) el.addEventListener('change', onLiveInput);
    });

    // Prediction sliders
    const mapSlider = (id, valId) => {
        const slider = document.getElementById(id);
        const val    = document.getElementById(valId);
        if (slider) {
            slider.addEventListener('input', (e) => {
                val.textContent = e.target.value + '%';
                updatePrediction();
            });
        }
    };
    mapSlider('reduce-elec',   'elec-val');
    mapSlider('reduce-travel', 'travel-val');

    // -----------------------------------------------------------------------
    // Auth guard
    // -----------------------------------------------------------------------
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            fetchHistory();
        }
    });

    // -----------------------------------------------------------------------
    // Emission helpers
    // -----------------------------------------------------------------------
    const getFoodEmission = (type) => EMISSION_FACTORS.food[type] || 0;

    const computeFromInputs = () => {
        const kwh  = parseFloat(document.getElementById('electricity').value) || 0;
        const km   = parseFloat(document.getElementById('travel').value)      || 0;
        const diet = document.getElementById('food').value;
        const electricityCO2 = kwh * EMISSION_FACTORS.electricity;
        const travelCO2      = km  * EMISSION_FACTORS.travel;
        const foodCO2        = getFoodEmission(diet);
        return {
            electricity: parseFloat(electricityCO2.toFixed(1)),
            travel:      parseFloat(travelCO2.toFixed(1)),
            food:        parseFloat(foodCO2.toFixed(1)),
            total:       parseFloat((electricityCO2 + travelCO2 + foodCO2).toFixed(1))
        };
    };

    // -----------------------------------------------------------------------
    // Save & Calculate (form submit)
    // -----------------------------------------------------------------------
    if (dataForm) {
        dataForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) return;

            const data       = computeFromInputs();
            const submitBtn  = dataForm.querySelector('button[type="submit"]');
            submitBtn.disabled    = true;
            submitBtn.textContent = 'Saving...';

            try {
                // 1. Save emission record
                await addDoc(collection(db, 'carbonData'), {
                    userID:           currentUser.uid,
                    electricityUsage: data.electricity,
                    travelDistance:   data.travel,
                    foodType:         data.food,
                    totalCarbon:      data.total,
                    createdAt:        serverTimestamp()
                });

                // 2. Refresh history & update all UI
                await fetchHistory();

                // 3. Save updated userProfile doc
                await saveUserProfileToFirestore(currentUser.uid);

                saveStatus.classList.remove('hidden');
                setTimeout(() => saveStatus.classList.add('hidden'), 3000);
                dataForm.reset();

            } catch (err) {
                console.error("Error saving data:", err);
                alert("Could not save data. Please try again.");
            } finally {
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Save & Calculate';
            }
        });
    }

    // -----------------------------------------------------------------------
    // Fetch full history (last 12 records) + build profile
    // -----------------------------------------------------------------------
    const fetchHistory = async () => {
        if (!currentUser) return;
        try {
            const q = query(
                collection(db, 'carbonData'),
                where("userID", "==", currentUser.uid),
                orderBy("createdAt", "desc"),
                limit(12)
            );

            const snapshot = await getDocs(q);
            historyDocs = snapshot.docs.map(d => d.data());

            // Most recent record → currentMonthData
            if (historyDocs.length > 0) {
                const latest = historyDocs[0];
                window.currentMonthData = {
                    electricity: latest.electricityUsage || 0,
                    travel:      latest.travelDistance   || 0,
                    food:        latest.foodType         || 0,
                    total:       latest.totalCarbon      || 0
                };
            }

            // Build behavioral profile from all history
            window.userProfile = buildUserProfile(historyDocs);

            // Restore saved custom goal from profile
            loadCustomGoal();

            // Update all views
            updateDashboardUI();
            updateSuggestionsDisplay(window.currentMonthData);
            updatePrediction();

        } catch (err) {
            console.error("Fetch Error:", err);
            if (err.message && (err.message.includes('requires an index') || err.code === 'failed-precondition')) {
                const linkMatch = err.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
                if (linkMatch) {
                    console.warn('Firestore index required. Build it here:', linkMatch[0]);
                    alert('Firestore requires a Composite Index.\n\nCheck the browser console (F12) for a direct link to build it.');
                }
            }
        }
    };

    // -----------------------------------------------------------------------
    // Custom Goal — Load, Save, Sync
    // -----------------------------------------------------------------------
    const loadCustomGoal = () => {
        // Load from userProfile if previously saved
        const saved = window.userProfile?._customGoalKg;
        if (saved && saved > 0) {
            customGoalKg = saved;
            const kgInput  = document.getElementById('goal-target-input');
            const pctInput = document.getElementById('goal-pct-input');
            const baseAvg  = window.userProfile.avgTotal > 0 ? window.userProfile.avgTotal : 340;
            if (kgInput)  kgInput.value  = saved;
            if (pctInput) pctInput.value = Math.round((1 - saved / baseAvg) * 100);
        }
    };

    const saveCustomGoalToFirestore = async (kg) => {
        if (!currentUser) return;
        try {
            await setDoc(doc(db, 'userProfile', currentUser.uid), {
                _customGoalKg: kg,
                lastUpdated: serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.warn('Goal save error:', e);
        }
    };

    // Wire goal inputs — kg ↔ % sync
    const kgInput  = document.getElementById('goal-target-input');
    const pctInput = document.getElementById('goal-pct-input');
    const saveGoalBtn = document.getElementById('save-goal-btn');

    if (kgInput) {
        kgInput.addEventListener('input', () => {
            const kg = parseFloat(kgInput.value);
            const baseAvg = window.userProfile?.avgTotal > 0 ? window.userProfile.avgTotal : 340;
            if (!isNaN(kg) && kg > 0 && pctInput) {
                pctInput.value = Math.round((1 - kg / baseAvg) * 100);
            }
        });
    }

    if (pctInput) {
        pctInput.addEventListener('input', () => {
            const pct = parseFloat(pctInput.value);
            const baseAvg = window.userProfile?.avgTotal > 0 ? window.userProfile.avgTotal : 340;
            if (!isNaN(pct) && pct > 0 && pct < 100 && kgInput) {
                kgInput.value = Math.round(baseAvg * (1 - pct / 100));
            }
        });
    }

    if (saveGoalBtn) {
        saveGoalBtn.addEventListener('click', async () => {
            const kg = parseFloat(kgInput?.value);
            if (!kg || kg <= 0) { alert('Please enter a valid goal.'); return; }

            customGoalKg = kg;
            saveGoalBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            saveGoalBtn.disabled = true;

            await saveCustomGoalToFirestore(kg);

            saveGoalBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            saveGoalBtn.style.background = 'var(--success)';
            setTimeout(() => {
                saveGoalBtn.innerHTML = '<i class="fas fa-check"></i> Set Goal';
                saveGoalBtn.style.background = '';
                saveGoalBtn.disabled = false;
            }, 2000);

            updateDashboardUI(); // re-render progress bar with new goal
        });
    }

    // -----------------------------------------------------------------------
    // Save userProfile to Firestore
    // -----------------------------------------------------------------------
    const saveUserProfileToFirestore = async (uid) => {
        try {
            const profile = window.userProfile;
            await setDoc(doc(db, 'userProfile', uid), {
                uid,
                avgByCategory:   profile.avgByCategory   || {},
                avgTotal:        profile.avgTotal         || 0,
                trend:           profile.trend            || 'stable',
                streaks:         profile.streaks          || {},
                highestCategory: profile.highestCategory  || null,
                recordCount:     profile.recordCount      || 0,
                lastUpdated:     serverTimestamp()
            }, { merge: true });
        } catch (err) {
            console.warn("Could not save userProfile:", err);
        }
    };

    // -----------------------------------------------------------------------
    // Dashboard UI updater
    // -----------------------------------------------------------------------
    const updateDashboardUI = () => {
        const d = window.currentMonthData;
        totalEl.innerHTML  = `${d.total.toFixed(1)} <span class="unit">kg CO₂</span>`;
        elecEl.innerHTML   = `${d.electricity.toFixed(1)} <span class="unit">kg</span>`;
        travelEl.innerHTML = `${d.travel.toFixed(1)} <span class="unit">kg</span>`;
        foodEl.innerHTML   = `${d.food.toFixed(1)} <span class="unit">kg</span>`;

        // --- Custom Goal Bar ---
        const baseAvg    = window.userProfile.avgTotal > 0 ? window.userProfile.avgTotal : 340;
        const goal       = customGoalKg !== null ? customGoalKg : baseAvg * 0.9; // fallback 10%
        const pctLabel   = Math.round((1 - goal / baseAvg) * 100);
        const mainProgressEl = document.getElementById('goal-progress-text');
        const statPreviewEl = document.getElementById('stat-goal-preview');
        const bar           = document.getElementById('goal-progress-bar');
        const badge         = document.getElementById('goal-status-badge');
        const targetPill    = document.getElementById('goal-target-display');

        // Update target pill
        if (targetPill) {
            targetPill.textContent = customGoalKg
                ? `Target: ${goal.toFixed(0)} kg (−${pctLabel}%)`
                : `Default target: ${goal.toFixed(0)} kg (−10%)`;
        }

        if (d.total > 0) {
            if (d.total <= goal) {
                bar.style.width           = '100%';
                bar.style.backgroundColor = 'var(--success)';
                badge.textContent         = 'Goal Achieved! 🏆';
                badge.classList.add('success');
                const winMsg = `<i class="fas fa-trophy text-warning"></i> You hit your target of ${goal.toFixed(0)} kg!`;
                if (mainProgressEl) mainProgressEl.innerHTML = winMsg;
                if (statPreviewEl) statPreviewEl.innerHTML = `Goal hit! 🏆`;
            } else {
                const remaining   = d.total - goal;
                const reduction   = baseAvg - d.total;
                const targetReduc = baseAvg - goal;
                let pct = targetReduc > 0 ? (reduction / targetReduc) * 100 : 5;
                if (pct < 0) pct = 5;
                bar.style.width           = `${Math.min(pct, 100)}%`;
                bar.style.backgroundColor = 'var(--info)';
                badge.textContent         = 'In Progress';
                badge.classList.remove('success');
                const progMsg = `<i class="fas fa-arrow-down"></i> Need to cut <strong>${remaining.toFixed(0)} more kg</strong> to hit your goal`;
                if (mainProgressEl) mainProgressEl.innerHTML = progMsg;
                if (statPreviewEl) statPreviewEl.innerHTML = `Need -${remaining.toFixed(0)} kg`;
            }
        } else {
            if (mainProgressEl) mainProgressEl.textContent = 'Add your data to track progress.';
            if (statPreviewEl) statPreviewEl.textContent = 'Goal tracking...';
        }

        // Trend pill on trend chart header
        const trendLabel = document.getElementById('trend-label');
        if (trendLabel && window.userProfile.trend) {
            const icons = { increasing: '⚠️', decreasing: '✅', stable: '→' };
            trendLabel.textContent = `${icons[window.userProfile.trend] || ''} ${window.userProfile.trend}`;
        }

        updateCharts();
    };

    // -----------------------------------------------------------------------
    // Charts updater
    // -----------------------------------------------------------------------
    window.updateCharts = () => {
        const d = window.currentMonthData;

        if (window.sourcePieChart) {
            window.sourcePieChart.data.datasets[0].data = [d.electricity, d.travel, d.food];
            window.sourcePieChart.update();
        }

        if (window.trendLineChart) {
            // Build historical totals array (oldest → newest)
            const historicalTotals = [...historyDocs].reverse().map(doc => doc.totalCarbon || 0);
            const labels = [];
            const startOffset = MONTH_LABELS.length - historicalTotals.length;
            historicalTotals.forEach((_, i) => labels.push(MONTH_LABELS[startOffset + i] || `Entry ${i + 1}`));

            window.trendLineChart.data.labels           = labels;
            window.trendLineChart.data.datasets[0].data = historicalTotals;
            window.trendLineChart.update();
        }
    };

    // -----------------------------------------------------------------------
    // Suggestions display — powered by optimization engine
    // -----------------------------------------------------------------------
    const updateSuggestionsDisplay = (data) => {
        const container = document.getElementById('suggestions-list');
        if (!container) return;

        if (!data || data.total === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-magic fa-3x text-muted"></i>
                    <p>Enter your data to get personalized AI suggestions.</p>
                </div>`;
            return;
        }

        // Run optimization engine
        const ranked = getRankedSuggestions(data, window.userProfile);

        if (ranked.length === 0) {
            container.innerHTML = `<p class="text-muted">No strategies found.</p>`;
            return;
        }

        const profileHint = buildProfileHint();
        let html = `
            <div class="optimization-header">
                <p class="margin-bottom-sm">
                    <strong>Optimization Engine</strong> analyzed 215 reduction strategies and ranked the best paths for your profile:
                </p>
                ${profileHint}
            </div>`;

        ranked.forEach((s, i) => {
            const feasColor = s.feasibility >= 70 ? 'text-green' : s.feasibility >= 40 ? 'text-yellow' : 'text-red';
            const tipsList  = s.allTips.map(t => `<li>${t}</li>`).join('');

            html += `
                <div class="suggestion-item drop-in" style="animation-delay:${i * 0.1}s">
                    <div class="suggestion-icon ${s.icon}"><i class="fas ${s.icon.split(' ')[0]}"></i></div>
                    <div class="suggestion-content">
                        <div class="suggestion-meta">
                            <span class="badge">${s.badge}</span>
                            <span class="savings-badge">Save ${s.savedKg} kg CO₂</span>
                            <span class="feasibility-badge ${feasColor}">Feasibility: ${s.feasibility}%</span>
                        </div>
                        <p class="suggestion-strategy">${s.label}</p>
                        <p>${s.primaryTip}</p>
                        ${s.allTips.length > 1 ? `<ul class="tips-list text-sm">${tipsList}</ul>` : ''}
                        <p class="text-sm text-muted">Projected total: <strong>${s.newTotal} kg</strong> vs current ${data.total.toFixed(1)} kg</p>
                    </div>
                </div>`;
        });

        container.innerHTML = html;
    };

    // Build a human-readable profile hint string for the suggestions header
    const buildProfileHint = () => {
        const p = window.userProfile;
        if (!p || !p.recordCount || p.recordCount === 0) return '';

        const parts = [];
        if (p.highestCategory) parts.push(`highest source: <strong>${p.highestCategory}</strong>`);
        if (p.trend) {
            const icons = { increasing: '⚠️', decreasing: '✅', stable: '→' };
            parts.push(`trend: ${icons[p.trend] || ''} <strong>${p.trend}</strong>`);
        }
        if (p.recordCount > 1) parts.push(`based on <strong>${p.recordCount} months</strong> of your data`);

        return parts.length > 0
            ? `<p class="text-sm text-muted profile-hint">Your profile: ${parts.join(' · ')}</p>`
            : '';
    };

    // -----------------------------------------------------------------------
    // Prediction engine — trend-aware, saves to Firestore
    // -----------------------------------------------------------------------
    window.predictionChartObj = null;

    const updatePrediction = () => {
        const reducElecPct   = parseInt(document.getElementById('reduce-elec')?.value   || 0);
        const reducTravelPct = parseInt(document.getElementById('reduce-travel')?.value || 0);

        const result = predictNextMonth(
            window.currentMonthData,
            window.userProfile,
            { elec: reducElecPct, travel: reducTravelPct, food: 0 }
        );

        // Update trend label
        const trendNote = document.getElementById('trend-note');
        if (trendNote) trendNote.textContent = result.label;

        document.getElementById('predicted-total').textContent = `${result.predicted} kg CO₂`;

        // Save prediction run to Firestore (fire-and-forget)
        if (currentUser && result.predicted > 0) {
            addDoc(collection(db, 'predictions'), {
                userID:        currentUser.uid,
                currentTotal:  window.currentMonthData.total,
                predicted:     result.predicted,
                trendFactor:   result.trendFactor,
                reductions:    { elec: reducElecPct, travel: reducTravelPct, food: 0 },
                breakdown:     result.breakdown,
                createdAt:     serverTimestamp()
            }).catch(e => console.warn("Prediction save error:", e));
        }

        // Bar chart
        const ctx = document.getElementById('predictionChart');
        if (ctx) {
            if (!window.predictionChartObj) {
                window.predictionChartObj = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['Current Month', 'Predicted (Next)'],
                        datasets: [{
                            label: 'Total Emissions',
                            data: [window.currentMonthData.total, result.predicted],
                            backgroundColor: [
                                '#3B82F6',
                                result.predicted < window.currentMonthData.total ? '#22C55E' : '#EF4444'
                            ],
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            } else {
                window.predictionChartObj.data.datasets[0].data = [window.currentMonthData.total, result.predicted];
                window.predictionChartObj.data.datasets[0].backgroundColor = [
                    '#3B82F6',
                    result.predicted < window.currentMonthData.total ? '#22C55E' : '#EF4444'
                ];
                window.predictionChartObj.update();
            }
        }
    };
    window.updatePredictionChart = updatePrediction;

    // -----------------------------------------------------------------------
    // Simulators
    // -----------------------------------------------------------------------
    if (simOcrBtn && ocrSim) {
        simOcrBtn.addEventListener('click', () => {
            ocrSim.classList.toggle('hidden');
            travelSim?.classList.add('hidden');
        });
    }
    if (simTravelBtn && travelSim) {
        simTravelBtn.addEventListener('click', () => {
            travelSim.classList.toggle('hidden');
            ocrSim?.classList.add('hidden');
        });
    }
    if (uploadZone) {
        uploadZone.addEventListener('click', () => {
            uploadZone.innerHTML = '<i class="fas fa-spinner fa-spin fa-2x"></i><p>Extracting Text (OCR)...</p>';
            setTimeout(() => {
                uploadZone.innerHTML = `
                    <p class="text-success"><i class="fas fa-check-circle"></i> OCR Success</p>
                    <h3>Extracted: 345.5 kWh</h3>
                    <button id="apply-ocr-btn" class="btn btn-sm btn-outline margin-top-sm">Apply Value</button>`;
                document.getElementById('apply-ocr-btn')?.addEventListener('click', () => {
                    document.getElementById('electricity').value = 345.5;
                    ocrSim.classList.add('hidden');
                    onLiveInput(); // trigger real-time recalc
                });
            }, 1500);
        });
    }
    if (applyTravel) {
        applyTravel.addEventListener('click', () => {
            const city = userCity?.value;
            let km = 300;
            if (city === 'NewYork') km = 450;
            if (city === 'Tokyo')   km = 200;
            if (city === 'Rural')   km = 800;
            document.getElementById('travel').value = km;
            travelSim?.classList.add('hidden');
            onLiveInput(); // trigger real-time recalc
        });
    }
});
