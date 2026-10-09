import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPatch, createPlan, isDone, isOpen, isRepeating, nextStatus,
  normalizePlan, pickEditable, priorityRank, toggleDone, validatePlanInput
} from "../src/domain/plan.js";

const FIXED_NOW = new Date(2026, 9, 8, 9, 0);

function deps() {
  return {
    now: function () { return FIXED_NOW; },
    id: (function () { let n = 0; return function () { n += 1; return "plan-" + n; }; })()
  };
}

const VALID = {
  title: "复习线性代数",
  date: "2026-10-08",
  start: "09:00",
  end: "10:30",
  priority: "high",
  status: "todo",
  repeat: "none",
  repeatUntil: null
};

test("validatePlanInput 通过合法输入", function () {
  const result = validatePlanInput(VALID);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
});

test("validatePlanInput 逐字段报错", function () {
  assert.equal(validatePlanInput(Object.assign({}, VALID, { title: "   " })).errors.title, "请填写计划标题");
  assert.match(validatePlanInput(Object.assign({}, VALID, { title: "字".repeat(61) })).errors.title, /最多 60/);
  assert.equal(validatePlanInput(Object.assign({}, VALID, { date: "2026-02-30" })).errors.date, "请选择日期");
  assert.equal(validatePlanInput(Object.assign({}, VALID, { start: "9:00" })).errors.start, "开始时间格式为 HH:MM");
  assert.equal(validatePlanInput(Object.assign({}, VALID, { end: "08:00" })).errors.end, "结束时间要晚于开始时间");
  assert.equal(validatePlanInput(Object.assign({}, VALID, { end: "09:00" })).errors.end, "结束时间要晚于开始时间");
  assert.equal(validatePlanInput(Object.assign({}, VALID, { priority: "urgent" })).errors.priority, "请选择优先级");
  assert.equal(validatePlanInput(Object.assign({}, VALID, { repeat: "weekly" })).errors.repeat, "重复方式无效");
});

test("每日重复的截止日期必须不早于开始日期", function () {
  const bad = validatePlanInput(Object.assign({}, VALID, { repeat: "daily", repeatUntil: "2026-10-01" }));
  assert.equal(bad.errors.repeatUntil, "截止日期不能早于开始日期");
  const badFormat = validatePlanInput(Object.assign({}, VALID, { repeat: "daily", repeatUntil: "10/20" }));
  assert.equal(badFormat.errors.repeatUntil, "重复截止日期无效");
  const good = validatePlanInput(Object.assign({}, VALID, { repeat: "daily", repeatUntil: "2026-10-20" }));
  assert.equal(good.ok, true);
});

test("createPlan 整理输入并补齐 id / overrides / 时间戳", function () {
  const plan = createPlan(Object.assign({}, VALID, { title: "  写周报  " }), deps());
  assert.equal(plan.title, "写周报");
  assert.equal(plan.id, "plan-1");
  assert.deepEqual(plan.overrides, {});
  assert.equal(plan.createdAt, FIXED_NOW.toISOString());
  assert.equal(plan.updatedAt, FIXED_NOW.toISOString());
});

test("createPlan 抛出的错误带 fields，可直接贴回表单", function () {
  assert.throws(function () { createPlan(Object.assign({}, VALID, { start: "10:00", end: "09:00" }), deps()); },
    function (err) {
      assert.equal(err.name, "PlanValidationError");
      assert.equal(err.fields.end, "结束时间要晚于开始时间");
      return true;
    });
});

test("applyPatch 只接受白名单字段", function () {
  const plan = createPlan(VALID, deps());
  const patched = applyPatch(plan, {
    title: "改成写方案",
    id: "hacked",
    createdAt: "1999-01-01T00:00:00.000Z",
    overrides: { "2026-10-09": "done" }
  }, deps());
  assert.equal(patched.title, "改成写方案");
  assert.equal(patched.id, plan.id);
  assert.equal(patched.createdAt, plan.createdAt);
  assert.deepEqual(patched.overrides, {});
});

test("applyPatch 会重新校验", function () {
  const plan = createPlan(VALID, deps());
  assert.throws(function () { applyPatch(plan, { start: "11:00" }, deps()); }, /不合法/);
});

test("pickEditable 修剪标题并在无截止日期时置空", function () {
  assert.deepEqual(pickEditable({ title: " a ", repeatUntil: "" }), { title: "a", repeatUntil: null });
  assert.deepEqual(pickEditable({ id: "x" }), {});
});

test("normalizePlan 丢弃坏数据、保留好数据，并清洗 overrides", function () {
  assert.equal(normalizePlan(null), null);
  assert.equal(normalizePlan({ title: "x" }), null);
  const good = normalizePlan(Object.assign({}, VALID, {
    id: "keep",
    overrides: { "2026-10-09": "done", "not-a-date": "done", "2026-10-10": "bogus" }
  }), deps());
  assert.equal(good.id, "keep");
  assert.deepEqual(good.overrides, { "2026-10-09": "done" });
});

test("状态流转：下一个状态与完成勾选", function () {
  assert.equal(nextStatus("todo"), "doing");
  assert.equal(nextStatus("doing"), "done");
  assert.equal(nextStatus("done"), "todo");
  assert.equal(nextStatus("bogus"), "todo");
  assert.equal(toggleDone("doing"), "done");
  assert.equal(toggleDone("done"), "todo");
  assert.equal(isDone("done"), true);
  assert.equal(isOpen("doing"), true);
  assert.equal(isOpen("done"), false);
});

test("优先级排序与重复判断", function () {
  assert.equal(priorityRank("high"), 0);
  assert.equal(priorityRank("medium"), 1);
  assert.equal(priorityRank("low"), 2);
  assert.equal(priorityRank("unknown"), 99);
  assert.equal(isRepeating({ repeat: "daily" }), true);
  assert.equal(isRepeating({ repeat: "none" }), false);
  assert.equal(isRepeating(null), false);
});
