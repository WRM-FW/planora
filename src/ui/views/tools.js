/** 页头工具区：主题换色 + 新增计划。 */
import { THEME_LABEL } from "../../config.js";
import { el, frag, icon } from "../dom.js";

export function renderTools(ctx) {
  const preference = ctx.view.theme;
  const label = THEME_LABEL[preference] || "跟随系统";
  const resolved = ctx.theme;
  return frag([
    el("button", {
      class: "btn btn--ghost",
      attrs: {
        type: "button",
        title: "主题：" + label + "（点击切换）",
        "aria-label": "切换主题，当前" + label
      },
      data: { action: "cycle-theme", focusKey: "theme", theme: preference }
    }, [
      icon(resolved === "night" ? "moon" : "sun", { size: 16 }),
      el("span", { class: "btn__label", text: label })
    ]),
    el("button", {
      class: "btn btn--primary",
      attrs: { type: "button", "aria-keyshortcuts": "N" },
      data: { action: "new-plan", focusKey: "new" }
    }, [
      icon("plus", { size: 16, weight: 2.5 }),
      el("span", { class: "btn__label", text: "新增计划" })
    ])
  ]);
}
