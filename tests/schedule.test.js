import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDayView, computeWindow, countByFilter, filterOccurrences,
  packLanes, resolveInterval, sortOccurrences, summarize
} from "../src/domain/schedule.js";

function plan(over) {
  return Object.assign({
    id: "p", title: "任务", date: "2026-10-08", start: "09:00", end: "10:00",
    priority: "medium", status: "todo", repeat: "none", repeatUntil: null, overrides: {}
  }, over);
}

function occ(over) {
  return { id: over.id || "p", plan: plan(over), dateKey: over.dateKey || "2026-10-08", status: over.status || "todo", isRepeat: false };
}

test("summarize 统计数量与完成率（四舍五入）", function () {
  const stats = summarize([
    occ({ id: "1", status: "done" }),
    occ({ id: "2", status: "doing" }),
    occ({ id: "3", status: "todo" }),
    occ({ id: "4", status: "done" })
  ]);
  assert.equal(stats.total, 4);
  assert.equal(stats.done, 2);
  assert.equal(stats.doing, 1);
  assert.equal(stats.todo, 1);
  assert.equal(stats.open, 2);
  assert.equal(stats.rate, 50);
});

test("summarize 在空列表上不除零", function () {
  assert.deepEqual(summarize([]), { total: 0, done: 0, doing: 0, todo: 0, open: 0, rate: 0 });
});

test("完成率取整到个位", function () {
  assert.equal(summarize([occ({ id: "1", status: "done" }), occ({ id: "2" }), occ({ id: "3" })]).rate, 33);
});

test("sortOccurrences 先按开始时间，再按优先级", function () {
  const list = [
    occ({ id: "late", start: "14:00" }),
    occ({ id: "early-low", start: "09:00", priority: "low" }),
    occ({ id: "early-high", start: "09:00", priority: "high" })
  ];
  assert.deepEqual(sortOccurrences(list).map(function (o) { return o.id; }), ["early-high", "early-low", "late"]);
});

test("filterOccurrences 支持 全部 / 未完成 / 已完成", function () {
  const list = [occ({ id: "1" }), occ({ id: "2", status: "doing" }), occ({ id: "3", status: "done" })];
  assert.equal(filterOccurrences(list, "all").length, 3);
  assert.deepEqual(filterOccurrences(list, "open").map(function (o) { return o.id; }), ["1", "2"]);
  assert.deepEqual(filterOccurrences(list, "done").map(function (o) { return o.id; }), ["3"]);
});

test("countByFilter 给出三个筛选的角标数字", function () {
  const counts = countByFilter([occ({ id: "1" }), occ({ id: "2", status: "done" })]);
  assert.deepEqual(counts, { all: 2, open: 1, done: 1 });
});

test("packLanes 让重叠的计划各占一列，不重叠的共用一列", function () {
  const overlap = packLanes([occ({ id: "a", start: "09:00", end: "10:00" }), occ({ id: "b", start: "09:30", end: "10:30" })]);
  assert.equal(overlap.laneCount, 2);
  assert.deepEqual(overlap.items.map(function (i) { return i.lane; }), [0, 1]);

  const touching = packLanes([occ({ id: "a", start: "09:00", end: "10:00" }), occ({ id: "b", start: "10:00", end: "11:00" })]);
  assert.equal(touching.laneCount, 1);
  assert.deepEqual(touching.items.map(function (i) { return i.lane; }), [0, 0]);
});

test("packLanes 保留真实时长，只对非法区间兜底", function () {
  // 真实的 5 分钟不能算成 15 分钟，否则会影响泳道判断；视觉上的最小高度由视图层处理。
  const short = packLanes([occ({ id: "a", start: "09:00", end: "09:05" })]);
  assert.equal(short.items[0].duration, 5);
  assert.equal(short.items[0].end, 545);

  // 结束不晚于开始属于兜底场景（正常数据在校验层就被拦住了）
  const degenerate = packLanes([occ({ id: "b", start: "09:00", end: "09:00" })]);
  assert.equal(degenerate.items[0].duration, 15);
});

