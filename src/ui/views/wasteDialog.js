/**
 * 废纸篓弹窗：列出被「撕下」投进来的便利贴。
 * 每张可「放回」或「彻底删除」，顶部一键「清空」。用原生 <dialog>，Esc/焦点交给浏览器。
 */
import { inkFor } from "../../domain/note.js";
import { el, icon } from "../dom.js";

function tornAtText(note) {
  const t = note.tornAt || note.updatedAt;
  const d = t ? new Date(t) : null;
  if (!d || isNaN(d.getTime())) return "";
  const p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function row(note) {
  const preview = (note.text || "").trim() || "（空白贴）";
  const chip = el("span", {
    class: "waste__chip",
    attrs: { "aria-hidden": "true", style: "background:" + note.color + ";color:" + inkFor(note.color) }
  });
  const body = el("div", { class: "waste__body" }, [
    el("span", { class: "waste__text", text: preview }),
    el("span", { class: "waste__time", text: tornAtText(note) })
  ]);
  return el("li", { class: "waste__item" }, [
    chip,
    body,
    el("div", { class: "waste__ops" }, [
      el("button", {
        class: "btn btn--sm",
        attrs: { type: "button", "data-action": "waste-restore", "data-id": note.id, title: "放回便利贴" }
      }, ["放回"]),
      el("button", {
        class: "btn btn--sm btn--danger",
        attrs: { type: "button", "data-action": "waste-purge", "data-id": note.id, title: "彻底删除" }
      }, [icon("trash", { size: 14 })])
    ])
  ]);
}

export function createWasteDialog(options) {
  const opts = options || {};
  const doc = opts.document || document;
  const onAction = opts.onAction || function () {};

  const list = el("ul", { class: "waste__list" });
  const empty = el("p", { class: "waste__empty", text: "废纸篓是空的。撕下的便利贴会先来到这里。" });
  const clearBtn = el("button", {
    class: "btn btn--sm btn--danger",
    attrs: { type: "button", "data-action": "waste-empty" }
  }, ["清空废纸篓"]);
  const closeBtn = el("button", {
    class: "dialog__close",
    attrs: { type: "button", "aria-label": "关闭" }
  }, [icon("close", { size: 16, weight: 2.5 })]);

  const form = el("div", { class: "dialog__form waste" }, [
    el("header", { class: "dialog__band" }, [
      el("h2", { class: "dialog__title", text: "废纸篓" }),
      el("p", { class: "dialog__hint", text: "撕下来的便利贴都在这里，可以放回或彻底删除。" }),
      closeBtn
    ]),
    el("div", { class: "dialog__body" }, [list, empty]),
    el("footer", { class: "dialog__foot" }, [
      clearBtn,
      el("div", { class: "dialog__buttons" }, [
        el("button", { class: "btn btn--ghost", attrs: { type: "button" }, data: { action: "waste-close" } }, ["关闭"])
      ])
    ])
  ]);

  const dialog = el("dialog", { class: "dialog", id: "waste-dialog" }, [form]);

  function render(notes) {
    while (list.firstChild) list.removeChild(list.firstChild);
    const has = notes && notes.length;
    list.hidden = !has;
    empty.hidden = !!has;
    clearBtn.disabled = !has;
    if (has) notes.forEach(function (n) { list.appendChild(row(n)); });
  }

  function close() {
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  form.addEventListener("click", function (event) {
    const node = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
    if (!node) return;
    const action = node.dataset.action;
    if (action === "waste-close") { close(); return; }
    onAction(action, node.dataset.id);
  });
  closeBtn.addEventListener("click", close);

  return {
    element: dialog,
    open: function (notes) {
      render(notes);
      if (typeof dialog.showModal === "function") { if (!dialog.open) dialog.showModal(); }
      else dialog.setAttribute("open", "");
    },
    refresh: render,
    close: close,
    isOpen: function () { return !!dialog.open; }
  };
}
