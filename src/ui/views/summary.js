/**
 * 统计区：计划数 / 已完成 / 完成率，加一条「阶梯色带」进度条。
 * 海报里渐变一律用阶梯色带代替 —— 这里沿用同一手法。
 */
import { el, frag } from "../dom.js";

const STEPS = 12;

function statBlock(label, value, unit) {
  return el("div", { class: "stat" }, [
    el("span", { class: "stat__label", text: label }),
    el("span", { class: "stat__value", text: String(value) }),
    el("span", { class: "stat__unit", text: unit })
  ]);
}

function meter(rate) {
  const filled = Math.round((rate / 100) * STEPS);
  const steps = [];
  for (let i = 0; i < STEPS; i += 1) {
    steps.push(el("span", { class: "meter__step" + (i < filled ? " is-filled" : ""), attrs: { "aria-hidden": "true" } }));
  }
  return el("div", {
    class: "meter",
    attrs: { role: "img", "aria-label": "完成率 " + rate + "%，共 " + STEPS + " 格，已填 " + filled + " 格" }
  }, steps);
}

function contextNote(ctx) {
  const stats = ctx.stats;
  if (stats.total === 0) return "今天还没有安排";
  if (stats.done === stats.total) return "今天的计划已经全部完成";
  if (ctx.current) return "正在进行：" + ctx.current.plan.title;
  const parts = [];
  if (stats.doing) parts.push("进行中 " + stats.doing + " 条");
  parts.push("未完成 " + stats.open + " 条");
  return parts.join(" · ");
}

export function renderSummary(ctx) {
  const stats = ctx.stats;
  return frag([
    el("div", { class: "summary__grid" }, [
      statBlock("当天计划", stats.total, "条"),
      statBlock("已完成", stats.done, "条"),
      el("div", { class: "stat stat--rate" }, [
        el("span", { class: "stat__label", text: "完成率" }),
        el("span", { class: "stat__value", text: String(stats.rate) }),
        el("span", { class: "stat__unit", text: "%" }),
        meter(stats.rate)
      ])
    ]),
    el("p", { class: "summary__note", text: contextNote(ctx) }),
    ctx.notice ? el("p", { class: "notice", attrs: { role: "status" }, text: ctx.notice }) : null,
    ctx.persistent ? null : el("p", { class: "notice notice--warn", attrs: { role: "status" },
      text: "浏览器本地存储不可用，这次的改动不会被保存。" })
  ]);
}
