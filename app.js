'use strict';

/* ============================================================
   DEFAULT CATEGORIES (copied to new months)
   ============================================================ */
const DEFAULT_CATEGORIES = [
    { id: 'housing',       name: 'Housing',         budget: 0, color: '#6366f1' },
    { id: 'food',          name: 'Food & Groceries', budget: 0, color: '#10b981' },
    { id: 'transport',     name: 'Transportation',   budget: 0, color: '#f59e0b' },
    { id: 'utilities',     name: 'Utilities',        budget: 0, color: '#06b6d4' },
    { id: 'healthcare',    name: 'Healthcare',       budget: 0, color: '#ec4899' },
    { id: 'entertainment', name: 'Entertainment',    budget: 0, color: '#8b5cf6' },
    { id: 'education',     name: 'Education',        budget: 0, color: '#f97316' },
    { id: 'personal',      name: 'Personal Care',    budget: 0, color: '#14b8a6' },
];

const CATEGORY_EMOJIS = {
    housing:       '🏠',
    food:          '🛒',
    transport:     '🚗',
    utilities:     '⚡',
    healthcare:    '🏥',
    entertainment: '🎬',
    education:     '📚',
    personal:      '💆',
};

/* ============================================================
   STATE
   ============================================================ */
let state = {
    activeMonth: currentMonthStr(),
    data: {}   // keyed by "YYYY-MM"
};

/* chart instances – destroyed and re-created on each render */
const charts = { donut: null, bar: null, catBar: null };

/* currently selected transaction type in the form */
let activeTxnType = 'expense';

/* ============================================================
   FIREBASE STATE
   ============================================================ */
let auth = null;
let db   = null;
let currentUser               = null;
let firestoreUnsubscribeMonth = null;
let pendingSaveTimer          = null;

/* ============================================================
   HOUSEHOLD STATE
   ============================================================ */
let currentHouseholdId   = null;
let currentHouseholdData = null;
let userHouseholds       = [];
let eventsRegistered     = false;

/* ============================================================
   PERSISTENCE
   ============================================================ */
function saveState() {
    try { localStorage.setItem('housebudget_v2', JSON.stringify(state)); } catch (_) {}
    if (db && currentUser) queueFirestoreSave(state.activeMonth);
}

function loadState() {
    try {
        const raw = localStorage.getItem('housebudget_v2');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.data) {
                state.activeMonth = parsed.activeMonth || currentMonthStr();
                state.data = parsed.data;
            }
        }
    } catch (_) {}
}

/* ============================================================
   HELPERS
   ============================================================ */
function currentMonthStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtMoney(n) {
    return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneyShort(n) {
    if (Math.abs(n) >= 1000) return '$' + (Math.abs(n) / 1000).toFixed(1) + 'k';
    return fmtMoney(n);
}

function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function monthLabel(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getCatEmoji(catId, catName) {
    if (CATEGORY_EMOJIS[catId]) return CATEGORY_EMOJIS[catId];
    const n = (catName || '').toLowerCase();
    if (n.includes('food') || n.includes('grocer') || n.includes('market')) return '🛒';
    if (n.includes('hous') || n.includes('rent') || n.includes('mortgage')) return '🏠';
    if (n.includes('car') || n.includes('gas') || n.includes('fuel') || n.includes('transport')) return '🚗';
    if (n.includes('electric') || n.includes('water') || n.includes('util') || n.includes('internet')) return '⚡';
    if (n.includes('health') || n.includes('medical') || n.includes('doctor')) return '🏥';
    if (n.includes('entertain') || n.includes('movie') || n.includes('netflix')) return '🎬';
    if (n.includes('school') || n.includes('educat') || n.includes('course')) return '📚';
    if (n.includes('cloth') || n.includes('apparel')) return '👔';
    if (n.includes('travel') || n.includes('hotel') || n.includes('vacation')) return '✈️';
    if (n.includes('saving') || n.includes('invest')) return '💰';
    return '💳';
}

/* ============================================================
   MONTH DATA – get or create
   Carries forward categories and income target from the most
   recent existing month so the user does not start from scratch.
   ============================================================ */
function getMonthData(month) {
    if (!state.data[month]) {
        // Find the most recent prior month with data
        const existingMonths = Object.keys(state.data).sort();
        const prev = existingMonths.length ? state.data[existingMonths[existingMonths.length - 1]] : null;

        state.data[month] = {
            incomeTarget: prev ? prev.incomeTarget : 0,
            categories:   prev
                ? JSON.parse(JSON.stringify(prev.categories))
                : JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
            transactions: []
        };
        saveState();
    }
    return state.data[month];
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */
function toast(msg, type = 'success') {
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || '✓'}</span> ${escHtml(msg)}`;
    const container = document.getElementById('toastContainer');
    container.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'toastOut 0.3s cubic-bezier(.4,0,.2,1) forwards';
        setTimeout(() => el.remove(), 310);
    }, 3000);
}

/* ============================================================
   NAVIGATION
   ============================================================ */
let currentSection = 'dashboard';

function navigate(section) {
    currentSection = section;

    document.querySelectorAll('.nav-item, .bnav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.section === section);
    });
    document.querySelectorAll('.page').forEach(el => {
        el.classList.toggle('active', el.id === `page-${section}`);
    });

    const labels = {
        dashboard:    'Dashboard',
        budget:       'Budget Setup',
        transactions: 'Transactions',
        reports:      'Reports',
    };
    document.getElementById('pageTitle').textContent = labels[section] || section;
    document.getElementById('pageSubtitle').textContent = monthLabel(state.activeMonth);

    // Close sidebar on mobile
    closeSidebar();

    if (section === 'dashboard')    renderDashboard();
    if (section === 'budget')       renderBudget();
    if (section === 'transactions') renderTransactions();
    if (section === 'reports')      renderReports();
}

/* ============================================================
   SIDEBAR (mobile)
   ============================================================ */
function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('visible');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
    const md = getMonthData(state.activeMonth);

    const income  = md.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = md.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = income - expense;
    const incomeCnt  = md.transactions.filter(t => t.type === 'income').length;
    const expenseCnt = md.transactions.filter(t => t.type === 'expense').length;
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : null;

    /* -- Stat cards -- */
    document.getElementById('d-income').textContent = fmtMoney(income);
    document.getElementById('d-income-note').textContent = `${incomeCnt} transaction${incomeCnt !== 1 ? 's' : ''}`;

    document.getElementById('d-expense').textContent = fmtMoney(expense);
    document.getElementById('d-expense-note').textContent = `${expenseCnt} transaction${expenseCnt !== 1 ? 's' : ''}`;

    const balEl = document.getElementById('d-balance');
    balEl.textContent = (balance < 0 ? '-' : '') + fmtMoney(balance);
    balEl.style.color = balance < 0 ? 'var(--red)' : 'var(--blue)';
    document.getElementById('d-balance-note').textContent = balance >= 0 ? "You're in the green!" : "Spending exceeds income";

    document.getElementById('d-savings').textContent = savingsRate !== null ? savingsRate.toFixed(1) + '%' : '—';
    document.getElementById('d-savings-note').textContent =
        savingsRate === null ? 'Add income to see' :
        savingsRate >= 20    ? 'Great saving! 🎉' :
        savingsRate > 0      ? 'Try to save more' : 'No savings this month';

    /* -- Sidebar health -- */
    const totalBudgeted = md.categories.reduce((s, c) => s + c.budget, 0);
    const healthPct = totalBudgeted > 0 ? Math.min((expense / totalBudgeted) * 100, 100) : 0;
    const hf = document.getElementById('healthFill');
    hf.style.width = healthPct + '%';
    if (healthPct > 90)      hf.style.background = 'linear-gradient(90deg,#f87171,#dc2626)';
    else if (healthPct > 70) hf.style.background = 'linear-gradient(90deg,#fbbf24,#d97706)';
    else                     hf.style.background = 'linear-gradient(90deg,#34d399,#059669)';
    document.getElementById('healthSpent').textContent = fmtMoney(expense) + ' spent';
    document.getElementById('healthPct').textContent   = healthPct.toFixed(0) + '%';

    renderBudgetBars(md);
    renderDonutChart(md);
    renderRecentTxns(md);
}

/* Budget progress bars */
function renderBudgetBars(md) {
    const container = document.getElementById('budgetBars');
    const emptyEl   = document.getElementById('budgetBarsEmpty');
    const badge     = document.getElementById('overBudgetBadge');

    const spendMap = {};
    md.transactions.filter(t => t.type === 'expense').forEach(t => {
        spendMap[t.category] = (spendMap[t.category] || 0) + t.amount;
    });

    const visible = md.categories.filter(c => c.budget > 0 || spendMap[c.id]);
    if (visible.length === 0) {
        container.innerHTML = '';
        emptyEl.style.display = 'block';
        badge.classList.add('hidden');
        return;
    }
    emptyEl.style.display = 'none';

    let overCount = 0;
    container.innerHTML = visible.map(cat => {
        const spent  = spendMap[cat.id] || 0;
        const budget = cat.budget;
        const pct    = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
        const over   = budget > 0 && spent > budget;
        if (over) overCount++;
        const fillColor = over ? 'var(--red)' : cat.color;
        return `<div class="bb-item">
            <div class="bb-name" title="${escHtml(cat.name)}">${escHtml(cat.name)}</div>
            <div class="bb-track">
                <div class="bb-fill" style="width:${pct}%;background:${fillColor}"></div>
            </div>
            <div class="bb-info ${over ? 'over' : ''}">${fmtMoneyShort(spent)} / ${budget > 0 ? fmtMoneyShort(budget) : '∞'}</div>
        </div>`;
    }).join('');

    if (overCount > 0) {
        badge.textContent = `${overCount} over budget`;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

/* Donut chart */
function renderDonutChart(md) {
    const ctx = document.getElementById('donutChart').getContext('2d');

    const spendMap = {};
    md.transactions.filter(t => t.type === 'expense').forEach(t => {
        spendMap[t.category] = (spendMap[t.category] || 0) + t.amount;
    });
    const total = Object.values(spendMap).reduce((s, v) => s + v, 0);
    document.getElementById('donutTotal').textContent = fmtMoneyShort(total);

    const cats   = md.categories.filter(c => spendMap[c.id]);
    const data   = cats.map(c => spendMap[c.id]);
    const colors = cats.map(c => c.color);
    const labels = cats.map(c => c.name);

    if (charts.donut) { charts.donut.destroy(); charts.donut = null; }

    charts.donut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data:            cats.length ? data : [1],
                backgroundColor: cats.length ? colors : ['#e2e8f0'],
                borderWidth:     cats.length ? 3 : 0,
                borderColor:     '#fff',
                hoverOffset:     8,
            }]
        },
        options: {
            cutout: '72%',
            plugins: {
                legend: { display: false },
                tooltip: cats.length ? {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${fmtMoney(ctx.raw)} (${(ctx.raw / total * 100).toFixed(1)}%)`
                    }
                } : { enabled: false }
            },
            animation: { duration: 700 }
        }
    });

    const legend = document.getElementById('donutLegend');
    legend.innerHTML = cats.map(c => `
        <div class="leg-item">
            <div class="leg-dot" style="background:${c.color}"></div>
            <span>${escHtml(c.name)}</span>
        </div>
    `).join('');
}

