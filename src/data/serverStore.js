/**
 * 本地数据服务的客户端。
 *
 * 目标：让「程序目录里的 JSON 文件」取代 localStorage 成为主存储，
 * 而 data / state 两层完全不用改 —— 这里提供一个和 Web Storage 同形状的
 * 门面（getItem / setItem / removeItem），createJsonStore 直接把它当 storage 用。
 *
 * 内存里始终有一份完整副本（读取是同步的），每次写入立刻 PUT 给本地服务，
 * 由服务端做「临时文件 + 原子替换」落盘；页面隐藏/关闭时再用 sendBeacon 兜一次。
 */
import { DATA_KEY, VIEW_KEY, SAVE_STATE } from "../config.js";

/** 纯函数：决定这次启动的数据从哪儿来（可单测，不碰浏览器）。 */
export function decideBootstrap(input) {
  const o = input || {};
  const keys = o.serverKeys || {};
  function pick(src) {
    const out = {};
    if (src && typeof src[DATA_KEY] === "string" && src[DATA_KEY] !== "") out[DATA_KEY] = src[DATA_KEY];
    if (src && typeof src[VIEW_KEY] === "string" && src[VIEW_KEY] !== "") out[VIEW_KEY] = src[VIEW_KEY];
    return out;
  }
  const server = pick(keys);
  if (server[DATA_KEY]) return { source: "server", keys: {} };
  const shadow = pick(o.shadow);
  if (shadow[DATA_KEY]) return { source: "shadow", keys: shadow };
  if (!o.migrated) {
    const legacy = pick(o.legacy);
    if (legacy[DATA_KEY]) return { source: "legacy", keys: legacy };
  }
  return { source: "fresh", keys: {} };
}

/** 保存状态：订阅式的小状态机，页脚据此显示「保存中 / 已保存 / 保存失败」。 */
export function createSaveStatus(initial) {
  let state = Object.assign({
    mode: "file",
    save: SAVE_STATE.IDLE,
    at: null,
    error: null,
    path: null,
    migrated: null,
    note: null
  }, initial || {});
  const subs = [];
  function emit(patch) {
    state = Object.assign({}, state, patch);
    subs.forEach(function (fn) { fn(state); });
  }
  return {
    get: function () { return state; },
    emit: emit,
    subscribe: function (fn) {
      subs.push(fn);
      return function () {
        const i = subs.indexOf(fn);
        if (i >= 0) subs.splice(i, 1);
      };
    }
  };
}

/**
 * 把本地服务包装成 storage。
 * request(method, path, body) -> Promise<{ ok, json, error }>
 */
export function createServerStorage(options) {
  const opts = options || {};
  const request = opts.request;
  const path = opts.path;
  const onState = opts.onState || function () {};
  const onShadow = opts.onShadow || function () {};
  const map = new Map();
  const initial = opts.initial || {};

  Object.keys(initial).forEach(function (k) {
    if (typeof initial[k] === "string") map.set(k, initial[k]);
  });

  let inFlight = false;
  let dirty = false;

  function snapshot() {
    const out = {};
    map.forEach(function (v, k) { out[k] = v; });
    return out;
  }

  function send() {
    inFlight = true;
    dirty = false;
    onState(SAVE_STATE.SAVING, null);
    request("PUT", path, { keys: snapshot() }).then(function (res) {
      inFlight = false;
      if (res && res.ok) {
        const json = res.json || {};
        onState(SAVE_STATE.SAVED, null, { path: json.path, at: json.savedAt });
      } else {
        const err = (res && res.error) || "save-failed";
        onShadow(snapshot());
        onState(SAVE_STATE.FAILED, err);
      }
      if (dirty) send();
    }).catch(function (err) {
      inFlight = false;
      onShadow(snapshot());
      onState(SAVE_STATE.FAILED, (err && err.message) || "network");
      if (dirty) send();
    });
  }

  function push() {
    if (inFlight) { dirty = true; return; }
    send();
  }

  return {
    mode: "file",
    available: function () { return true; },
    isPersistent: function () { return true; },
    getItem: function (k) { return map.has(k) ? map.get(k) : null; },
    setItem: function (k, v) { map.set(k, String(v)); push(); },
    removeItem: function (k) { if (map.delete(k)) push(); },
    key: function (i) { return Array.from(map.keys())[i] || null; },
    get length() { return map.size; },
    snapshot: snapshot,
    /** 立刻把当前内存副本交给服务端；页面要关闭时用。 */
    flushNow: function () { if (!inFlight) send(); },
    /** 还有没落盘的改动吗（正在写、或写完后又有新改动）。 */
    hasPending: function () { return inFlight || dirty; },
    /**
     * 页面隐藏时用 sendBeacon 兜底（不等响应，但浏览器保证会发出去）。
     * 只在真的还有改动没落盘时才发 —— 否则会拿一份旧快照盖掉别人刚写好的新数据。
     */
    flushKeepalive: function (nav, blobFactory) {
      if (!inFlight && !dirty) return false;
      if (!nav || typeof nav.sendBeacon !== "function") return false;
      try {
        const body = JSON.stringify({ keys: snapshot() });
        return !!nav.sendBeacon(path, blobFactory(body));
      } catch (e) {
        return false;
      }
    }
  };
}

/** GET /api/ping：确认对面确实是 Planora 的本地数据服务。 */
export function pingServer(request) {
  return request("GET", "/api/ping", null).then(function (res) {
    if (!res || !res.ok || !res.json) return { ok: false };
    return {
      ok: res.json.app === "planora",
      version: res.json.version || null,
      path: res.json.path || null,
      port: res.json.port || null,
      dataDir: res.json.dataDir || null
    };
  }).catch(function () { return { ok: false }; });
}

/** GET /api/store：读出服务端当前保存的全部键。 */
export function readServerStore(request) {
  return request("GET", "/api/store", null).then(function (res) {
    if (!res || !res.ok || !res.json) return { ok: false, keys: {}, path: null };
    return {
      ok: true,
      keys: (res.json.keys && typeof res.json.keys === "object") ? res.json.keys : {},
      path: res.json.path || null,
      savedAt: res.json.savedAt || null,
      migratedAt: res.json.migratedAt || null
    };
  }).catch(function () { return { ok: false, keys: {}, path: null }; });
}
