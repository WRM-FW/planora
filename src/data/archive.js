/**
 * 导出 / 导入：给自己留一份离开浏览器也能活的数据。
 * 格式就是存储里的载荷，导入时逐条过一遍 normalizePlan，坏数据只丢自己。
 */
import { SCHEMA_VERSION } from "../config.js";
import { normalizePlan } from "../domain/plan.js";

export function serializeArchive(plans) {
  return JSON.stringify({
    app: "planora",
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    plans: plans || []
  }, null, 2);
}

export function parseArchive(text) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "文件不是合法的 JSON", plans: [] };
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.plans) ? parsed.plans : null);
  if (!list) return { ok: false, error: "文件里没有找到计划列表", plans: [] };
  const plans = list.map(function (raw) { return normalizePlan(raw); }).filter(function (p) { return !!p; });
  if (!plans.length) return { ok: false, error: "文件里没有可用的计划", plans: [] };
  return { ok: true, error: null, plans: plans, skipped: list.length - plans.length };
}