/* Recent transactions list (top 6) */
function renderRecentTxns(md) {
    const listEl  = document.getElementById('recentTxns');
    const emptyEl = document.getElementById('recentEmpty');
    const recent  = [...md.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

    if (recent.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = recent.map(t => txnRow(t, md)).join('');
    attachDeleteHandlers(listEl, () => renderDashboard());
}

/* ============================================================
   BUDGET SETUP
   ============================================================ */
function renderBudget() {
    const md = getMonthData(state.activeMonth);

    document.getElementById('incomeTargetInput').value = md.incomeTarget || '';
    document.getElementById('incomeSavedMsg').textContent =
        md.incomeTarget ? `Current target: ${fmtMoney(md.incomeTarget)}` : '';

    const total = md.categories.reduce((s, c) => s + c.budget, 0);
    document.getElementById('totalBudgetInfo').textContent = `Total budgeted: ${fmtMoney(total)}`;

    /* Show carry button only when a previous month with categories exists */
    const prevMonth = Object.keys(state.data).sort().filter(m => m < state.activeMonth).pop();
    const carryBtn  = document.getElementById('carryFromPrevBtn');
    if (prevMonth && state.data[prevMonth]?.categories?.length) {
        document.getElementById('carryFromLabel').textContent = monthLabel(prevMonth);
        carryBtn.classList.remove('hidden');
    } else {
        carryBtn.classList.add('hidden');
    }

    const grid     = document.getElementById('catGrid');
    const emptyEl  = document.getElementById('catEmpty');

    if (md.categories.length === 0) {
        grid.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';

    grid.innerHTML = md.categories.map(cat => `
        <div class="cat-card">
            <div class="cat-head">
                <div class="cat-dot" style="background:${cat.color}"></div>
                <span class="cat-name" title="${escHtml(cat.name)}">${escHtml(cat.name)}</span>
                <button class="cat-del" data-id="${cat.id}" title="Remove category">×</button>
            </div>
            <div class="cat-budget-row">
                <div class="prefix-input flex-1">
                    <span class="prefix">$</span>
                    <input type="number" class="inp cat-bgt-inp" data-id="${cat.id}"
                           value="${cat.budget || ''}" placeholder="0" min="0" step="0.01">
                </div>
                <button class="btn-primary cat-save" data-id="${cat.id}">Save</button>
            </div>
        </div>
    `).join('');

    grid.querySelectorAll('.cat-del').forEach(btn => {
        btn.addEventListener('click', () => deleteCategory(btn.dataset.id));
    });
    grid.querySelectorAll('.cat-save').forEach(btn => {
        btn.addEventListener('click', () => {
            const id  = btn.dataset.id;
            const inp = grid.querySelector(`.cat-bgt-inp[data-id="${id}"]`);
            saveCategoryBudget(id, parseFloat(inp.value) || 0);
        });
    });
    grid.querySelectorAll('.cat-bgt-inp').forEach(inp => {
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveCategoryBudget(inp.dataset.id, parseFloat(inp.value) || 0);
            }
        });
    });
}

function carryFromPrevMonth() {
    const months = Object.keys(state.data).sort();
    const prevMonth = months.filter(m => m < state.activeMonth).pop();
    if (!prevMonth) { toast('No previous month data found', 'error'); return; }

    const prev = state.data[prevMonth];
    if (!prev.categories || prev.categories.length === 0) { toast('Previous month has no categories', 'error'); return; }

    const md = getMonthData(state.activeMonth);
    if (md.categories.length > 0 &&
        !confirm(`Replace current categories with those from ${monthLabel(prevMonth)}?`)) return;

    md.categories = JSON.parse(JSON.stringify(prev.categories));
    saveState();
    toast(`Categories carried from ${monthLabel(prevMonth)}`);
    renderBudget();
}

function saveCategoryBudget(id, budget) {
    const md  = getMonthData(state.activeMonth);
    const cat = md.categories.find(c => c.id === id);
    if (!cat) return;
    cat.budget = budget;
    saveState();
    toast(`Budget saved for ${cat.name}`);
    renderBudget();
}

function deleteCategory(id) {
    const md  = getMonthData(state.activeMonth);
    const cat = md.categories.find(c => c.id === id);
    if (!cat) return;
    if (!confirm(`Remove "${cat.name}"? This will not delete existing transactions.`)) return;
    md.categories = md.categories.filter(c => c.id !== id);
    saveState();
    toast(`Removed "${cat.name}"`, 'info');
    renderBudget();
}

/* ============================================================
   TRANSACTIONS
   ============================================================ */
function renderTransactions() {
    const md = getMonthData(state.activeMonth);

    /* Populate category select in the form */
    const catSel = document.getElementById('txnCat');
    catSel.innerHTML = md.categories.length
        ? md.categories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')
        : '<option value="">No categories – add in Budget Setup</option>';

    /* Populate filter dropdown */
    const filterCat = document.getElementById('filterCat');
    const saved = filterCat.value;
    filterCat.innerHTML = '<option value="all">All Categories</option>' +
        md.categories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    if (saved && [...filterCat.options].some(o => o.value === saved)) filterCat.value = saved;

    applyFilters();
}

