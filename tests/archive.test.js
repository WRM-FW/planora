import test from "node:test";
import assert from "node:assert/strict";
import { parseArchive, serializeArchive } from "../src/data/archive.js";
import { createPlan } from "../src/domain/plan.js";

function sample() {
  return [
    createPlan({ title: "背单词", date: "2026-10-08", start: "07:00", end: "07:30", priority: "medium", status: "todo", repeat: "daily" }, { id: function () { return "a"; } }),
    createPlan({ title: "健身", date: "2026-10-08", start: "19:00", end: "20:00", priority: "low", status: "done", repeat: "none" }, { id: function () { return "b"; } })
  ];
}

test("导出再导入保持内容与状态", function () {
  const text = serializeArchive(sample());
  const parsed = parseArchive(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.plans.length, 2);
  assert.equal(parsed.plans[0].title, "背单词");
  assert.equal(parsed.plans[0].repeat, "daily");
  assert.equal(parsed.plans[1].status, "done");
  assert.equal(parsed.skipped, 0);
});

test("导出的文件带应用名与版本，便于将来迁移", function () {
  const payload = JSON.parse(serializeArchive([]));
  assert.equal(payload.app, "planora");
  assert.equal(payload.version, 1);
  assert.equal(Array.isArray(payload.plans), true);
  assert.equal(typeof payload.exportedAt, "string");
});

test("非法 JSON 与缺列表都会给出可读错误", function () {
  assert.equal(parseArchive("{{{").ok, false);
  assert.match(parseArchive("{{{").error, /JSON/);
  assert.equal(parseArchive("{}").ok, false);
  assert.match(parseArchive("{}").error, /计划列表/);
  assert.equal(parseArchive("[]").ok, false);
});

test("导入时坏条目被跳过并计数", function () {
  const text = JSON.stringify({ app: "planora", version: 1, plans: [{ id: "a", title: "好" , date: "2026-10-08", start: "09:00", end: "10:00", priority: "high", status: "todo" }, { title: "坏" }] });
  const parsed = parseArchive(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.plans.length, 1);
  assert.equal(parsed.skipped, 1);
});

test("也接受裸数组格式", function () {
  const parsed = parseArchive(JSON.stringify(sample()));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.plans.length, 2);
});
