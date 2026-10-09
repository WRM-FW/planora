import test from "node:test";
import assert from "node:assert/strict";
import { occursOn, occurrencesOn, statusOn, toOccurrence } from "../src/domain/recurrence.js";

const once = { id: "a", title: "一次性", date: "2026-10-08", repeat: "none", status: "todo", overrides: {} };
const daily = {
  id: "b", title: "每天背单词", date: "2026-10-05", repeat: "daily",
  repeatUntil: "2026-10-10", status: "todo", overrides: { "2026-10-08": "done" }
};

test("一次性计划只在当天出现", function () {
  assert.equal(occursOn(once, "2026-10-08"), true);
  assert.equal(occursOn(once, "2026-10-09"), false);
});

test("每日重复计划从开始日到截止日（含）都出现", function () {
  assert.equal(occursOn(daily, "2026-10-04"), false);
  assert.equal(occursOn(daily, "2026-10-05"), true);
  assert.equal(occursOn(daily, "2026-10-10"), true);
  assert.equal(occursOn(daily, "2026-10-11"), false);
});

test("没有截止日期时一直重复", function () {
  const forever = Object.assign({}, daily, { repeatUntil: null });
  assert.equal(occursOn(forever, "2030-01-01"), true);
});

test("状态取当天覆盖值，未覆盖则用系列默认值", function () {
  assert.equal(statusOn(daily, "2026-10-08"), "done");
  assert.equal(statusOn(daily, "2026-10-09"), "todo");
  assert.equal(statusOn(once, "2026-10-08"), "todo");
});

test("一次性计划忽略 overrides（避免历史脏数据串台）", function () {
  const dirty = Object.assign({}, once, { overrides: { "2026-10-08": "done" } });
  assert.equal(statusOn(dirty, "2026-10-08"), "todo");
});

test("occurrencesOn 汇总当天所有计划", function () {
  const list = occurrencesOn([once, daily], "2026-10-08");
  assert.equal(list.length, 2);
  assert.deepEqual(list.map(function (o) { return o.status; }), ["todo", "done"]);
  assert.equal(occurrencesOn([once, daily], "2026-10-09").length, 1);
  assert.equal(occurrencesOn([once, daily], "2026-10-20").length, 0);
});

test("toOccurrence 带上是否重复与当天状态", function () {
  const o = toOccurrence(daily, "2026-10-06");
  assert.equal(o.isRepeat, true);
  assert.equal(o.status, "todo");
  assert.equal(o.plan.id, "b");
});
