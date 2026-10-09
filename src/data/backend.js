/**
 * 启动时挑数据后端。
 *
 * 优先「程序目录里的 JSON 文件」：只要页面是由本地数据服务提供的（Planora.exe
 * 或 node server.mjs），就走文件存储；直接双击 Planora.html（file://）或对面
 * 不是 Planora 服务时，退回浏览器 localStorage，保证单文件版本依然能用。
 *
 * 顺带解决源隔离：如果数据文件还是空的，就把旧版留在浏览器里的数据
 * （同一个 http://localhost:5173 源）认领进数据文件，只做一次。
 */
import { DATA_KEY, VIEW_KEY, MIGRATED_KEY, SHADOW_KEY, MIGRATION_SOURCES, PING_API, STORE_API, SAVE_STATE } from "../config.js";
import { createSaveStatus, createServerStorage, decideBootstrap, pingServer, readServerStore } from "./serverStore.js";
import { resolveBrowserStorage } from "./storage.js";

export function isFileProtocol(win) {
  return !!(win && win.location && win.location.protocol === "file:");
}

/** fetch 包装：永远 resolve，把失败也变成 { ok:false }，调用方不用写 try。 */
export function makeRequest(fetchImpl) {
  return function (method, path, body) {
    const init = { method: method, cache: "no-store" };
    if (body !== null && body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
      // 页面随时可能被关掉：让这次写入变成「即使页面没了也要送完」的请求
      init.keepalive = true;
    }
    return fetchImpl(path, init).then(function (res) {
      if (!res || !res.ok) return { ok: false, error: "http-" + ((res && res.status) || 0) };
      return res.json().then(function (json) { return { ok: true, json: json }; }, function () {
        return { ok: false, error: "bad-json" };
      });
    }, function (err) {
      return { ok: false, error: (err && err.message) || "network" };
    });
  };
}

function parseObject(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

/** 在浏览器存储里找可搬迁的旧数据：旧版绿色版 / 开发环境 / 更名前的键。 */
export function collectLegacy(storage) {
  const out = {};
  if (!storage || typeof storage.getItem !== "function") return out;
  MIGRATION_SOURCES.data.forEach(function (k) {
    if (!out[DATA_KEY] && parseObject(storage.getItem(k))) out[DATA_KEY] = storage.getItem(k);
  });
  MIGRATION_SOURCES.view.forEach(function (k) {
    if (!out[VIEW_KEY] && parseObject(storage.getItem(k))) out[VIEW_KEY] = storage.getItem(k);
  });
  return out;
}

/** 迁移过来的计划条数，用于在页脚说清楚「搬了多少条」。 */
export function countPlans(raw) {
  const payload = parseObject(raw);
  return payload && Array.isArray(payload.plans) ? payload.plans.length : 0;
}

export function attachUnload(win, storage, options) {
  if (!win || typeof win.addEventListener !== "function" || !storage) return;
  const opts = options || {};
  win.addEventListener("pagehide", function () {
    if (typeof storage.flushKeepalive === "function") {
      storage.flushKeepalive(win.navigator, function (text) {
        return new win.Blob([text], { type: "application/json" });
      });
    }
  });
}

/**
 * 打开数据后端。返回 { storage, status, mode, path, source }。
 * options: { window, document, fetch }
 */
export async function openBackend(options) {
  const opts = options || {};
  const win = opts.window;
  const status = createSaveStatus();
  const browserStorage = resolveBrowserStorage(win);

  function browserMode(note) {
    status.emit({ mode: "browser", note: note || null, save: SAVE_STATE.IDLE, path: null });
    return { storage: browserStorage, status: status, mode: "browser", path: null, source: "browser" };
  }

  let fetchImpl = opts.fetch || null;
  if (!fetchImpl && win && typeof win.fetch === "function") fetchImpl = win.fetch.bind(win);
  if (!fetchImpl) return browserMode("no-fetch");
  if (isFileProtocol(win)) return browserMode("file-protocol");

  const request = makeRequest(fetchImpl);
  const ping = await pingServer(request);
  if (!ping.ok) return browserMode("no-server");

  const loaded = await readServerStore(request);
  const migrated = browserStorage.getItem(MIGRATED_KEY) === "1";
  const decision = decideBootstrap({
    serverKeys: loaded.keys,
    shadow: parseObject(browserStorage.getItem(SHADOW_KEY)),
    legacy: collectLegacy(browserStorage),
    migrated: migrated
  });

  const storage = createServerStorage({
    request: request,
    path: STORE_API,
    initial: Object.assign({}, loaded.keys, decision.keys),
    onState: function (state, error, extra) {
      status.emit({
        save: state,
        error: error || null,
        at: (extra && extra.at) || null,
        path: (extra && extra.path) || loaded.path
      });
      if (state === SAVE_STATE.SAVED) {
        try { browserStorage.removeItem(SHADOW_KEY); } catch (e) { /* 清不掉就算了 */ }
      }
    },
    onShadow: function (snapshot) {
      try { browserStorage.setItem(SHADOW_KEY, JSON.stringify(snapshot)); } catch (e) { /* 暂存失败也不阻断 */ }
    }
  });

  const adopting = decision.source === "legacy" || decision.source === "shadow";
  status.emit({
    mode: "file",
    path: loaded.path,
    save: SAVE_STATE.IDLE,
    migrated: decision.source === "legacy" ? "legacy" : (decision.source === "shadow" ? "shadow" : null),
    migratedPlans: decision.source === "legacy" ? countPlans(decision.keys[DATA_KEY]) : 0
  });

  if (adopting) {
    storage.flushNow();
    try { browserStorage.setItem(MIGRATED_KEY, "1"); } catch (e) { /* 标记写不上就下次再说 */ }
  }

  // 心跳：让数据服务知道页面还开着，否则它会以为没人用了而自行退出。
  // 后台标签页的定时器会被浏览器压到每分钟一次，所以服务端的空闲阈值放宽到 5 分钟。
  if (win && typeof win.setInterval === "function") {
    win.setInterval(function () { request("GET", PING_API, null); }, 20000);
  }

  return { storage: storage, status: status, mode: "file", path: loaded.path, source: decision.source };
}
