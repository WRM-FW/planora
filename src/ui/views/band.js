/**
 * 信息带（对应海报底部的深色信息条）：日期导航 + 日跳转 + 前后一天 + 筛选。
 * 信息顺序刻意做成「先定位哪天，再决定看什么」。
 */
import { FILTERS } from "../../config.js";
import { dayNumber, formatDateLabel, monthNumber, relativeDayLabel, weekdayLabel } from "../../domain/datetime.js";
import { el, frag, icon } from "../dom.js";

function navButton(action, focusKey, label, iconName) {
  return el("button", {
    class: "btn btn--ink btn--icon",
    attrs: { type: "button", "aria-label": label, title: label },
    data: { action: action, focusKey: focusKey }
  }, [icon(iconName, { size: 18, weight: 2.5 })]);
}

function dayTicket(ticket) {
  return el("button", {
    class: "ticket" + (ticket.isCurrent ? " is-current" : "") + (ticket.total > 0 && ticket.done === ticket.total ? " is-complete" : ""),
    attrs: {
      type: "button",
      "aria-label": ticket.label + " " + formatDateLabel(ticket.dateKey) + "，" + ticket.total + " 条计划",
      "aria-current": ticket.isCurrent ? "date" : null
    },
    data: { action: "goto-date", date: ticket.dateKey, focusKey: "ticket-" + ticket.dateKey }
  }, [
    el("span", { class: "ticket__label", text: ticket.label }),
    el("span", { class: "ticket__count", text: String(ticket.total) }),
    el("span", { class: "ticket__done", text: ticket.total ? ticket.done + "/" + ticket.total : "空" })
  ]);
}

export function renderBand(ctx) {
  const dateKey = ctx.dateKey;
  const relative = relativeDayLabel(dateKey, ctx.todayKey);

  const datestamp = el("div", { class: "datestamp" }, [
    el("span", { class: "datestamp__day", text: dayNumber(dateKey) }),
    el("span", { class: "datestamp__meta" }, [
      el("span", { class: "datestamp__month", text: monthNumber(dateKey) + "月" }),
      el("span", { class: "datestamp__weekday", text: weekdayLabel(dateKey) })
    ])
  ]);

  const nav = el("div", { class: "datenav" }, [
    navButton("prev-day", "prev", "前一天", "chevron-left"),
    datestamp,
    navButton("next-day", "next", "后一天", "chevron-right"),
    el("button", {
      class: "btn btn--ink btn--sm",
      attrs: { type: "button" },
      data: { action: "today", focusKey: "today" }
    }, [relative === "今天" ? "已是今天" : "回到今天"])
  ]);

  const jump = el("label", { class: "jump" }, [
    el("span", { class: "jump__label", text: "跳转日期" }),
    el("input", {
      class: "input input--date",
      attrs: { type: "date", value: dateKey, "aria-label": "选择要查看的日期" },
      data: { action: "jump-date", focusKey: "jump" }
    })
  ]);

  const strip = el("div", { class: "daystrip", attrs: { role: "group", "aria-label": "前一天 / 今天 / 后一天" } },
    (ctx.dayStrip || []).map(dayTicket));

  const filters = el("nav", { class: "filters", attrs: { "aria-label": "按状态筛选" } },
    FILTERS.map(function (filter) {
      const active = ctx.view.filter === filter.id;
      const count = ctx.counts ? ctx.counts[filter.id] : 0;
      return el("button", {
        class: "filter" + (active ? " is-active" : ""),
        attrs: { type: "button", "aria-pressed": active ? "true" : "false" },
        data: { action: "set-filter", filter: filter.id, focusKey: "filter-" + filter.id }
      }, [
        el("span", { class: "filter__label", text: filter.label }),
        el("span", { class: "filter__count", text: String(count) })
      ]);
    }));

  return el("div", { class: "band__rows" }, [
    el("div", { class: "band__row band__row--main" }, [nav, jump, filters]),
    el("div", { class: "band__row band__row--strip" }, [strip])
  ]);
}
