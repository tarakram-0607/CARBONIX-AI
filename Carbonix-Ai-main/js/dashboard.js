import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// Global Chart Instances
window.sourcePieChart = null;
window.trendLineChart = null;

document.addEventListener('DOMContentLoaded', () => {
    // --- Sidebar Navigation ---
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const sections = document.querySelectorAll('.content-section');
    const pageTitle = document.getElementById('page-title');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = item.getAttribute('data-section');
            if (!targetId) return; // Ignore theme/logout/etc. buttons that are just icons

            e.preventDefault();
            
            // Remove active from all
            navItems.forEach(nav => nav.classList.remove('active'));
            sections.forEach(sec => {
                sec.style.display = 'none';
                sec.classList.remove('active', 'fade-in');
            });
            
            // Add active to clicked
            item.classList.add('active');
            
            // Show target section
            const targetSec = document.getElementById(targetId);
            if (targetSec) {
                targetSec.style.display = 'block';
                targetSec.classList.add('active', 'fade-in');
            }
            
            // Update Title
            const sectionNames = {
                'dashboard': 'Dashboard',
                'add-data': 'Record Data',
                'predictions': 'Predictions',
                'suggestions': 'AI Suggestions'
            };
            pageTitle.textContent = sectionNames[targetId] || 'Dashboard';
            
            // Refresh charts if dashboard or predictions
            if (targetId === 'dashboard' && window.updateCharts) {
                window.updateCharts();
            }
            if (targetId === 'predictions' && window.updatePredictionChart) {
                window.updatePredictionChart();
            }
        });
    });

    // --- Wait for Chart.js to load, then setup blank charts ---
    const initCharts = () => {
        const pieCtx = document.getElementById('sourcePieChart');
        const lineCtx = document.getElementById('trendLineChart');

        if (pieCtx && !window.sourcePieChart) {
            window.sourcePieChart = new Chart(pieCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Electricity', 'Travel', 'Food'],
                    datasets: [{
                        data: [0, 0, 0],
                        backgroundColor: ['#EAB308', '#3B82F6', '#22C55E'],
                        borderWidth: 0,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: getComputedStyle(document.body).getPropertyValue('--text-main') } }
                    },
                    cutout: '70%'
                }
            });
        }
        
        if (lineCtx && !window.trendLineChart) {
            window.trendLineChart = new Chart(lineCtx, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], // Mock past months
                    datasets: [{
                        label: 'Total Emissions (kg CO₂)',
                        data: [0, 0, 0, 0, 0, 0],
                        borderColor: '#2E7D32',
                        backgroundColor: 'rgba(46, 125, 50, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: { 
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-muted') }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-muted') }
                        }
                    }
                }
            });
        }
    };
    
    // Slight delay to ensure canvas exists and styles apply
    setTimeout(initCharts, 500);

    // --- Mobile Menu Toggle ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    if (mobileMenuBtn && sidebar && sidebarOverlay) {
        const toggleSidebar = () => {
            sidebar.classList.toggle('open');
            sidebarOverlay.classList.toggle('show');
        };
        
        mobileMenuBtn.addEventListener('click', toggleSidebar);
        sidebarOverlay.addEventListener('click', toggleSidebar);
        
        // Close sidebar when clicking a nav item on mobile
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('open');
                    sidebarOverlay.classList.remove('show');
                }
            });
        });
    }
});

// Watch theme changes to update chart text colors
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const textColor = isDark ? '#F8FAFC' : '#1E293B';
            const mutedColor = isDark ? '#94A3B8' : '#64748B';
            
            if (window.sourcePieChart) {
                window.sourcePieChart.options.plugins.legend.labels.color = textColor;
                window.sourcePieChart.update();
            }
            if (window.trendLineChart) {
                window.trendLineChart.options.scales.x.ticks.color = mutedColor;
                window.trendLineChart.options.scales.y.ticks.color = mutedColor;
                window.trendLineChart.update();
            }
            if (window.predictionChartObj) {
                window.predictionChartObj.options.plugins.legend.labels.color = textColor;
                window.predictionChartObj.options.scales.x.ticks.color = mutedColor;
                window.predictionChartObj.options.scales.y.ticks.color = mutedColor;
                window.predictionChartObj.update();
            }
        }
    });
});
observer.observe(document.documentElement, { attributes: true });
