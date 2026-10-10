/**
 * 便利贴视图：贴在统计区右侧的一张便签。
 * 支持多行自由输入、换行、自定义颜色；「撕下」把这张投进废纸篓并自动补一张空白贴。
 *
 * 文字输入走 input 事件 → store.setText（不触发重画），所以这里额外导出
 * captureStickyCaret / restoreStickyCaret：整体重画时把光标位置还回来，打字不被打断。
 */
import { NOTE_COLORS, NOTE_MAX_CHARS } from "../../config.js";
import { inkFor } from "../../domain/note.js";
import { el, icon } from "../dom.js";

function tapeStrip() {
  // 顶上一条半透明「胶带」，拟物：像是把便签贴在板上。
  return el("span", { class: "note__tape", attrs: { "aria-hidden": "true" } });
}

function colorRow(current) {
  const swatches = NOTE_COLORS.map(function (c) {
    const on = c.value.toLowerCase() === String(current.color).toLowerCase();
    return el("button", {
      class: "note__swatch" + (on ? " is-active" : ""),
      attrs: {
        type: "button",
        title: c.label,
        "aria-label": "颜色：" + c.label,
        "aria-pressed": on ? "true" : "false",
        "data-action": "set-note-color",
        "data-color": c.value,
        style: "background:" + c.value
      }
    });
  });
  const custom = el("input", {
    class: "note__picker",
    attrs: {
      type: "color",
      value: current.color,
      title: "自定义颜色",
      "aria-label": "自定义便利贴颜色",
      "data-action": "note-color-custom"
    }
  });
  return el("div", { class: "note__colors" }, swatches.concat([
    el("label", { class: "note__custom", attrs: { title: "自定义颜色" } }, [custom, icon("edit", { size: 13 })])
  ]));
}

function noteTabs(snapshot) {
  if (snapshot.notes.length <= 1) return null;
  const tabs = snapshot.notes.map(function (n) {
    const on = n.id === snapshot.currentId;
    const preview = (n.text || "").trim().split("\n")[0] || "空白";
    return el("span", {
      class: "note-tab" + (on ? " is-active" : ""),
      style: "background:" + n.color + ";color:" + inkFor(n.color)
    }, [
      el("button", {
        class: "note-tab__pick",
        attrs: { type: "button", "data-action": "select-note", "data-id": n.id, title: "查看：" + preview }
      }, [preview.slice(0, 6)]),
      el("button", {
        class: "note-tab__close",
        attrs: { type: "button", "data-action": "close-note", "data-id": n.id, "aria-label": "关闭这张便利贴", title: "关闭（有内容则进废纸篓）" }
      }, ["×"])
    ]);
  });
  return el("div", { class: "note-tabs", attrs: { role: "tablist", "aria-label": "便利贴列表" } }, tabs);
}

export function renderSticky(ctx) {
  const snap = ctx.sticky;
  const current = snap.current;
  if (!current) {
    return el("div", { class: "sticky-panel is-empty" }, [
      el("p", { class: "sticky-panel__hint", text: "便利贴加载中…" })
    ]);
  }

  const basket = el("button", {
    class: "sticky-panel__basket",
    attrs: { type: "button", "data-action": "open-waste", title: "废纸篓", "aria-label": "打开废纸篓，里面有 " + snap.wasteCount + " 张" }
  }, [
    icon("trash", { size: 16 }),
    snap.wasteCount ? el("span", { class: "sticky-panel__badge", text: String(snap.wasteCount) }) : null
  ]);

  const area = el("textarea", {
    class: "note__area",
    attrs: {
      "data-action": "note-text",
      "data-id": current.id,
      "data-focus-key": "note-" + current.id,
      maxlength: String(NOTE_MAX_CHARS),
      placeholder: "随手记点什么…（支持换行）",
      spellcheck: "false",
      "aria-label": "便利贴内容"
    }
  });
  area.value = current.text;

  const tear = el("button", {
    class: "note__tear",
    attrs: { type: "button", "data-action": "tear-note", "data-id": current.id, title: "撕下并投入废纸篓" }
  }, [
    el("span", { class: "note__tear-perf", attrs: { "aria-hidden": "true" } }),
    el("span", { class: "note__tear-label", text: "撕 下" })
  ]);

  const card = el("div", {
    class: "note",
    attrs: { "data-id": current.id, style: "background:" + current.color + ";color:" + inkFor(current.color) }
  }, [
    tapeStrip(),
    area,
    colorRow(current),
    tear
  ]);

  return el("div", { class: "sticky-panel" }, [
    el("div", { class: "sticky-panel__head" }, [
      el("span", { class: "sticky-panel__title", text: "便利贴" }),
      basket
    ]),
    noteTabs(snap),
    card
  ]);
}

/* ---------- 打字时光标保持 ---------- */

export function captureStickyCaret(doc) {
  const active = doc.activeElement;
  if (!active || active.dataset.action !== "note-text") return null;
  return { id: active.dataset.id, start: active.selectionStart, end: active.selectionEnd };
}

export function restoreStickyCaret(doc, saved) {
  if (!saved) return;
  const node = doc.querySelector('textarea[data-action="note-text"][data-id="' + saved.id + '"]');
  if (!node) return;
  try {
    node.focus();
    if (typeof node.setSelectionRange === "function") node.setSelectionRange(saved.start, saved.end);
  } catch (e) { /* 恢复不了就算了 */ }
}