test("computeWindow 默认 06–22，越界时扩边但不超过 24 点", function () {
  assert.deepEqual(computeWindow([]), { startHour: 6, endHour: 22, startMinutes: 360, endMinutes: 1320 });
  const early = computeWindow(packLanes([occ({ id: "a", start: "05:30", end: "06:30" })]).items);
  assert.equal(early.startHour, 5);
  const late = computeWindow(packLanes([occ({ id: "a", start: "23:00", end: "23:45" })]).items);
  assert.equal(late.endHour, 24);
});

test("buildDayView 打出「现在进行中」与「时段已过」", function () {
  const now = new Date(2026, 9, 8, 10, 0);
  const view = buildDayView({
    plans: [plan({ id: "now", start: "09:30", end: "11:00" }), plan({ id: "past", start: "07:00", end: "08:00" })],
    dateKey: "2026-10-08",
    filter: "all",
    now: now
  });
  const byId = {};
  view.all.forEach(function (o) { byId[o.id] = o; });
  assert.equal(view.isToday, true);
  assert.equal(byId.now.isNow, true);
  assert.equal(byId.past.isPast, true);
  assert.equal(view.current.id, "now");
  assert.equal(view.clock.label, "10:00");
});

test("buildDayView 不把已完成的计划算作进行中", function () {
  const now = new Date(2026, 9, 8, 10, 0);
  const view = buildDayView({ plans: [plan({ id: "x", status: "done", start: "09:00", end: "11:00" })], dateKey: "2026-10-08", now: now });
  assert.equal(view.all[0].isNow, false);
  assert.equal(view.current, null);
});

test("buildDayView 查看其它日期时不显示「现在」", function () {
  const now = new Date(2026, 9, 8, 10, 0);
  const view = buildDayView({
    plans: [plan({ id: "x", date: "2026-10-07", start: "09:30", end: "11:00" })],
    dateKey: "2026-10-07",
    now: now
  });
  assert.equal(view.isToday, false);
  assert.equal(view.all.length, 1);
  assert.equal(view.all[0].isNow, false);
  assert.equal(view.all[0].isPast, false);
  assert.equal(view.current, null);

  // 当天没有计划的那一天就是空的
  assert.equal(buildDayView({ plans: [plan({ id: "x" })], dateKey: "2026-10-02", now: now }).all.length, 0);
});

test("buildDayView 尊重筛选并把角标数字算全", function () {
  const now = new Date(2026, 9, 8, 10, 0);
  const view = buildDayView({
    plans: [plan({ id: "1", start: "09:00", end: "10:00" }), plan({ id: "2", status: "done", start: "14:00", end: "15:00" })],
    dateKey: "2026-10-08", filter: "done", now: now
  });
  assert.equal(view.hasPlans, true);
  assert.equal(view.visible.length, 1);
  assert.equal(view.visible[0].id, "2");
  assert.deepEqual(view.counts, { all: 2, open: 1, done: 1 });
  assert.equal(view.laneCount, 1);
});

test("buildDayView 的每一项都带真实时长（时间轴高度与卡片时长都靠它）", function () {
  const now = new Date(2026, 9, 8, 10, 0);
  const view = buildDayView({
    plans: [plan({ id: "a", start: "09:00", end: "10:30" }), plan({ id: "b", start: "14:00", end: "14:45" })],
    dateKey: "2026-10-08", now: now
  });
  const byId = {};
  view.all.forEach(function (o) { byId[o.id] = o; });
  assert.equal(byId.a.duration, 90);
  assert.equal(byId.a.start, 540);
  assert.equal(byId.a.end, 630);
  assert.equal(byId.b.duration, 45);
  assert.equal(view.all.length, 2);
});

test("resolveInterval 对非法区间兜底，绝不产出 NaN", function () {
  assert.deepEqual(resolveInterval({ start: "09:00", end: "10:00" }), { start: 540, end: 600, duration: 60 });
  assert.deepEqual(resolveInterval({ start: "09:00", end: "09:00" }), { start: 540, end: 555, duration: 15 });
  assert.equal(Number.isFinite(resolveInterval({ start: "??", end: "??" }).duration), true);
});

test("buildDayView 空的一天", function () {
  const view = buildDayView({ plans: [], dateKey: "2026-10-08", now: new Date(2026, 9, 8, 10, 0) });
  assert.equal(view.hasPlans, false);
  assert.equal(view.visible.length, 0);
  assert.equal(view.stats.rate, 0);
});
