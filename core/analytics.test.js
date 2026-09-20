import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTasks, analyzeHabits, analyzeSpending, analyzeProductivity, buildReport, exportCSV, exportJSON, dayKey, weekKey, normalizeCheckin } from './analytics.js';

const NOW = new Date('2026-09-17T12:00:00').getTime();

function task(daysAgo, completed) {
    return { type: 'task', timestamp: NOW - daysAgo * 86400000, data: { completed } };
}

test('dayKey and weekKey are stable and ISO-shaped', () => {
    assert.equal(dayKey(NOW), '2026-09-17');
    assert.match(weekKey(NOW), /^\d{4}-W\d{2}$/);
});

test('normalizeCheckin accepts ISO and toDateString formats', () => {
    assert.equal(normalizeCheckin('2026-09-17'), '2026-09-17');
    assert.equal(normalizeCheckin('Thu Sep 17 2026'), '2026-09-17');
    assert.equal(normalizeCheckin('garbage'), null);
    assert.equal(normalizeCheckin(null), null);
    assert.equal(normalizeCheckin(''), null);
});

test('analyzeHabits tolerates toDateString checkins and dedupes', () => {
    const habits = [{
        id: 'h3',
        name: 'Mixed',
        checkins: ['2026-09-17', 'Thu Sep 16 2026', '2026-09-16', '2026-09-15'],
        createdAt: NOW - 30 * 86400000
    }];
    const r = analyzeHabits(habits, new Date(NOW));
    const h = r.habits.find(x => x.id === 'h3');
    assert.equal(h.checkinCount, 3, 'duplicate 16th deduped to one');
    assert.equal(h.streak, 3, '17+16+15 consecutive');
    assert.equal(r.heatmap.length, 7);
});

test('analyzeTasks computes totals, byDay, byWeek, and overdue', () => {
    const tasks = [
        { ...task(1, true), data: { completed: true } },
        { ...task(2, true), data: { completed: true } },
        { ...task(3, false), data: { completed: false, dueDate: '2026-01-01' } },
        { ...task(3, false), data: { completed: false, dueDate: '2099-01-01' } }
    ];
    const r = analyzeTasks(tasks);
    assert.equal(r.total, 4);
    assert.equal(r.done, 2);
    assert.equal(r.pct, 50);
    assert.equal(r.overdue, 1);
    assert.ok(r.byDay.length >= 2);
    assert.ok(r.byWeek.length >= 1);
    assert.ok(r.weekOverWeek[0].deltaDone >= 0);
    const days = r.byDay.reduce((s, d) => s + d.created, 0);
    assert.equal(days, 4);
});

test('analyzeTasks handles empty input', () => {
    const r = analyzeTasks([]);
    assert.deepEqual(r, {
        total: 0, done: 0, pct: 0, byDay: [], byWeek: [], weekOverWeek: [], overdue: 0
    });
});

test('analyzeHabits gives per-habit rate, streak, and a heatmap', () => {
    const today = dayKey(NOW);
    const habits = [
        { id: 'h1', name: 'Run', checkins: [today, '2026-09-16', '2026-09-15'], createdAt: NOW - 30 * 86400000 },
        { id: 'h2', name: 'Read', checkins: [], createdAt: NOW - 10 * 86400000 }
    ];
    const r = analyzeHabits(habits, new Date(NOW));
    assert.equal(r.habits.length, 2);
    const h1 = r.habits.find(h => h.id === 'h1');
    assert.equal(h1.streak, 3);
    assert.equal(h1.checkinCount, 3);
    assert.ok(h1.ratePct > 0);
    assert.equal(r.heatmap.length, 7, 'heatmap has 7 days');
    assert.equal(r.heatmap[0].habits.length, 2);
});

test('analyzeSpending splits needs/wants and builds week/category trends', () => {
    const ledger = [
        { type: 'ledger', timestamp: NOW, data: { amount: -50, type: 'debit', category: 'food', classification: 'need' } },
        { type: 'ledger', timestamp: NOW, data: { amount: -20, type: 'debit', category: 'fun', classification: 'want' } },
        { type: 'ledger', timestamp: NOW - 7 * 86400000, data: { amount: 1000, type: 'credit', category: 'salary' } }
    ];
    const r = analyzeSpending(ledger);
    assert.equal(r.totals.spent, 70);
    assert.equal(r.totals.earned, 1000);
    assert.equal(r.totals.needs, 50);
    assert.equal(r.totals.wants, 20);
    assert.equal(r.wantsPct, 29); // 20/70 rounded
    assert.equal(r.needsPct, 71);
    assert.ok(r.byWeek.length >= 1);
    assert.equal(r.byCategory[0].category, 'food');
    assert.equal(r.byCategory[0].spent, 50);
});

test('analyzeProductivity returns hourly + dow + journal series', () => {
    const tasks = [{ ...task(1, true), data: { completed: true } }, { ...task(2, false), data: { completed: false } }];
    const journals = [{ type: 'journal', timestamp: NOW }];
    const r = analyzeProductivity(tasks, journals);
    assert.equal(r.byHour.length, 24);
    assert.equal(r.byHour.reduce((s, h) => s + h, 0), 1);
    assert.equal(r.byDow.length, 7);
    const dowTotal = r.byDow.reduce((s, d) => s + d.done, 0);
    assert.equal(dowTotal, 1);
    assert.equal(r.journalPerWeek.reduce((s, j) => s + j.count, 0), 1);
});

test('buildReport composes a full report and exports CSV + JSON', () => {
    const items = [
        { type: 'task', id: 't1', timestamp: NOW, data: { completed: true, name: 'Task' } },
        { type: 'habit', id: 'ha', timestamp: NOW, data: { name: 'Habit A' } },
        { type: 'ledger', timestamp: NOW, data: { amount: -10, type: 'debit', category: 'rent', classification: 'need' } },
        { type: 'journal', timestamp: NOW }
    ];
    const report = buildReport({ items, habitCheckins: { ha: [dayKey(NOW)] } });
    assert.equal(report.tasks.total, 1);
    assert.equal(report.spending.totals.spent, 10);
    assert.equal(report.habits.habits.length, 1);
    assert.equal(report.productivity.journalPerWeek[0].count, 1);

    const csv = exportCSV(report);
    assert.ok(csv.includes('task_total,,count,1'));
    assert.ok(csv.includes('spend_spent,,sum,10.00'));
    const json = exportJSON(report);
    const parsed = JSON.parse(json);
    assert.equal(parsed.tasks.done, 1);
});