/**
 * 控制器：把「状态 → 视图模型 → 视图」串起来，并处理所有交互。
 * 它不实现业务规则（在 domain 层），也不直接写存储（在 data 层）。
 */
import { createPlanStore } from "../data/planStore.js";
import { createViewState, resolveTheme, nextTheme } from "../state/viewState.js";
import { serializeArchive, parseArchive } from "../data/archive.js";
import { buildDayView, summarize } from "../domain/schedule.js";
import { occurrencesOn } from "../domain/recurrence.js";
import { addDays, isValidDateKey, relativeDayLabel, todayKey } from "../domain/datetime.js";
import { captureFocusKey, replace, restoreFocus } from "./dom.js";
import { renderTools } from "./views/tools.js";
import { renderBand } from "./views/band.js";
import { renderSummary } from "./views/summary.js";
import { renderTimeline } from "./views/timeline.js";
import { renderLedger } from "./views/planList.js";
import { renderColophon } from "./views/colophon.js";
import { createPlanDialog, suggestSlot } from "./views/planDialog.js";

const REGION_IDS = ["tools", "band", "summary", "rail", "ledger", "colophon"];
const NOTICE_MS = 6000;

export function createApp(options) {
  const opts = options || {};
  const doc = opts.document || document;
  const win = opts.window || (typeof window !== "undefined" ? window : null);
  const clock = opts.now || function () { return new Date(); };

  const store = opts.store || createPlanStore({ storage: opts.storage, now: clock });
  const viewState = opts.viewState || createViewState({ storage: opts.storage, now: clock });

  const regions = {};
  REGION_IDS.forEach(function (id) { regions[id] = doc.getElementById(id); });
  const missing = REGION_IDS.filter(function (id) { return !regions[id]; });
  if (missing.length) throw new Error("缺少页面区域: " + missing.join(", "));
  const dialogRoot = doc.getElementById("dialog-root") || doc.body;

  let pendingDelete = null;
  let notice = null;
  let noticeTimer = null;
  let tickTimer = null;

  const dialog = createPlanDialog({ document: doc, onSubmit: savePlan });

  /* ---------- 视图模型 ---------- */

  function prefersDark() {
    if (!win || typeof win.matchMedia !== "function") return false;
    return !!win.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function dayStrip(plans, dateKey) {
    const today = todayKey(clock());
    return [-1, 0, 1].map(function (delta) {
      const key = addDays(dateKey, delta);
      const stats = summarize(occurrencesOn(plans, key));
      const relative = relativeDayLabel(key, today);
      return {
        dateKey: key,
        label: relative || (delta < 0 ? "前一天" : "后一天"),
        total: stats.total,
        done: stats.done,
        isCurrent: delta === 0
      };
    });
  }

  function buildContext() {
    const view = viewState.get();
    const plans = store.getPlans();
    const dayView = buildDayView({ plans: plans, dateKey: view.date, filter: view.filter, now: clock() });
    return Object.assign({}, dayView, {
      view: view,
      theme: resolveTheme(view.theme, prefersDark()),
      dayStrip: dayStrip(plans, view.date),
      pendingDelete: pendingDelete,
      persistent: store.isPersistent(),
      storage: opts.status ? opts.status.get() : null,
      notice: notice,
      totalPlans: plans.length
    });
  }

  function render() {
    const focusKey = captureFocusKey();
    const ctx = buildContext();
    doc.documentElement.dataset.theme = ctx.theme;
    doc.documentElement.dataset.themePreference = ctx.view.theme;
    replace(regions.tools, renderTools(ctx));
    replace(regions.band, renderBand(ctx));
    replace(regions.summary, renderSummary(ctx));
    replace(regions.rail, renderTimeline(ctx));
    replace(regions.ledger, renderLedger(ctx));
    replace(regions.colophon, renderColophon(ctx));
    if (focusKey) restoreFocus(doc, focusKey);
  }

  function setNotice(text) {
    notice = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      notice = null;
      noticeTimer = null;
      render();
    }, NOTICE_MS);
    render();
  }

  /* ---------- 交互 ---------- */

  function savePlan(values, planId) {
    if (planId) {
      store.update(planId, values);
      setNotice("已保存修改");
    } else {
      store.add(values);
      setNotice("已新增一条计划");
    }
  }

  function openDialog(plan) {
    const slot = suggestSlot(clock());
    dialog.openFor(plan, { date: viewState.getDate(), start: slot.start, end: slot.end });
  }

  function exportArchive() {
    const plans = store.getPlans();
    const blob = new Blob([serializeArchive(plans)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = "planora-" + todayKey(clock()) + ".json";
    doc.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setNotice("已导出 " + plans.length + " 条计划");
  }

  function importArchive(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const result = parseArchive(String(reader.result || ""));
      if (!result.ok) {
        setNotice("导入失败：" + result.error);
        return;
      }
      // 按 id 合并：同 id 覆盖，新 id 追加 —— 恢复备份不会误删现有计划。
      const byId = new Map();
      store.getPlans().forEach(function (plan) { byId.set(plan.id, plan); });
      let added = 0;
      let updated = 0;
      result.plans.forEach(function (plan) {
        if (byId.has(plan.id)) updated += 1;
        else added += 1;
        byId.set(plan.id, plan);
      });
      store.replaceAll(Array.from(byId.values()));
      setNotice("导入完成：新增 " + added + " 条，覆盖 " + updated + " 条");
    };
    reader.readAsText(file);
  }

  const actions = {
    "prev-day": function () { viewState.step(-1); },
    "next-day": function () { viewState.step(1); },
    "today": function () { viewState.today(); },
    "goto-date": function (node) { viewState.setDate(node.dataset.date); },
    "set-filter": function (node) { viewState.setFilter(node.dataset.filter); },
    "cycle-theme": function () { viewState.setTheme(nextTheme(viewState.getTheme())); },
    "new-plan": function () { openDialog(null); },
    "edit-plan": function (node) {
      const plan = store.find(node.dataset.id);
      if (plan) openDialog(plan);
    },
    "toggle-done": function (node) { store.toggleDone(node.dataset.id, viewState.getDate()); },
    "cycle-status": function (node) { store.cycleStatus(node.dataset.id, viewState.getDate()); },
    "request-delete": function (node) { pendingDelete = node.dataset.id; render(); },
    "cancel-delete": function () { pendingDelete = null; render(); },
    "confirm-delete": function (node) {
      store.remove(node.dataset.id);
      pendingDelete = null;
    },
    "export-data": function () { exportArchive(); }
  };

  function onClick(event) {
    const node = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
    if (!node) return;
    const action = node.dataset.action;
    if (action === "import-file") return;
    const handler = actions[action];
    if (!handler) return;
    event.preventDefault();
    handler(node, event);
  }

  function onChange(event) {
    const node = event.target;
    if (!node || !node.dataset) return;
    if (node.dataset.action === "jump-date") {
      if (isValidDateKey(node.value)) viewState.setDate(node.value);
      else node.value = viewState.getDate();
    } else if (node.dataset.action === "import-file") {
      importArchive(node.files && node.files[0]);
      node.value = "";
    }
  }

  function onKeydown(event) {
    if (dialog.isOpen()) return;
    const target = event.target;
    const tag = target && target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); viewState.step(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); viewState.step(1); }
    else if (event.key === "t" || event.key === "T") { viewState.today(); }
    else if (event.key === "n" || event.key === "N") { event.preventDefault(); openDialog(null); }
  }

  function start() {
    dialogRoot.appendChild(dialog.element);

    const media = win && typeof win.matchMedia === "function"
      ? win.matchMedia("(prefers-color-scheme: dark)")
      : null;
    if (media) {
      const onMediaChange = function () { if (viewState.getTheme() === "auto") render(); };
      if (typeof media.addEventListener === "function") media.addEventListener("change", onMediaChange);
      else if (typeof media.addListener === "function") media.addListener(onMediaChange);
    }

    store.subscribe(function () { pendingDelete = null; render(); });
    viewState.subscribe(function () { pendingDelete = null; render(); });
  // 数据保存状态变化时重画页脚（保存中 / 已保存 / 保存失败）
  if (opts.status && typeof opts.status.subscribe === "function") {
    opts.status.subscribe(function () { render(); });
  }

    doc.addEventListener("click", onClick);
    doc.addEventListener("change", onChange);
    doc.addEventListener("keydown", onKeydown);
    doc.addEventListener("visibilitychange", function () {
      if (!doc.hidden) render();
    });

    render();
    // 每分钟重画一次，「现在」提示与进行中高亮会自己跟上时间。
    tickTimer = setInterval(function () { render(); }, 60000);
    return api;
  }

  function stop() {
    if (tickTimer) clearInterval(tickTimer);
    if (noticeTimer) clearTimeout(noticeTimer);
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("change", onChange);
    doc.removeEventListener("keydown", onKeydown);
  }

  const api = {
    start: start,
    stop: stop,
    render: render,
    store: store,
    viewState: viewState,
    dialog: dialog
  };
  return api;
}