function applyFilters() {
    const md         = getMonthData(state.activeMonth);
    const typeFilter = document.getElementById('filterType').value;
    const catFilter  = document.getElementById('filterCat').value;

    let txns = [...md.transactions];
    if (typeFilter !== 'all') txns = txns.filter(t => t.type === typeFilter);
    if (catFilter  !== 'all') txns = txns.filter(t => t.category === catFilter);
    txns.sort((a, b) => b.date.localeCompare(a.date));

    const listEl  = document.getElementById('txnList');
    const emptyEl = document.getElementById('txnEmpty');

    if (txns.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = txns.map(t => txnRow(t, md)).join('');
    attachDeleteHandlers(listEl, () => renderTransactions());
}

function addTransaction(txn) {
    const md = getMonthData(state.activeMonth);
    md.transactions.push(txn);
    saveState();
}

function deleteTransaction(id) {
    const md = getMonthData(state.activeMonth);
    md.transactions = md.transactions.filter(t => t.id !== id);
    saveState();
    toast('Transaction removed', 'error');
}

/* ============================================================
   REPORTS
   ============================================================ */
function renderReports() {
    document.getElementById('reportMonthLabel').textContent = monthLabel(state.activeMonth);
    renderMonthlyBarChart();
    renderCategoryBarChart();
}

function renderMonthlyBarChart() {
    /* Build last 6 months array ending at activeMonth */
    const [y, m] = state.activeMonth.split('-').map(Number);
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(y, m - 1 - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const incomes  = months.map(mo => (state.data[mo] || { transactions: [] }).transactions
        .filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0));
    const expenses = months.map(mo => (state.data[mo] || { transactions: [] }).transactions
        .filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
    const labels = months.map(mo => {
        const [ly, lm] = mo.split('-').map(Number);
        return new Date(ly, lm - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    });

    const ctx = document.getElementById('barChart').getContext('2d');
    if (charts.bar) { charts.bar.destroy(); charts.bar = null; }

    charts.bar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Income',
                    data: incomes,
                    backgroundColor: '#d1fae5',
                    borderColor:     '#059669',
                    borderWidth: 2,
                    borderRadius: 8,
                    borderSkipped: false,
                },
                {
                    label: 'Expenses',
                    data: expenses,
                    backgroundColor: '#fee2e2',
                    borderColor:     '#dc2626',
                    borderWidth: 2,
                    borderRadius: 8,
                    borderSkipped: false,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}` } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: { callback: v => '$' + v.toLocaleString() }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderCategoryBarChart() {
    const md      = getMonthData(state.activeMonth);
    const emptyEl = document.getElementById('catBarEmpty');
    const wrap    = document.getElementById('catChartWrap');

    const spendMap = {};
    md.transactions.filter(t => t.type === 'expense').forEach(t => {
        spendMap[t.category] = (spendMap[t.category] || 0) + t.amount;
    });

    const cats = md.categories.filter(c => c.budget > 0 || spendMap[c.id]);

    if (charts.catBar) { charts.catBar.destroy(); charts.catBar = null; }

    if (cats.length === 0) {
        wrap.style.display = 'none';
        emptyEl.classList.remove('hidden');
        return;
    }
    wrap.style.display = 'block';
    emptyEl.classList.add('hidden');

    const ctx = document.getElementById('catBarChart').getContext('2d');
    charts.catBar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: cats.map(c => c.name),
            datasets: [
                {
                    label: 'Budget',
                    data: cats.map(c => c.budget),
                    backgroundColor: '#e0e7ff',
                    borderColor:     '#4f46e5',
                    borderWidth: 2,
                    borderRadius: 8,
                    borderSkipped: false,
                },
                {
                    label: 'Spent',
                    data: cats.map(c => spendMap[c.id] || 0),
                    backgroundColor: cats.map(c => c.color + 'BB'),
                    borderColor:     cats.map(c => c.color),
                    borderWidth: 2,
                    borderRadius: 8,
                    borderSkipped: false,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtMoney(ctx.raw)}` } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: { callback: v => '$' + v.toLocaleString() }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

/* ============================================================
   SHARED: transaction row HTML
   ============================================================ */
function txnRow(t, md) {
    const cat     = md.categories.find(c => c.id === t.category);
    const catName = t.type === 'income' ? 'Income' : (cat ? cat.name : 'Uncategorized');
    const catColor = t.type === 'income' ? '#059669' : (cat ? cat.color : '#94a3b8');
    const emoji   = t.type === 'income' ? '💵' : getCatEmoji(t.category, cat ? cat.name : '');
    const label   = t.description || catName;
    const sign    = t.type === 'income' ? '+' : '-';

    return `<div class="txn-item">
        <div class="txn-dot" style="background:${catColor}1a;color:${catColor}">${emoji}</div>
        <div>
            <div class="txn-main">${escHtml(label)}</div>
            <div class="txn-sub">${escHtml(catName)} &bull; ${fmtDate(t.date)}</div>
        </div>
        <div class="txn-right">
            <div class="txn-amount ${t.type}">${sign}${fmtMoney(t.amount)}</div>
            <button class="txn-del" data-id="${t.id}" title="Delete transaction" aria-label="Delete">&#10005;</button>
        </div>
    </div>`;
}

function attachDeleteHandlers(container, afterDelete) {
    container.querySelectorAll('.txn-del').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteTransaction(btn.dataset.id);
            afterDelete();
            if (currentSection === 'dashboard') renderDashboard();
        });
    });
}

