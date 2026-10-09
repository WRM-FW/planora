/**
 * 每日时间安排：按真实时间比例摆放的日程条，带重叠分列与「现在」线。
 * 纯展示 + 点击进入编辑，不做拖拽（保持轻量）。
 */
import { el, frag } from "../dom.js";
import { formatDuration, pad2 } from "../../domain/datetime.js";

const PX_PER_HOUR = 58;

function hourRows(window_) {
  const rows = [];
  for (let hour = window_.startHour; hour <= window_.endHour; hour += 1) {
    const top = (hour * 60 - window_.startMinutes) * (PX_PER_HOUR / 60);
    rows.push(el("div", { class: "tl__hour", attrs: { style: "top:" + top + "px" } }, [
      el("span", { class: "tl__hourlabel", text: pad2(hour % 24) }),
      el("span", { class: "tl__rule", attrs: { "aria-hidden": "true" } })
    ]));
    if (hour < window_.endHour) {
      rows.push(el("div", {
        class: "tl__half",
        attrs: { style: "top:" + (top + PX_PER_HOUR / 2) + "px", "aria-hidden": "true" }
      }));
    }
  }
  return rows;
}

function block(item, window_, laneCount) {
  const scale = PX_PER_HOUR / 60;
  const top = (item.start - window_.startMinutes) * scale;
  const height = Math.max(24, item.duration * scale);
  const width = 100 / laneCount;
  const left = item.lane * width;
  const classes = ["tl__block", "pr-" + item.plan.priority];
  if (item.isDone) classes.push("is-done");
  if (item.isNow) classes.push("is-now");
  if (item.isPast) classes.push("is-past");
  if (height < 36) classes.push("is-compact");

  return el("button", {
    class: classes.join(" "),
    attrs: {
      type: "button",
      style: "top:" + top + "px;height:" + height + "px;left:" + left + "%;width:calc(" + width + "% - 4px)",
      "aria-label": item.plan.title + "，" + item.plan.start + " 到 " + item.plan.end + (item.isNow ? "，正在进行" : "")
    },
    data: { action: "edit-plan", id: item.plan.id, focusKey: "tl-" + item.plan.id }
  }, [
    el("span", { class: "tl__block-title", text: item.plan.title }),
    el("span", { class: "tl__block-time", text: item.plan.start + " – " + item.plan.end })
  ]);
}

function nowLine(ctx) {
  const window_ = ctx.window;
  const minutes = ctx.clock.minutes;
  if (!ctx.isToday || minutes < window_.startMinutes || minutes > window_.endMinutes) return null;
  const top = (minutes - window_.startMinutes) * (PX_PER_HOUR / 60);
  return el("div", { class: "tl__now", attrs: { style: "top:" + top + "px" } }, [
    el("span", { class: "tl__now-tag", text: "现在 " + ctx.clock.label }),
    el("span", { class: "tl__now-rule", attrs: { "aria-hidden": "true" } })
  ]);
}

export function renderTimeline(ctx) {
  const window_ = ctx.window;
  const height = ((window_.endMinutes - window_.startMinutes) / 60) * PX_PER_HOUR;
  const items = ctx.all || [];
  const totalMinutes = items.reduce(function (sum, item) { return sum + item.duration; }, 0);

  const grid = el("div", { class: "tl__grid", attrs: { style: "height:" + height + "px" } },
    hourRows(window_)
      .concat(items.map(function (item) { return block(item, window_, ctx.laneCount); }))
      .concat([nowLine(ctx)]));

  const body = el("div", { class: "tl__scroll" }, [
    grid,
    items.length ? null : el("p", { class: "tl__empty", text: "这一天还没有排出时间段" })
  ]);

  return el("section", { class: "panel panel--rail" }, [
    el("header", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: "每日时间安排" }),
      el("span", { class: "panel__meta", text: items.length ? "已排 " + formatDuration(totalMinutes) : "暂无时段" })
    ]),
    body
  ]);
}
