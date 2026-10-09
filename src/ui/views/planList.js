/**
 * 计划清单：卡片列表 + 两种空状态 + 行内删除确认。
 * 卡片上的信息顺序：优先级油墨条 → 完成印章 → 时间 → 标题 → 状态。
 */
import { PRIORITY_BY_ID, STATUS_LABEL } from "../../config.js";
import { formatDuration, formatDateLabel } from "../../domain/datetime.js";
import { el, icon, svgEl } from "../dom.js";

function priorityBadge(priority) {
  const meta = PRIORITY_BY_ID[priority];
  return el("span", { class: "badge badge--priority pr-" + priority, text: meta ? meta.label : "—" });
}

function stampButton(item) {
  const pressed = item.status === "done";
  return el("button", {
    class: "stamp" + (pressed ? " is-pressed" : ""),
    attrs: {
      type: "button",
      "aria-pressed": pressed ? "true" : "false",
      "aria-label": (pressed ? "取消完成：" : "标记完成：") + item.plan.title,
      title: pressed ? "取消完成" : "标记完成"
    },
    data: { action: "toggle-done", id: item.plan.id, focusKey: "stamp-" + item.plan.id }
  }, [pressed ? icon("check", { size: 15, weight: 3 }) : null]);
}

function actionRow(item) {
  return el("div", { class: "plan__actions" }, [
    el("button", {
      class: "chip chip--" + item.status,
      attrs: {
        type: "button",
        title: "点击切换状态",
        "aria-label": item.plan.title + " 当前" + STATUS_LABEL[item.status] + "，点击切换"
      },
      data: { action: "cycle-status", id: item.plan.id, focusKey: "chip-" + item.plan.id }
    }, [
      el("span", { class: "chip__dot", attrs: { "aria-hidden": "true" } }),
      el("span", { class: "chip__text", text: STATUS_LABEL[item.status] })
    ]),
    el("button", {
      class: "btn btn--icon btn--ghost",
      attrs: { type: "button", "aria-label": "编辑：" + item.plan.title, title: "编辑" },
      data: { action: "edit-plan", id: item.plan.id, focusKey: "edit-" + item.plan.id }
    }, [icon("edit", { size: 16 })]),
    el("button", {
      class: "btn btn--icon btn--ghost btn--danger",
      attrs: { type: "button", "aria-label": "删除：" + item.plan.title, title: "删除" },
      data: { action: "request-delete", id: item.plan.id, focusKey: "del-" + item.plan.id }
    }, [icon("trash", { size: 16 })])
  ]);
}

function confirmRow(item) {
  return el("div", { class: "plan__actions plan__actions--confirm" }, [
    el("span", { class: "confirm__text", text: "删除这条计划？" }),
    el("button", {
      class: "btn btn--ghost btn--sm",
      attrs: { type: "button" },
      data: { action: "cancel-delete", id: item.plan.id, focusKey: "cancel-del-" + item.plan.id }
    }, ["取消"]),
    el("button", {
      class: "btn btn--danger btn--sm",
      attrs: { type: "button" },
      data: { action: "confirm-delete", id: item.plan.id, focusKey: "confirm-del-" + item.plan.id }
    }, ["确认删除"])
  ]);
}

export function planCard(item, ctx) {
  const plan = item.plan;
  const confirming = ctx.pendingDelete === plan.id;
  const classes = ["plan", "pr-" + plan.priority];
  if (item.isDone) classes.push("is-done");
  if (item.isNow) classes.push("is-now");
  if (item.isPast) classes.push("is-past");
  if (confirming) classes.push("is-confirming");

  const badges = [priorityBadge(plan.priority)];
  if (plan.repeat === "daily") {
    badges.push(el("span", { class: "badge badge--repeat" }, [icon("repeat", { size: 12 }), el("span", { text: "每天" })]));
  }
  if (item.isNow) badges.push(el("span", { class: "badge badge--now", text: "NOW · 进行中" }));
  else if (item.isPast) badges.push(el("span", { class: "badge badge--past", text: "时段已过" }));

  const meta = [formatDuration(item.duration)];
  if (plan.repeat === "daily") meta.push("重复计划的这一天");
  if (plan.repeatUntil) meta.push("至 " + plan.repeatUntil);
  if (item.isNow) meta.push("此刻正在进行");

  return el("li", { class: classes.join(" "), data: { id: plan.id } }, [
    el("span", { class: "plan__ink", attrs: { "aria-hidden": "true" } }),
    stampButton(item),
    el("div", { class: "plan__body" }, [
      el("div", { class: "plan__top" }, [
        el("span", { class: "plan__time", text: plan.start + " – " + plan.end })
      ].concat(badges)),
      el("h3", { class: "plan__title", text: plan.title }),
      el("p", { class: "plan__meta", text: meta.join(" · ") })
    ]),
    confirming ? confirmRow(item) : actionRow(item)
  ]);
}

function emptyArt() {
  return svgEl("svg", {
    class: "empty__art",
    viewBox: "0 0 240 120",
    width: 240,
    height: 120,
    "aria-hidden": "true",
    focusable: "false"
  }, [
    svgEl("circle", { cx: 120, cy: 96, r: 76, class: "art-ring" }),
    svgEl("circle", { cx: 120, cy: 96, r: 54, class: "art-ring" }),
    svgEl("circle", { cx: 120, cy: 96, r: 32, class: "art-ring" }),
    svgEl("circle", { cx: 120, cy: 96, r: 15, class: "art-sun" }),
    svgEl("path", { d: "M84 96 L92 72 L100 96 Z", class: "art-hill" }),
    svgEl("path", { d: "M140 96 L150 66 L160 96 Z", class: "art-hill" }),
    svgEl("path", { d: "M0 96 H240", class: "art-rule" }),
    svgEl("path", { d: "M22 110 C 62 110, 70 100, 104 100 S 160 108, 218 108", class: "art-route" })
  ]);
}

function emptyState(ctx, isFilterEmpty) {
  return el("div", { class: "empty" }, [
    emptyArt(),
    el("h3", { class: "empty__title", text: isFilterEmpty ? "这个筛选下没有计划" : formatDateLabel(ctx.dateKey) + " 还没有安排" }),
    el("p", { class: "empty__text", text: isFilterEmpty
      ? "换一个筛选，或者直接新增一条计划。"
      : "把这天的学习、工作、生活各排上一两件事，时间轴就会替你记着。" }),
    el("div", { class: "empty__actions" }, isFilterEmpty
      ? [el("button", {
        class: "btn btn--ghost",
        attrs: { type: "button" },
        data: { action: "set-filter", filter: "all", focusKey: "empty-all" }
      }, ["查看全部"])]
      : [el("button", {
        class: "btn btn--primary",
        attrs: { type: "button" },
        data: { action: "new-plan", focusKey: "empty-new" }
      }, [icon("plus", { size: 16 }), el("span", { text: "新增计划" })])])
  ]);
}

export function renderLedger(ctx) {
  const metaText = ctx.hasPlans
    ? (ctx.view.filter === "all" ? ctx.stats.total + " 条" : ctx.visible.length + " / " + ctx.stats.total + " 条")
    : "空";

  let body;
  if (!ctx.hasPlans) body = emptyState(ctx, false);
  else if (!ctx.visible.length) body = emptyState(ctx, true);
  else body = el("ul", { class: "plans" }, ctx.visible.map(function (item) { return planCard(item, ctx); }));

  return el("section", { class: "panel panel--ledger" }, [
    el("header", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: "计划清单" }),
      el("span", { class: "panel__meta", text: metaText })
    ]),
    body
  ]);
}
