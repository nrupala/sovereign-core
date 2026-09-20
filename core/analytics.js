/**
 * Sovereign Core v2.0 - Refined Analytics Engine
 * Pure, local-only analytics. No network, no telemetry.
 *
 * Consumes normalized record shapes and returns plain JSON report
 * structures that the UI renders and the exporter emits as CSV/JSON:
 *
 *   tasks:    { timestamp: number, data: { completed?: boolean, dueDate?: string } }
 *   ledger:   { timestamp: number, data: { amount: number, type: 'credit'|'debit', category?: string, classification?: 'need'|'want' } }
 *   habits:   { id: string, name: string, checkins: string[] (YYYY-MM-DD), createdAt?: number }
 *   journals: { timestamp: number }
 */

const DAY = 86400000;

/** Local YYYY-MM-DD for an epoch ms. */
export function dayKey(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
}

/** Week key: Monday-based ISO week. Returns `YYYY-Www`. */
export function weekKey(ts) {
    const d = new Date(ts);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day + 3);
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    const offset = Math.floor(((d - firstThursday) / DAY + 1) / 7) + 1;
    return `${d.getFullYear()}-W${String(offset).padStart(2, '0')}`;
}

function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

/**
 * Time-series task completion.
 * @returns {{
 *   total, done, pct,
 *   byDay: {key, created, done}[],
 *   byWeek: {key, created, done}[],
 *   weekOverWeek: {week, created, done, deltaDone}[],
 *   overdue
 * }}
 */
export function analyzeTasks(tasks = []) {
    const now = Date.now();
    const total = tasks.length;
    const done = tasks.filter(t => t.data?.completed).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const byDayMap = new Map();
    const byWeekMap = new Map();
    const weekOrder = [];
    for (const t of tasks) {
        const ts = num(t.timestamp);
        const dk = dayKey(ts);
        let d = byDayMap.get(dk);
        if (!d) { d = { key: dk, created: 0, done: 0 }; byDayMap.set(dk, d); }
        d.created += 1;
        if (t.data?.completed) d.done += 1;

        const wk = weekKey(ts);
        let w = byWeekMap.get(wk);
        if (!w) { w = { key: wk, created: 0, done: 0 }; byWeekMap.set(wk, w); weekOrder.push(wk); }
        w.created += 1;
        if (t.data?.completed) w.done += 1;
    }
    const byDay = [...byDayMap.values()].sort((a, b) => a.key < b.key ? -1 : 1);
    const byWeek = [...byWeekMap.values()].sort((a, b) => a.key < b.key ? -1 : 1);

    const weekOverWeek = byWeek.map((w, i) => {
        const prev = i > 0 ? byWeek[i - 1].done : 0;
        return {
            week: w.key,
            created: w.created,
            done: w.done,
            deltaDone: w.done - prev
        };
    });

    const overdue = tasks.filter(t =>
        !t.data?.completed && t.data?.dueDate && new Date(t.data.dueDate).getTime() < Date.now()
    ).length;

    return { total, done, pct, byDay, byWeek, weekOverWeek, overdue };
}

/**
 * Normalize a checkin value to a local YYYY-MM-DD key.
 * Accepts ISO strings ("2026-09-17") and Date#toDateString() output
 * ("Thu Sep 17 2026"). Returns null for unparseable values.
 */
export function normalizeCheckin(ck) {
    if (typeof ck !== 'string') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(ck)) return ck;
    const d = new Date(ck);
    return Number.isNaN(d.getTime()) ? null : dayKey(d.getTime());
}

const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Habit consistency: per-habit completion rate and a day-of-week heatmap.
 * Per-weekday consistency is measured over a rolling 13-week window so the
 * heatmap reflects recent behavior, not all-time totals.
 * @returns {{ habits: {id,name,ratePct,streak,checkinCount}[],
 *            heatmap: {day:0..6, name, habits:{id,name,ratePct}[]} } }
 */
