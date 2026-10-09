import test from "node:test";
import assert from "node:assert/strict";
import { createPlanStore } from "../src/data/planStore.js";
import { createMemoryStorage } from "../src/data/storage.js";

const FIXED = new Date(2026, 9, 8, 9, 0);
const DATA_KEY = "planora/plans/v1";

function ids() {
  let n = 0;
  return function () { n += 1; return "plan-" + n; };
}

function makeStore(storage) {
  return createPlanStore({ storage: storage, now: function () { return FIXED; }, id: ids() });
}

const INPUT = {
  title: "写周报", date: "2026-10-08", start: "09:00", end: "10:00",
  priority: "high", status: "todo", repeat: "none", repeatUntil: null
};

test("新增会写穿到存储，重开也还在", function () {
  const storage = createMemoryStorage();
  const store = makeStore(storage);
  const plan = store.add(INPUT);
  assert.equal(store.getPlans().length, 1);

  const reopened = makeStore(storage);
  assert.equal(reopened.getPlans().length, 1);
  assert.equal(reopened.getPlans()[0].title, "写周报");
  assert.equal(reopened.getPlans()[0].id, plan.id);
});

test("校验失败不会污染已有数据", function () {
  const store = makeStore(createMemoryStorage());
  assert.throws(function () { store.add(Object.assign({}, INPUT, { title: "" })); });
  assert.equal(store.getPlans().length, 0);
});

test("编辑与删除", function () {
  const store = makeStore(createMemoryStorage());
  const plan = store.add(INPUT);
  const updated = store.update(plan.id, { title: "写月报", priority: "low" });
  assert.equal(updated.title, "写月报");
  assert.equal(updated.priority, "low");
  assert.equal(store.update("missing", { title: "x" }), null);
  assert.equal(store.remove("missing"), false);
  assert.equal(store.remove(plan.id), true);
  assert.equal(store.getPlans().length, 0);
});

test("订阅者会收到每次改动", function () {
  const store = makeStore(createMemoryStorage());
  const seen = [];
  const off = store.subscribe(function (payload) { seen.push(payload.change ? payload.change.type : "init"); });
  const plan = store.add(INPUT);
  store.update(plan.id, { title: "改一下" });
  store.remove(plan.id);
  off();
  store.add(INPUT);
  assert.deepEqual(seen, ["add", "update", "remove"]);
});

test("一次性计划改状态就是改自己", function () {
  const store = makeStore(createMemoryStorage());
  const plan = store.add(INPUT);
  store.setStatus(plan.id, "2026-10-08", "done");
  assert.equal(store.find(plan.id).status, "done");
  assert.deepEqual(store.find(plan.id).overrides, {});
});

test("重复计划的状态永远写成当天覆盖值，不动系列默认值", function () {
  const store = makeStore(createMemoryStorage());
  const plan = store.add(Object.assign({}, INPUT, { repeat: "daily", date: "2026-10-05", status: "todo" }));

  store.setStatus(plan.id, "2026-10-08", "done");
  const after = store.find(plan.id);
  assert.equal(after.status, "todo", "系列默认状态不能被某一天改掉");
  assert.equal(after.overrides["2026-10-08"], "done");
  assert.equal(after.overrides["2026-10-05"], undefined);
});

test("重复计划可以逐天勾选完成，互不影响", function () {
  const store = makeStore(createMemoryStorage());
  const plan = store.add(Object.assign({}, INPUT, { repeat: "daily", date: "2026-10-05" }));

  store.toggleDone(plan.id, "2026-10-08");
  store.toggleDone(plan.id, "2026-10-06");
  store.toggleDone(plan.id, "2026-10-06");
  const after = store.find(plan.id);
  assert.equal(after.overrides["2026-10-08"], "done");
  assert.equal(after.overrides["2026-10-06"], undefined, "取消后覆盖值应被清掉");
});

test("覆盖值等于系列默认值时不留下冗余", function () {
  const store = makeStore(createMemoryStorage());
  const plan = store.add(Object.assign({}, INPUT, { repeat: "daily", date: "2026-10-05" }));
  store.setStatus(plan.id, "2026-10-08", "done");
  store.setStatus(plan.id, "2026-10-08", "todo");
  assert.deepEqual(store.find(plan.id).overrides, {});
});

test("cycleStatus 走 未开始 → 进行中 → 已完成 → 未开始", function () {
  const store = makeStore(createMemoryStorage());
  const plan = store.add(INPUT);
  assert.equal(store.cycleStatus(plan.id, plan.date).status, "doing");
  assert.equal(store.cycleStatus(plan.id, plan.date).status, "done");
  assert.equal(store.cycleStatus(plan.id, plan.date).status, "todo");
});

test("存档里个别坏数据只丢自己，好数据照常载入", function () {
  const storage = createMemoryStorage();
  storage.setItem(DATA_KEY, JSON.stringify({
    version: 1,
    plans: [Object.assign({ id: "good" }, INPUT), { id: "bad", title: "缺字段" }]
  }));
  const store = makeStore(storage);
  assert.equal(store.getPlans().length, 1);
  assert.equal(store.getPlans()[0].id, "good");
  assert.equal(store.getReadStatus(), "ok");
});

test("存储不可用时仍可操作，但会报告持久化失败", function () {
  const store = createPlanStore({ storage: null, now: function () { return FIXED; }, id: ids() });
  assert.equal(store.isPersistent(), false);
  store.add(INPUT);
  assert.equal(store.getPlans().length, 1);
  assert.equal(store.getPersistError(), "storage-unavailable");
});

test("replaceAll 覆盖式写入（导入备份用）", function () {
  const store = makeStore(createMemoryStorage());
  store.add(INPUT);
  const count = store.replaceAll([
    Object.assign({ id: "x1" }, INPUT, { title: "导入一" }),
    { title: "坏的" }
  ]);
  assert.equal(count, 1);
  assert.equal(store.getPlans().length, 1);
  assert.equal(store.getPlans()[0].title, "导入一");
});
