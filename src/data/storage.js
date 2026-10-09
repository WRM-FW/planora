/**
 * 存储适配器：把「JSON + 版本号 + 坏数据处理」这套脏活集中在一处。
 * 只依赖一个符合 Web Storage 形状的对象（getItem/setItem/removeItem），
 * 因此可以在 Node 测试里塞一个内存实现。
 */
import { SCHEMA_VERSION } from "../config.js";

export const READ_STATUS = {
  OK: "ok",
  EMPTY: "empty",
  MIGRATED: "migrated",
  CORRUPT: "corrupt",
  UNAVAILABLE: "unavailable"
};

/** 内存存储：测试用，也是浏览器禁用 localStorage 时的兜底。 */
export function createMemoryStorage(seed) {
  const map = new Map();
  if (seed && typeof seed === "object") {
    Object.keys(seed).forEach(function (k) { map.set(k, seed[k]); });
  }
  return {
    getItem: function (k) { return map.has(k) ? map.get(k) : null; },
    setItem: function (k, v) { map.set(k, String(v)); },
    removeItem: function (k) { map.delete(k); },
    key: function (i) { return Array.from(map.keys())[i] || null; },
    get length() { return map.size; },
    /** 标记：这不是真正的持久化存储，只是让界面仍可用。 */
    __memoryOnly: true
  };
}

/** 优先用浏览器 localStorage；被禁用或抛错时退到内存，保证界面仍可用。 */
export function resolveBrowserStorage(win) {
  try {
    const target = (win || (typeof window !== "undefined" ? window : null));
    if (!target || !target.localStorage) return createMemoryStorage();
    const probe = "__planora_probe__";
    target.localStorage.setItem(probe, "1");
    target.localStorage.removeItem(probe);
    return target.localStorage;
  } catch (e) {
    return createMemoryStorage();
  }
}

/**
 * 带版本迁移的 JSON 存储。
 * migrations 形如 { 0: function (payload) { return nextPayload; } }，键是「源版本」。
 */
export function createJsonStore(options) {
  const opts = options || {};
  const key = opts.key;
  const version = typeof opts.version === "number" ? opts.version : SCHEMA_VERSION;
  const migrations = opts.migrations || {};
  const storage = opts.storage;
  const legacyKeys = opts.legacyKeys || [];

  function available() {
    return !!storage && typeof storage.getItem === "function" && typeof storage.setItem === "function";
  }

  function quarantine(raw) {
    try {
      storage.setItem(key + ".corrupt", raw);
      storage.removeItem(key);
    } catch (e) { /* 备份失败也不能让主流程炸掉 */ }
  }

  /** 更名前的老键：新键还是空的时候先把旧档认领过来。 */
  function adoptLegacy() {
    if (!legacyKeys.length || !available()) return false;
    try {
      if (storage.getItem(key) != null) return false;
      for (let i = 0; i < legacyKeys.length; i += 1) {
        const raw = storage.getItem(legacyKeys[i]);
        if (raw != null && raw !== "") {
          storage.setItem(key, raw);
          return true;
        }
      }
    } catch (e) { /* 认领失败也不能影响主流程 */ }
    return false;
  }

  function migrate(payload, found) {
    let current = payload;
    let from = found;
    while (from < version) {
      const step = migrations[from];
      if (typeof step !== "function") return { ok: false, data: null };
      current = step(current);
      from += 1;
    }
    return { ok: true, data: current };
  }

  return {
    key: key,
    version: version,
    available: available,
    adoptLegacy: adoptLegacy,
    /** 真正能跨会话保存吗（内存兜底不算）。 */
    isPersistent: function () { return available() && !storage.__memoryOnly; },
    read: function () {
      if (!available()) return { status: READ_STATUS.UNAVAILABLE, data: null };
      adoptLegacy();
      let raw = null;
      try {
        raw = storage.getItem(key);
      } catch (e) {
        return { status: READ_STATUS.UNAVAILABLE, data: null };
      }
      if (raw == null || raw === "") return { status: READ_STATUS.EMPTY, data: null };

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        quarantine(raw);
        return { status: READ_STATUS.CORRUPT, data: null };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        quarantine(raw);
        return { status: READ_STATUS.CORRUPT, data: null };
      }

      const found = typeof parsed.version === "number" ? parsed.version : 0;
      if (found === version) return { status: READ_STATUS.OK, data: parsed };
      if (found > version) { quarantine(raw); return { status: READ_STATUS.CORRUPT, data: null }; }

      const result = migrate(parsed, found);
      if (!result.ok) { quarantine(raw); return { status: READ_STATUS.CORRUPT, data: null }; }
      return { status: READ_STATUS.MIGRATED, data: result.data };
    },
    write: function (data) {
      if (!available()) return { ok: false, error: "storage-unavailable" };
      try {
        storage.setItem(key, JSON.stringify(Object.assign({ version: version }, data)));
        return { ok: true, error: null };
      } catch (e) {
        return { ok: false, error: (e && e.name) || "storage-error" };
      }
    },
    clear: function () {
      if (!available()) return false;
      try { storage.removeItem(key); return true; } catch (e) { return false; }
    }
  };
}