export function analyzeHabits(habits = [], asOf = new Date()) {
    const heatmap = DOW_NAMES.map((name, day) => ({ day, name, habits: [] }));
    const todayMidnight = new Date(asOf.getTime());
    todayMidnight.setHours(0, 0, 0, 0);

    const outHabits = habits.map(h => {
        const checkins = h.checkins || [];
        const normalized = new Set();
        for (const ck of checkins) {
            const key = normalizeCheckin(ck);
            if (key) normalized.add(key);
        }
        const keys = [...normalized];

        // Current streak (consecutive days ending today or yesterday).
        let streak = 0;
        const cursor = new Date(todayMidnight);
        if (!keys.includes(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
        while (keys.includes(dayKey(cursor.getTime()))) {
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
        }

        // Rolling window: last 13 Mondays -> move epoch so M..S cycles align.
        const windowStart = new Date(todayMidnight);
        windowStart.setDate(windowStart.getDate() - (13 * 7 - 1));
        const perDowDays = new Array(7).fill(0);   // eligible days in window per weekday
        const perDowHits = new Array(7).fill(0);   // hit days in window per weekday
        for (let off = 0; off < 13 * 7; off++) {
            const d = new Date(windowStart.getTime() + off * DAY);
            const dow = (d.getDay() + 6) % 7;
            perDowDays[dow] += 1;
            if (keys.includes(dayKey(d.getTime()))) perDowHits[dow] += 1;
        }

        const ratePct = h.createdAt
            ? Math.round((keys.length / Math.max(1, Math.floor((asOf.getTime() - h.createdAt) / DAY))) * 100)
            : 0;

        for (let dow = 0; dow < 7; dow++) {
            const r = perDowDays[dow] > 0 ? Math.round((perDowHits[dow] / perDowDays[dow]) * 100) : 0;
            heatmap[dow].habits.push({ id: h.id, name: h.name, ratePct: Math.min(100, r) });
        }
        return { id: h.id, name: h.name, ratePct, streak, checkinCount: keys.length };
    });

    return { habits: outHabits, heatmap };
}

/**
 * Spending trends: per-week and per-category totals, needs/wants split.
 * @returns {{ totals:{spent, earned, needs, wants},
 *            byWeek: {key, spent, earned}[],
 *            byCategory: {category, spent}[],
 *            weekOverWeek: {week, spent, deltaSpent}[],
 *            needsPct, wantsPct } }
 */
export function analyzeSpending(ledger = []) {
    const byWeekMap = new Map();
    const byCatMap = new Map();
    const weekOrder = [];
    let spent = 0, earned = 0, needs = 0, wants = 0;

    for (const l of ledger) {
        const amount = Math.abs(num(l.data?.amount));
        const type = l.data?.type === 'credit' ? 'credit' : 'debit';
        const wk = weekKey(num(l.timestamp));
        let w = byWeekMap.get(wk);
        if (!w) { w = { key: wk, spent: 0, earned: 0 }; byWeekMap.set(wk, w); weekOrder.push(wk); }
        if (type === 'credit') {
            earned += amount;
            w.earned += amount;
        } else {
            spent += amount;
            w.spent += amount;
            const cat = l.data?.category || 'general';
            byCatMap.set(cat, (byCatMap.get(cat) || 0) + amount);
            if (l.data?.classification === 'want') wants += amount;
            else needs += amount;
        }
    }

    const byWeek = [...byWeekMap.values()].sort((a, b) => a.key < b.key ? -1 : 1);
    const weekOverWeek = byWeek.map((w, i) => ({
        week: w.key,
        spent: w.spent,
        deltaSpent: i > 0 ? w.spent - byWeek[i - 1].spent : 0
    }));
    const byCategory = [...byCatMap.entries()].map(([category, value]) => ({ category, spent: value }))
        .sort((a, b) => b.spent - a.spent);
    const wantsPct = spent > 0 ? Math.round((wants / spent) * 100) : 0;
    return {
        totals: { spent, earned, needs, wants },
        byWeek,
        byCategory,
        weekOverWeek,
        needsPct: 100 - wantsPct,
        wantsPct
    };
}

/**
 * Productivity patterns: completion distribution by hour-of-day and day-of-week.
 * @returns {{ byHour: {hour, done}[],
 *            byDow: {day, name, done}[],
 *            journalPerWeek: {key, count}[] } }
 */
export function analyzeProductivity(tasks = [], journals = []) {
    const byHour = new Array(24).fill(0);
    for (const t of tasks) {
        if (!t.data?.completed) continue;
        const h = new Date(num(t.timestamp)).getHours();
        byHour[h] += 1;
    }
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const byDow = names.map((name, i) => ({ day: i, name, done: 0 }));
    for (const t of tasks) {
        if (!t.data?.completed) continue;
        const dow = (new Date(num(t.timestamp)).getDay() + 6) % 7;
        byDow[dow].done += 1;
    }
    const wp = new Map();
    for (const j of journals) {
        const wk = weekKey(num(j.timestamp));
        wp.set(wk, (wp.get(wk) || 0) + 1);
    }
    const journalPerWeek = [...wp.entries()].map(([key, count]) => ({ key, count }))
        .sort((a, b) => a.key < b.key ? -1 : 1);
    return { byHour, byDow, journalPerWeek };
}

/**
 * Build the full analytics report for one vault.
 * Caller supplies items (SovereignCore records) and habit checkins.
 * Returns a serializable object ready for CSV/JSON export.
 */
export function buildReport({ items = [], habitCheckins = {} }) {
    const tasks = items.filter(i => i.type === 'task');
    const ledger = items.filter(i => i.type === 'ledger');
    const journals = items.filter(i => i.type === 'journal');
    const habitList = items.filter(i => i.type === 'habit').map(h => ({
        id: h.id, name: h.data?.name || h.name || h.id,
        checkins: habitCheckins[h.id] || [], createdAt: h.timestamp
    }));
    return {
        generatedAt: Date.now(),
        version: 2,
        tasks: analyzeTasks(tasks),
        habits: analyzeHabits(habitList),
        spending: analyzeSpending(ledger),
        productivity: analyzeProductivity(tasks, journals)
    };
}

/** Flat CSV export of the report's numeric series. */
export function exportCSV(report) {
    const rows = ['section,key,metric,value'];

    const series = (section, arr, metrics) => {
        for (const row of arr) {
            for (const m of metrics) rows.push(`${section},${row.key ?? row.hour ?? row.day ?? row.name ?? row.id ?? ''},${m},${row[m] ?? ''}`);
        }
    };

    rows.push(`task_total,,count,${report.tasks.total}`);
    rows.push(`task_done,,count,${report.tasks.done}`);
    rows.push(`task_pct,,pct,${report.tasks.pct}`);
    rows.push(`task_overdue,,count,${report.tasks.overdue}`);
    series('task_day', report.tasks.byDay, ['created', 'done']);
    series('task_week', report.tasks.byWeek, ['created', 'done']);
    series('task_delta', report.tasks.weekOverWeek, ['deltaDone']);

    for (const h of report.habits.habits) {
        rows.push(`habit_${h.id},,ratePct,${h.ratePct}`);
        rows.push(`habit_${h.id},,streak,${h.streak}`);
        rows.push(`habit_${h.id},,checkins,${h.checkinCount}`);
    }

    rows.push(`spend_spent,,sum,${report.spending.totals.spent.toFixed(2)}`);
    rows.push(`spend_earned,,sum,${report.spending.totals.earned.toFixed(2)}`);
    rows.push(`spend_needs,,sum,${report.spending.totals.needs.toFixed(2)}`);
    rows.push(`spend_wants,,sum,${report.spending.totals.wants.toFixed(2)}`);
    series('spend_week', report.spending.byWeek, ['spent', 'earned']);
    series('spend_delta', report.spending.weekOverWeek, ['deltaSpent']);
    series('spend_category', report.spending.byCategory, ['spent']);

    for (const h of report.productivity.byHour) rows.push(`prod_hour,${h.hour},done,${h.done}`);
    for (const d of report.productivity.byDow) rows.push(`prod_dow,${d.name},done,${d.done}`);
    series('journal_week', report.productivity.journalPerWeek, ['count']);

    return rows.join('\n');
}

/** JSON export of the report. */
export function exportJSON(report) {
    return JSON.stringify(report, null, 2);
}