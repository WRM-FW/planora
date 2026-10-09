/**
 * 计划仓储：唯一允许改动 plans 的地方。
 * 每次改动都写穿到存储（write-through）并广播给订阅者，UI 不需要自己判断何时保存。
 */
import { DATA_KEY, LEGACY_DATA_KEYS, SCHEMA_VERSION } from "../config.js";
import { createPlan, applyPatch, normalizePlan, toggleDone as toggleDoneStatus, nextStatus } from "../domain/plan.js";
import { statusOn } from "../domain/recurrence.js";
import { createJsonStore, READ_STATUS } from "./storage.js";

export function createPlanStore(options) {
  const opts = options || {};
  const now = opts.now || function () { return new Date(); };
  const deps = { now: now, id: opts.id };
  const persistence = opts.persistence || createJsonStore({
    legacyKeys: LEGACY_DATA_KEYS,
    key: DATA_KEY,
    storage: opts.storage,
    version: SCHEMA_VERSION,
    migrations: opts.migrations
  });

  const listeners = new Set();
  let plans = [];
  let lastError = null;

  const initial = persistence.read();
  const readStatus = initial.status;
  if (initial.data && Array.isArray(initial.data.plans)) {
    plans = initial.data.plans
      .map(function (raw) { return normalizePlan(raw, deps); })
      .filter(function (plan) { return !!plan; });
  }
  if (readStatus === READ_STATUS.MIGRATED) persistence.write({ plans: plans });

  function snapshot() {
    return plans.slice();
  }

  function emit(change) {
    const payload = {
      plans: snapshot(),
      change: change || null,
      readStatus: readStatus,
      persistError: lastError
    };
    listeners.forEach(function (fn) { fn(payload); });
  }

  function persist() {
    const result = persistence.write({ plans: plans });
    lastError = result.ok ? null : result.error;
  }

  function commit(change) {
    persist();
    emit(change);
  }

  function indexOf(planId) {
    for (let i = 0; i < plans.length; i += 1) {
      if (plans[i].id === planId) return i;
    }
    return -1;
  }

  function find(planId) {
    const i = indexOf(planId);
    return i < 0 ? null : plans[i];
  }

  function replaceAt(index, plan) {
    plans = plans.slice();
    plans[index] = plan;
  }

  /**
   * 设置某一天的状态。
   * 重复计划永远写成「当天覆盖值」，绝不改系列默认状态，
   * 否则完成一天会让整段日程都变成已完成。
   */
  function setStatus(planId, dateKey, status) {
    const i = indexOf(planId);
    if (i < 0) return null;
    const plan = plans[i];
    const stamp = now().toISOString();
    let next;

    if (plan.repeat === "daily") {
      const overrides = Object.assign({}, plan.overrides);
      if (status === plan.status) delete overrides[dateKey];
      else overrides[dateKey] = status;
      next = Object.assign({}, plan, { overrides: overrides, updatedAt: stamp });
    } else {
      next = Object.assign({}, plan, { status: status, updatedAt: stamp });
    }

    replaceAt(i, next);
    commit({ type: "status", id: planId, dateKey: dateKey, status: status });
    return next;
  }

  function toggleDone(planId, dateKey) {
    const plan = find(planId);
    if (!plan) return null;
    return setStatus(planId, dateKey, toggleDoneStatus(statusOn(plan, dateKey)));
  }

  function cycleStatus(planId, dateKey) {
    const plan = find(planId);
    if (!plan) return null;
    return setStatus(planId, dateKey, nextStatus(statusOn(plan, dateKey)));
  }

  function replaceAll(rawList) {
    plans = (rawList || [])
      .map(function (raw) { return normalizePlan(raw, deps); })
      .filter(function (plan) { return !!plan; });
    commit({ type: "replace", count: plans.length });
    return plans.length;
  }

  return {
    getPlans: snapshot,
    getReadStatus: function () { return readStatus; },
    getPersistError: function () { return lastError; },
    isPersistent: function () {
      return typeof persistence.isPersistent === "function" ? persistence.isPersistent() : persistence.available();
    },
    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    find: find,
    add: function (input) {
      const plan = createPlan(input, deps);
      plans = plans.concat([plan]);
      commit({ type: "add", id: plan.id });
      return plan;
    },
    update: function (planId, patch) {
      const i = indexOf(planId);
      if (i < 0) return null;
      const next = applyPatch(plans[i], patch, deps);
      replaceAt(i, next);
      commit({ type: "update", id: planId });
      return next;
    },
    remove: function (planId) {
      if (indexOf(planId) < 0) return false;
      plans = plans.filter(function (plan) { return plan.id !== planId; });
      commit({ type: "remove", id: planId });
      return true;
    },
    setStatus: setStatus,
    toggleDone: toggleDone,
    cycleStatus: cycleStatus,
    replaceAll: replaceAll
  };
}
