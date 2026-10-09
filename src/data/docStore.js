/**
 * 便利贴 / 废纸篓的文档存储。
 *
 * 和主数据一样「内存一份 + 写穿到服务端」，但走的是整份文档接口 /api/doc/<name>，
 * 服务端分别落成 data\StickyNote.json 与 data\Wastebasket.json。
 * 对面不是本地服务（file:// 直接双击）时，退回 localStorage，功能不丢。
 *
 * 这里只管「读一份干净文档 / 存一份文档 / 订阅变化」，具体怎么解释文档由各 store 负责。
 */
import { docApi } from "../config.js";

/** 一个文档 store：{ load(), save(doc), get(), subscribe(fn) }。 */
export function createDocStore(options) {
  const opts = options || {};
  const name = opts.name;
  const request = opts.request || null;      // (method, path, body) -> {ok,json,error}
  const browserStorage = opts.storage || null; // file:// 兜底
  const fallbackKey = opts.fallbackKey || ("planora/doc/" + name);
  const endpoint = docApi(name);
  const debounceMs = typeof opts.debounceMs === "number" ? opts.debounceMs : 400;

  const listeners = new Set();
  let doc = null;
  let inFlight = false;
  let dirty = false;
  let timer = null;

  function useServer() { return typeof request === "function"; }

  function emit() {
    const snapshot = doc;
    listeners.forEach(function (fn) { fn(snapshot); });
  }

  function readFallback() {
    if (!browserStorage || typeof browserStorage.getItem !== "function") return null;
    try {
      const raw = browserStorage.getItem(fallbackKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeFallback() {
    if (!browserStorage || typeof browserStorage.setItem !== "function") return;
    try { browserStorage.setItem(fallbackKey, JSON.stringify(doc)); } catch (e) { /* 存不下就算了 */ }
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (useServer()) {
      inFlight = true;
      dirty = false;
      request("PUT", endpoint, doc).then(function (res) {
        inFlight = false;
        if (!res || !res.ok) writeFallback();          // 服务端写失败：至少留在本地，别丢
        if (dirty) flush();
      }, function () {
        inFlight = false;
        writeFallback();
        if (dirty) flush();
      });
    } else {
      writeFallback();
    }
  }

  function schedule() {
    if (debounceMs <= 0) { flush(); return; }
    dirty = true;
    if (timer) return;
    timer = setTimeout(function () { timer = null; flush(); }, debounceMs);
  }

  return {
    name: name,
    /** 启动时拉一次：优先服务端，退回本地兜底。 */
    load: function () {
      if (useServer()) {
        return request("GET", endpoint, null).then(function (res) {
          if (res && res.ok && res.json && res.json.doc) doc = res.json.doc;
          else doc = readFallback();
          return doc;
        }, function () { doc = readFallback(); return doc; });
      }
      doc = readFallback();
      return Promise.resolve(doc);
    },
    get: function () { return doc; },
    /** 覆盖整份文档并安排落盘。 */
    set: function (next) { doc = next; emit(); schedule(); return doc; },
    /** 只换数据不触发落盘（内部初始化用）。 */
    prime: function (next) { doc = next; emit(); },
    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    /** 页面要关/隐藏时立刻送一次。 */
    flushNow: function () { if (!inFlight) flush(); },
    hasPending: function () { return inFlight || dirty || !!timer; }
  };
}
