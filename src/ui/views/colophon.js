/** 页脚：数据存在哪儿、备份出入口、快捷键提示。 */
import { el, frag, icon } from "../dom.js";

/** 数据存放位置的说明（纯函数，方便单测）。 */
export function describeStorage(status) {
  const st = status || {};
  if (st.mode === "file") {
    return "数据就在程序目录的 JSON 文件里（" + (st.path || "data") + "），换浏览器、换电脑、清浏览器数据都不会丢。";
  }
  if (st.mode === "browser") {
    return "当前用的是浏览器 localStorage；用 Planora.exe 启动就会改成读写程序目录里的 JSON 文件。";
  }
  return "数据存在这台浏览器的 localStorage 里，刷新或关掉页面都不会丢。";
}

/** 保存状态文案（纯函数）。 */
export function describeSave(status) {
  const st = status || {};
  if (st.save === "saving") return "保存中…";
  if (st.save === "saved") {
    const at = clockText(st.at);
    return at ? "已写入数据文件 " + at : "已写入数据文件";
  }
  if (st.save === "failed") return "保存失败，已暂存浏览器，下次改动会自动重试";
  if (st.mode === "browser") return "浏览器本地存储";
  return "数据文件已就绪";
}

/** 数据搬迁提示：只在真的搬过的时候出现。 */
export function describeMigration(status) {
  const st = status || {};
  if (st.migrated === "legacy") {
    return "已把旧版浏览器里的 " + (st.migratedPlans || 0) + " 条计划搬进数据文件。";
  }
  if (st.migrated === "shadow") return "已恢复上次没能落盘的数据。";
  return null;
}

function clockText(iso) {
  const m = String(iso || "").match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : "";
}

export function renderColophon(ctx) {
  const migrated = describeMigration(ctx.storage);
  const first = [
    el("p", { class: "colophon__mark", text: "Planora · PLANORA" }),
    el("p", { class: "colophon__note", text: describeStorage(ctx.storage) })
  ];
  if (migrated) first.push(el("p", { class: "colophon__note", text: migrated }));
  return frag([
    el("div", { class: "colophon__col" }, first),
    el("div", { class: "colophon__col colophon__col--actions" }, [
      el("button", {
        class: "btn btn--ghost btn--sm",
        attrs: { type: "button" },
        data: { action: "export-data", focusKey: "export" }
      }, [icon("upload", { size: 15 }), el("span", { text: "导出备份" })]),
      el("label", { class: "btn btn--ghost btn--sm", attrs: { for: "import-file" } }, [
        icon("download", { size: 15 }),
        el("span", { text: "导入备份" }),
        el("input", {
          class: "visually-hidden",
          id: "import-file",
          attrs: { type: "file", accept: "application/json,.json" },
          data: { action: "import-file" }
        })
      ]),
      el("span", { class: "colophon__keys", text: "← → 换天 · T 回到今天 · N 新建" })
    ]),
    el("p", {
      class: "colophon__meta",
      text: "存档 " + ctx.totalPlans + " 条 · " + describeSave(ctx.storage)
    })
  ]);
}