/* ============================================================
   FIREBASE – INIT
   ============================================================ */
function initFirebase() {
    if (typeof firebase === 'undefined' ||
        !window.firebaseConfig ||
        window.firebaseConfig.apiKey === 'YOUR_API_KEY') return;
    try {
        if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
        auth = firebase.auth();
        db   = firebase.firestore();
    } catch (e) {
        console.warn('Firebase init error:', e.message);
    }
}

/* ============================================================
   FIREBASE – FIRESTORE READ / WRITE
   ============================================================ */
function monthDocRef(month) {
    return db.collection('households').doc(currentHouseholdId).collection('months').doc(month);
}

async function saveToFirestore(month) {
    if (!db || !currentUser || !currentHouseholdId || !state.data[month]) return;
    try { await monthDocRef(month).set(state.data[month]); }
    catch (e) { console.error('Firestore write error:', e); }
}

function queueFirestoreSave(month) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(() => saveToFirestore(month), 900);
}

async function loadAllFromFirestore() {
    if (!db || !currentUser || !currentHouseholdId) return false;
    try {
        const snap = await db.collection('households').doc(currentHouseholdId)
            .collection('months').get();
        state.data = {};
        snap.forEach(doc => { state.data[doc.id] = doc.data(); });
        return true;
    } catch (e) {
        console.error('Firestore read error:', e);
        return false;
    }
}

/* Real-time listener — multiple family members see live updates */
function subscribeToActiveMonth() {
    if (firestoreUnsubscribeMonth) firestoreUnsubscribeMonth();
    firestoreUnsubscribeMonth = null;
    if (!db || !currentUser || !currentHouseholdId) return;
    firestoreUnsubscribeMonth = monthDocRef(state.activeMonth).onSnapshot(doc => {
        if (!doc.exists) return;
        const remote = doc.data();
        if (JSON.stringify(remote) === JSON.stringify(state.data[state.activeMonth])) return;
        state.data[state.activeMonth] = remote;
        try { localStorage.setItem('housebudget_v2', JSON.stringify(state)); } catch (_) {}
        if (currentSection === 'dashboard')    renderDashboard();
        if (currentSection === 'budget')       renderBudget();
        if (currentSection === 'transactions') renderTransactions();
        if (currentSection === 'reports')      renderReports();
    }, err => { console.warn('Snapshot error:', err.message); });
}

/* ============================================================
   HOUSEHOLD – FIREBASE FUNCTIONS
   ============================================================ */
function generateInviteCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

async function createHousehold(name) {
    const code  = generateInviteCode();
    const hhRef = db.collection('households').doc();
    const batch = db.batch();
    batch.set(hhRef, {
        name, inviteCode: code, createdBy: currentUser.uid,
        members: [currentUser.uid],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('users').doc(currentUser.uid), {
        households:        firebase.firestore.FieldValue.arrayUnion(hhRef.id),
        activeHouseholdId: hhRef.id,
    }, { merge: true });
    await batch.commit();
    const hh = { id: hhRef.id, name, inviteCode: code, members: [currentUser.uid], createdBy: currentUser.uid };
    currentHouseholdId   = hhRef.id;
    currentHouseholdData = hh;
    userHouseholds = [...userHouseholds.filter(h => h.id !== hhRef.id), hh];
    return hhRef.id;
}

async function joinHousehold(code) {
    const snap = await db.collection('households')
        .where('inviteCode', '==', code.toUpperCase().trim()).limit(1).get();
    if (snap.empty) throw new Error('No household found with that code.');
    const hhDoc = snap.docs[0];
    if (hhDoc.data().members.includes(currentUser.uid))
        throw new Error('You are already a member of this household.');
    const batch = db.batch();
    batch.update(hhDoc.ref, { members: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) });
    batch.set(db.collection('users').doc(currentUser.uid), {
        households:        firebase.firestore.FieldValue.arrayUnion(hhDoc.id),
        activeHouseholdId: hhDoc.id,
    }, { merge: true });
    await batch.commit();
    const hh = { id: hhDoc.id, ...hhDoc.data(), members: [...hhDoc.data().members, currentUser.uid] };
    currentHouseholdId   = hhDoc.id;
    currentHouseholdData = hh;
    userHouseholds = [...userHouseholds.filter(h => h.id !== hhDoc.id), hh];
    return hhDoc.id;
}

async function loadUserHouseholds() {
    try {
        const uDoc = await db.collection('users').doc(currentUser.uid).get();
        if (!uDoc.exists) { userHouseholds = []; return []; }
        const ids = uDoc.data().households || [];
        const results = [];
        for (const id of ids) {
            const hDoc = await db.collection('households').doc(id).get();
            if (hDoc.exists && hDoc.data().members.includes(currentUser.uid))
                results.push({ id, ...hDoc.data() });
        }
        userHouseholds = results;
        return results;
    } catch (_) { userHouseholds = []; return []; }
}

