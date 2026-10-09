/**
 * 视图状态：当前看哪一天、用哪个筛选、什么主题。
 * 与计划数据分开存 —— 清掉偏好不会影响计划。
 * 每次打开都从「今天」开始（这是每天都要用的工具），只记住筛选项与主题。
 */
import { FILTER_IDS, LEGACY_VIEW_KEYS, THEMES, VIEW_KEY } from "../config.js";
import { createJsonStore } from "../data/storage.js";
import { addDays, isValidDateKey, todayKey } from "../domain/datetime.js";

/** 偏好 -> 实际生效的调色板；auto 跟随系统。 */
export function resolveTheme(preference, prefersDark) {
  const pref = THEMES.indexOf(preference) >= 0 ? preference : "auto";
  if (pref === "day") return "day";
  if (pref === "night") return "night";
  return prefersDark ? "night" : "day";
}

/** 点一次主题按钮的循环：跟随系统 -> 日间 -> 夜间 -> 跟随系统。 */
export function nextTheme(theme) {
  const i = THEMES.indexOf(theme);
  return i < 0 ? "auto" : THEMES[(i + 1) % THEMES.length];
}

export function createViewState(options) {
  const opts = options || {};
  const now = opts.now || function () { return new Date(); };
  const persistence = opts.persistence || createJsonStore({
    legacyKeys: LEGACY_VIEW_KEYS,
    key: VIEW_KEY,
    storage: opts.storage,
    version: 1
  });

  const listeners = new Set();
  const state = {
    date: todayKey(now()),
    filter: "all",
    theme: "auto"
  };

  const stored = persistence.read();
  if (stored.data) {
    if (FILTER_IDS.indexOf(stored.data.filter) >= 0) state.filter = stored.data.filter;
    if (THEMES.indexOf(stored.data.theme) >= 0) state.theme = stored.data.theme;
  }

  function snapshot() {
    return { date: state.date, filter: state.filter, theme: state.theme };
  }

  function emit() {
    listeners.forEach(function (fn) { fn(snapshot()); });
  }

  function persist() {
    persistence.write({ filter: state.filter, theme: state.theme });
  }

  function setDate(dateKey) {
    if (!isValidDateKey(dateKey) || dateKey === state.date) return false;
    state.date = dateKey;
    emit();
    return true;
  }

  function setFilter(filter) {
    if (FILTER_IDS.indexOf(filter) < 0 || filter === state.filter) return false;
    state.filter = filter;
    persist();
    emit();
    return true;
  }

  function setTheme(theme) {
    if (THEMES.indexOf(theme) < 0 || theme === state.theme) return false;
    state.theme = theme;
    persist();
    emit();
    return true;
  }

  return {
    get: snapshot,
    getDate: function () { return state.date; },
    getFilter: function () { return state.filter; },
    getTheme: function () { return state.theme; },
    setDate: setDate,
    setFilter: setFilter,
    setTheme: setTheme,
    step: function (delta) { return setDate(addDays(state.date, delta)); },
    today: function () { return setDate(todayKey(now())); },
    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    }
  };
}
