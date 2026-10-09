/**
 * 计划实体：校验、创建、修改、状态流转。
 * 纯函数，不碰存储也不碰 DOM —— 因此可以被 node --test 直接测试。
 */
import { isValidDateKey, isValidTime, minutesFromTime } from "./datetime.js";
import { PRIORITY_IDS, PRIORITY_RANK, STATUS_IDS, REPEAT_IDS } from "../config.js";

export const TITLE_MAX = 60;

/** 可写字段白名单：patch 只能改这些，避免 UI 顺手改掉 id / 时间戳。 */
const EDITABLE_FIELDS = ["title", "date", "start", "end", "priority", "status", "repeat", "repeatUntil"];

let idSeq = 0;

export function createId(prefix) {
  idSeq += 1;
  return String(prefix || "plan") + "-" + Date.now().toString(36) + "-" +
    idSeq.toString(36) + Math.random().toString(36).slice(2, 6);
}

function makeError(errors) {
  const err = new Error("计划数据不合法");
  err.name = "PlanValidationError";
  err.fields = errors;
  return err;
}

/**
 * 校验一份计划输入。返回 { ok, errors }，errors 按字段名索引，可直接贴到表单上。
 */
export function validatePlanInput(input) {
  const src = input || {};
  const errors = {};

  const title = String(src.title == null ? "" : src.title).trim();
  if (!title) errors.title = "请填写计划标题";
  else if (title.length > TITLE_MAX) errors.title = "标题最多 " + TITLE_MAX + " 个字";

  if (!isValidDateKey(src.date)) errors.date = "请选择日期";

  const startOk = isValidTime(src.start);
  const endOk = isValidTime(src.end);
  if (!startOk) errors.start = "开始时间格式为 HH:MM";
  if (!endOk) errors.end = "结束时间格式为 HH:MM";
  if (startOk && endOk && minutesFromTime(src.end) <= minutesFromTime(src.start)) {
    errors.end = "结束时间要晚于开始时间";
  }

  if (PRIORITY_IDS.indexOf(src.priority) < 0) errors.priority = "请选择优先级";
  if (STATUS_IDS.indexOf(src.status) < 0) errors.status = "请选择状态";

  const repeat = src.repeat || "none";
  if (REPEAT_IDS.indexOf(repeat) < 0) errors.repeat = "重复方式无效";
  else if (repeat === "daily" && src.repeatUntil) {
    if (!isValidDateKey(src.repeatUntil)) errors.repeatUntil = "重复截止日期无效";
    else if (isValidDateKey(src.date) && src.repeatUntil < src.date) errors.repeatUntil = "截止日期不能早于开始日期";
  }

  return { ok: Object.keys(errors).length === 0, errors: errors };
}

/** 从任意输入里挑出可写字段，并做一次浅整理。 */
export function pickEditable(input) {
  const src = input || {};
  const out = {};
  EDITABLE_FIELDS.forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(src, field)) out[field] = src[field];
  });
  if (Object.prototype.hasOwnProperty.call(out, "title")) {
    out.title = String(out.title == null ? "" : out.title).trim();
  }
  if (Object.prototype.hasOwnProperty.call(out, "repeatUntil") && !out.repeatUntil) {
    out.repeatUntil = null;
  }
  return out;
}

export function createPlan(input, deps) {
  const d = deps || {};
  const now = d.now ? d.now() : new Date();
  const draft = Object.assign({
    title: "",
    date: "",
    start: "09:00",
    end: "10:00",
    priority: "medium",
    status: "todo",
    repeat: "none",
    repeatUntil: null
  }, pickEditable(input));

  const check = validatePlanInput(draft);
  if (!check.ok) throw makeError(check.errors);

  const stamp = now.toISOString();
  return Object.assign({}, draft, {
    id: d.id ? d.id() : createId("plan"),
    overrides: {},
    createdAt: stamp,
    updatedAt: stamp
  });
}

/** 编辑：只改白名单字段，改完仍需通过同一套校验。 */
export function applyPatch(plan, patch, deps) {
  const d = deps || {};
  const now = d.now ? d.now() : new Date();
  const merged = Object.assign({}, plan, pickEditable(patch));
  const check = validatePlanInput(merged);
  if (!check.ok) throw makeError(check.errors);
  merged.updatedAt = now.toISOString();
  return merged;
}

/**
 * 反序列化：读取 localStorage 时用。任何一条坏数据只丢弃自己，不让整份存档报废。
 */
export function normalizePlan(raw, deps) {
  const d = deps || {};
  if (!raw || typeof raw !== "object") return null;
  const draft = {
    title: String(raw.title == null ? "" : raw.title).trim(),
    date: raw.date,
    start: raw.start,
    end: raw.end,
    priority: raw.priority,
    status: raw.status,
    repeat: raw.repeat || "none",
    repeatUntil: raw.repeatUntil || null
  };
  if (!validatePlanInput(draft).ok) return null;

  const overrides = {};
  if (raw.overrides && typeof raw.overrides === "object") {
    Object.keys(raw.overrides).forEach(function (key) {
      const value = raw.overrides[key];
      if (isValidDateKey(key) && STATUS_IDS.indexOf(value) >= 0) overrides[key] = value;
    });
  }

  const stamp = new Date().toISOString();
  return Object.assign({}, draft, {
    id: typeof raw.id === "string" && raw.id ? raw.id : (d.id ? d.id() : createId("plan")),
    overrides: overrides,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : stamp,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : stamp
  });
}

/* ---------- 状态流转 ---------- */

/** 点一下换下一个状态：未开始 → 进行中 → 已完成 → 未开始。 */
export function nextStatus(status) {
  const i = STATUS_IDS.indexOf(status);
  return i < 0 ? "todo" : STATUS_IDS[(i + 1) % STATUS_IDS.length];
}

/** 完成勾选：未完成 <-> 已完成。 */
export function toggleDone(status) {
  return status === "done" ? "todo" : "done";
}

export function isDone(status) {
  return status === "done";
}

export function isOpen(status) {
  return status !== "done";
}

export function priorityRank(priority) {
  const rank = PRIORITY_RANK[priority];
  return rank == null ? 99 : rank;
}

export function isRepeating(plan) {
  return !!plan && plan.repeat === "daily";
}