async function switchHousehold(id) {
    if (id === currentHouseholdId) { hideHouseholdPanel(); return; }
    await db.collection('users').doc(currentUser.uid).set({ activeHouseholdId: id }, { merge: true });
    currentHouseholdId   = id;
    currentHouseholdData = userHouseholds.find(h => h.id === id) || null;
    state.data = {};
    hideHouseholdPanel();
    showLoading();
    await loadAllFromFirestore();
    hideLoading();
    updateHouseholdUI();
    subscribeToActiveMonth();
    navigate(currentSection);
}

async function leaveHousehold(id) {
    const hh = userHouseholds.find(h => h.id === id);
    if (!confirm(`Leave "${hh?.name || 'this household'}"?\nYou will need the invite code to re-join.`)) return;
    const batch = db.batch();
    batch.update(db.collection('households').doc(id), {
        members: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
    });
    batch.update(db.collection('users').doc(currentUser.uid), {
        households: firebase.firestore.FieldValue.arrayRemove(id),
    });
    await batch.commit();
    userHouseholds = userHouseholds.filter(h => h.id !== id);
    if (currentHouseholdId === id) {
        currentHouseholdId   = null;
        currentHouseholdData = null;
        state.data           = {};
        if (userHouseholds.length > 0) { await switchHousehold(userHouseholds[0].id); }
        else { hideHouseholdPanel(); updateHouseholdUI(); showHouseholdSetup(); }
    } else {
        renderHouseholdList();
    }
}

/* ============================================================
   HOUSEHOLD – UI
   ============================================================ */
function showHouseholdSetup() { document.getElementById('householdOverlay').classList.remove('hidden'); }
function hideHouseholdSetup() { document.getElementById('householdOverlay').classList.add('hidden'); }
function showHouseholdPanel() { renderHouseholdList(); document.getElementById('hhPanelOverlay').classList.remove('hidden'); }
function hideHouseholdPanel() { document.getElementById('hhPanelOverlay').classList.add('hidden'); }

function updateHouseholdUI() {
    const box = document.getElementById('hhBox');
    if (!currentHouseholdData || !db) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    document.getElementById('hhName').textContent        = currentHouseholdData.name || 'My Household';
    document.getElementById('hhCode').textContent        = currentHouseholdData.inviteCode || '——';
    document.getElementById('hhMemberCount').textContent =
        `${(currentHouseholdData.members || []).length} member${(currentHouseholdData.members || []).length !== 1 ? 's' : ''}`;
}

function renderHouseholdList() {
    const list = document.getElementById('hhList');
    if (!userHouseholds.length) {
        list.innerHTML = '<p class="text-muted" style="padding:12px 0">You have no households yet.</p>';
        return;
    }
    list.innerHTML = userHouseholds.map(h => `
        <div class="hh-item ${h.id === currentHouseholdId ? 'active' : ''}">
            <div class="hh-item-info">
                <div class="hh-item-name">${escHtml(h.name)}</div>
                <div class="hh-item-meta">${(h.members || []).length} members · Code: <code>${h.inviteCode}</code></div>
            </div>
            <div class="hh-item-actions">
                ${h.id !== currentHouseholdId
                    ? `<button class="btn-primary hh-switch-btn" data-id="${h.id}">Switch</button>`
                    : '<span class="hh-active-label">✓ Active</span>'}
                <button class="hh-leave-btn" data-id="${h.id}">Leave</button>
            </div>
        </div>`).join('');
    list.querySelectorAll('.hh-switch-btn').forEach(btn =>
        btn.addEventListener('click', () => switchHousehold(btn.dataset.id)));
    list.querySelectorAll('.hh-leave-btn').forEach(btn =>
        btn.addEventListener('click', () => leaveHousehold(btn.dataset.id)));
}

function setHhError(msg) {
    const el = document.getElementById('hhError');
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
}
function setHhPanelError(msg) {
    const el = document.getElementById('hhPanelError');
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
}

async function finishAppStart() {
    showLoading();
    try {
        const loaded = await loadAllFromFirestore();
        if (!loaded) loadState();
    } catch (_) { loadState(); }
    hideLoading();
    updateHouseholdUI();
    subscribeToActiveMonth();
    setupApp();
}

/* ============================================================
   FIREBASE – AUTH
   ============================================================ */
function showAuth()    { document.getElementById('authOverlay').classList.remove('hidden'); }
function hideAuth()    { document.getElementById('authOverlay').classList.add('hidden'); }
function showLoading() { document.getElementById('loadingOverlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

function updateUserUI(user) {
    const ui = document.getElementById('userInfo');
    ui.classList.remove('hidden');
    const av       = document.getElementById('userAvatar');
    const fallback = document.getElementById('avatarFallback');
    av.src         = user.photoURL || '';
    av.style.display      = user.photoURL ? '' : 'none';
    fallback.textContent  = (user.displayName || user.email || '?')[0].toUpperCase();
    fallback.style.display = user.photoURL ? 'none' : 'flex';
    const name = user.displayName || user.email;
    document.getElementById('userName').textContent     = name;
    document.getElementById('avatarDropName').textContent = name;
}
function clearUserUI() { document.getElementById('userInfo').classList.add('hidden'); }

async function signInWithGoogle() {
    if (!auth) return;
    setAuthError('');
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
    } catch (e) { setAuthError(friendlyAuthError(e.code)); }
}

async function signInWithEmail(email, password, isRegister) {
    if (!auth) return;
    setAuthError('');
    try {
        if (isRegister) await auth.createUserWithEmailAndPassword(email, password);
        else            await auth.signInWithEmailAndPassword(email, password);
    } catch (e) { setAuthError(friendlyAuthError(e.code)); }
}

function friendlyAuthError(code) {
    const map = {
        'auth/invalid-email':          'Invalid email address.',
        'auth/user-not-found':         'No account found. Try creating one.',
        'auth/wrong-password':         'Incorrect password.',
        'auth/invalid-credential':     'Incorrect email or password.',
        'auth/email-already-in-use':   'An account with this email already exists.',
        'auth/weak-password':          'Password must be at least 6 characters.',
        'auth/too-many-requests':      'Too many attempts. Please wait and try again.',
        'auth/popup-closed-by-user':   'Sign-in cancelled.',
        'auth/network-request-failed': 'Network error. Check your connection.',
    };
    return map[code] || 'Sign-in failed. Please try again.';
}

function setAuthError(msg) {
    const el = document.getElementById('authError');
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
}

async function setupAuthListener() {
    if (!auth) {
        loadState();
        setupApp();
        return;
    }

    showAuth();
    const configured = !!(window.firebaseConfig && window.firebaseConfig.apiKey !== 'YOUR_API_KEY');
    document.getElementById('authSetupNote').classList.toggle('hidden', configured);

    auth.onAuthStateChanged(async user => {
        if (user) {
            currentUser = user;
            hideAuth();
            updateUserUI(user);
            showLoading();
            await loadUserHouseholds();
            let activeId = null;
            try {
                const uDoc = await db.collection('users').doc(user.uid).get();
                if (uDoc.exists) activeId = uDoc.data().activeHouseholdId;
            } catch (_) {}
            if (activeId && userHouseholds.find(h => h.id === activeId)) {
                currentHouseholdId   = activeId;
                currentHouseholdData = userHouseholds.find(h => h.id === activeId);
            } else if (userHouseholds.length > 0) {
                currentHouseholdId   = userHouseholds[0].id;
                currentHouseholdData = userHouseholds[0];
            }
            hideLoading();
            if (!currentHouseholdId) {
                setupApp();
                showHouseholdSetup();
            } else {
                await finishAppStart();
            }
        } else {
            currentUser          = null;
            currentHouseholdId   = null;
            currentHouseholdData = null;
            clearUserUI();
            if (firestoreUnsubscribeMonth) { firestoreUnsubscribeMonth(); firestoreUnsubscribeMonth = null; }
            showAuth();
        }
    });
}

/* ============================================================
   SETUP APP — runs once after sign-in (or immediately when
   Firebase is not configured)
   ============================================================ */
function setupApp() {
    /* Guard: only register DOM event listeners once across sign-in cycles */
    if (eventsRegistered) {
        if (currentHouseholdId || !auth) navigate('dashboard');
        return;
    }
    eventsRegistered = true;

    /* -- Month picker -- */
    const monthPicker = document.getElementById('activeMonth');
    monthPicker.value = state.activeMonth;
    monthPicker.addEventListener('change', e => {
        state.activeMonth = e.target.value;
        saveState();
        if (db && currentUser) subscribeToActiveMonth();
        navigate(currentSection);
    });

    /* -- Sidebar nav buttons -- */
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigate(btn.dataset.section));
    });

    /* -- "View all" link on dashboard -- */
    document.querySelectorAll('[data-goto]').forEach(btn => {
        btn.addEventListener('click', () => navigate(btn.dataset.goto));
    });

    /* -- Mobile menu toggle -- */
    document.getElementById('menuToggle').addEventListener('click', () => {
        const sb = document.getElementById('sidebar');
        sb.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

    /* -- Quick Add Transaction button (topbar) -- */
    document.getElementById('quickAddBtn').addEventListener('click', () => navigate('transactions'));
    document.getElementById('carryFromPrevBtn').addEventListener('click', carryFromPrevMonth);

    /* -- Avatar dropdown -- */
    const avatarBtn      = document.getElementById('avatarBtn');
    const avatarDropdown = document.getElementById('avatarDropdown');
    avatarBtn.addEventListener('click', e => {
        e.stopPropagation();
        avatarDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', () => avatarDropdown.classList.add('hidden'));

    /* -- Bottom nav (mobile) -- */
    document.querySelectorAll('.bnav-item').forEach(btn => {
        btn.addEventListener('click', () => navigate(btn.dataset.section));
    });

    /* -- FAB (mobile) -- */
    document.getElementById('fabAddBtn').addEventListener('click', () => navigate('transactions'));

    /* ===== BUDGET SETUP EVENTS ===== */

    /* Save income target */
    document.getElementById('saveIncomeBtn').addEventListener('click', () => {
        const val = parseFloat(document.getElementById('incomeTargetInput').value);
        if (!val || val <= 0) { toast('Enter a valid income amount', 'error'); return; }
        const md = getMonthData(state.activeMonth);
        md.incomeTarget = val;
        saveState();
        toast('Income target saved!');
        renderBudget();
    });
    document.getElementById('incomeTargetInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('saveIncomeBtn').click();
    });

    /* Add new category */
    document.getElementById('addCatBtn').addEventListener('click', () => {
        const name   = document.getElementById('catNameInp').value.trim();
        const budget = parseFloat(document.getElementById('catBudgetInp').value) || 0;
        const color  = document.getElementById('catColorInp').value;
        if (!name) { toast('Category name is required', 'error'); return; }

        const md = getMonthData(state.activeMonth);
        if (md.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
            toast('This category already exists', 'error'); return;
        }
        md.categories.push({ id: uid(), name, budget, color });
        saveState();

        document.getElementById('catNameInp').value   = '';
        document.getElementById('catBudgetInp').value = '';
        document.getElementById('catColorInp').value  = '#6366f1';
        toast(`Category "${name}" added!`);
        renderBudget();
    });
    document.getElementById('catNameInp').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addCatBtn').click(); }
    });

    /* ===== TRANSACTION FORM EVENTS ===== */

    /* Type toggle (Expense / Income) */
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTxnType = btn.dataset.type;
            document.getElementById('txnCatWrap').style.display = activeTxnType === 'expense' ? '' : 'none';
        });
    });

    /* Default date to today */
    document.getElementById('txnDate').value = new Date().toISOString().split('T')[0];

    /* Submit transaction */
    document.getElementById('txnForm').addEventListener('submit', e => {
        e.preventDefault();
        const amt  = parseFloat(document.getElementById('txnAmt').value);
        const date = document.getElementById('txnDate').value;
        const desc = document.getElementById('txnDesc').value.trim();

        if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return; }
        if (!date)            { toast('Select a date', 'error'); return; }

        const md = getMonthData(state.activeMonth);

        let catId = '__income__';
        if (activeTxnType === 'expense') {
            catId = document.getElementById('txnCat').value;
            if (!catId) { toast('Add a category in Budget Setup first', 'error'); return; }
        }

        addTransaction({ id: uid(), type: activeTxnType, amount: amt, category: catId, date, description: desc });
        toast(`${activeTxnType === 'income' ? 'Income' : 'Expense'} of ${fmtMoney(amt)} added!`);

        document.getElementById('txnAmt').value  = '';
        document.getElementById('txnDesc').value = '';
        document.getElementById('txnDate').value = new Date().toISOString().split('T')[0];

        renderTransactions();
    });

    /* Filters */
    document.getElementById('filterType').addEventListener('change', applyFilters);
    document.getElementById('filterCat').addEventListener('change',  applyFilters);

    /* ===== INITIAL RENDER ===== */
    if (currentHouseholdId || !auth) navigate('dashboard');
}

/* ============================================================
   INITIALISE
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();

    /* -- Auth UI events (always registered, even before sign-in) -- */
    document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
    document.getElementById('signOutBtn').addEventListener('click', () => auth && auth.signOut());

    /* -- Household setup overlay events -- */
    let hhSetupTab = 'create';
    document.querySelectorAll('[data-hhtab]').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('[data-hhtab]').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            hhSetupTab = tab.dataset.hhtab;
            document.getElementById('hhCreateForm').classList.toggle('hidden', hhSetupTab !== 'create');
            document.getElementById('hhJoinForm').classList.toggle('hidden', hhSetupTab !== 'join');
            setHhError('');
        });
    });
    document.getElementById('hhCreateBtn').addEventListener('click', async () => {
        const name = document.getElementById('hhNewName').value.trim();
        if (!name) { setHhError('Enter a household name.'); return; }
        const btn = document.getElementById('hhCreateBtn');
        btn.disabled = true;
        try   { await createHousehold(name); hideHouseholdSetup(); await finishAppStart(); }
        catch (e) { setHhError(e.message); }
        finally   { btn.disabled = false; }
    });
    document.getElementById('hhJoinBtn').addEventListener('click', async () => {
        const code = document.getElementById('hhJoinCode').value.trim();
        if (!code) { setHhError('Enter an invite code.'); return; }
        const btn = document.getElementById('hhJoinBtn');
        btn.disabled = true;
        try   { await joinHousehold(code); hideHouseholdSetup(); await finishAppStart(); }
        catch (e) { setHhError(e.message); }
        finally   { btn.disabled = false; }
    });
    document.getElementById('hhNewName').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('hhCreateBtn').click(); });
    document.getElementById('hhJoinCode').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('hhJoinBtn').click(); });

    /* -- Household manager panel events -- */
    document.getElementById('hhManageBtn').addEventListener('click', showHouseholdPanel);
    document.getElementById('hhPanelClose').addEventListener('click', hideHouseholdPanel);
    document.getElementById('hhPanelOverlay').addEventListener('click', e => {
        if (e.target === document.getElementById('hhPanelOverlay')) hideHouseholdPanel();
    });
    document.getElementById('hhCreateInlineBtn').addEventListener('click', async () => {
        const name = document.getElementById('hhNewNameInline').value.trim();
        if (!name) { setHhPanelError('Enter a household name.'); return; }
        try {
            await createHousehold(name);
            document.getElementById('hhNewNameInline').value = '';
            await switchHousehold(currentHouseholdId);
            toast(`Household "${name}" created!`);
        } catch (e) { setHhPanelError(e.message); }
    });
    document.getElementById('hhJoinInlineBtn').addEventListener('click', async () => {
        const code = document.getElementById('hhJoinCodeInline').value.trim();
        if (!code) { setHhPanelError('Enter an invite code.'); return; }
        try {
            await joinHousehold(code);
            document.getElementById('hhJoinCodeInline').value = '';
            await switchHousehold(currentHouseholdId);
            toast('Joined household!');
        } catch (e) { setHhPanelError(e.message); }
    });
    document.getElementById('hhCopyBtn').addEventListener('click', () => {
        const code = document.getElementById('hhCode').textContent;
        if (code && code !== '——') navigator.clipboard.writeText(code).then(() => toast('Invite code copied!'));
    });

    setupAuthListener();
});
