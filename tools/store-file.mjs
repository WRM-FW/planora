// 数据文件：程序目录里的 JSON 文件就是 Planora 的数据库（Node 侧实现，供开发环境使用）。
//
// 落盘策略：先写 planora.json.tmp，把上一版留成 planora.json.bak，最后原子改名覆盖。
// 进程被强杀/断电最多丢「正在写的那一次」，正式文件永远是一个完整的 JSON。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

export const STORE_FORMAT = "planora-store/v1";
export const STORE_FILE = "planora.json";
export const MAX_BYTES = 4 * 1024 * 1024;

/** 把 keys（一个「存储键 -> 原始 JSON 字符串」的映射）存成文件。 */
export function createFileStore(options) {
  const opts = options || {};
  const dir = opts.dir;
  const name = opts.file || STORE_FILE;
  const full = join(dir, name);

  function ensureDir() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  function quarantine(reason) {
    try { renameSync(full, full + ".corrupt-" + Date.now()); } catch (e) { /* 挪不动就算了 */ }
    return reason;
  }

  /** 每次都重新读盘：用户删掉文件、或换个进程改过，都能立刻反映出来。 */
  function read() {
    if (!existsSync(full)) return { keys: {}, savedAt: null, warning: null, exists: false };
    let raw;
    try {
      raw = readFileSync(full, "utf8");
    } catch (err) {
      return { keys: {}, savedAt: null, warning: "数据文件读不出来：" + (err && err.message), exists: true };
    }
    if (raw.trim() === "") return { keys: {}, savedAt: null, warning: null, exists: true };
    try {
      const doc = JSON.parse(raw);
      const src = doc && doc.keys && typeof doc.keys === "object" ? doc.keys : null;
      if (!src) throw new Error("缺少 keys 字段");
      const keys = {};
      Object.keys(src).forEach(function (k) {
        if (typeof src[k] === "string") keys[k] = src[k];
      });
      return { keys: keys, savedAt: doc.savedAt || null, warning: null, exists: true };
    } catch (err) {
      const note = quarantine((err && err.message) || "解析失败");
      return { keys: {}, savedAt: null, warning: "数据文件损坏，已另存为 .corrupt 备份（" + note + "）", exists: false };
    }
  }

  function write(keys, meta) {
    const doc = {
      format: STORE_FORMAT,
      app: "planora",
      version: (meta && meta.version) || null,
      savedAt: new Date().toISOString(),
      keys: keys
    };
    const json = JSON.stringify(doc, null, 2);
    if (Buffer.byteLength(json) > MAX_BYTES) throw new Error("数据超过 " + MAX_BYTES + " 字节");
    ensureDir();
    const tmp = full + ".tmp";
    writeFileSync(tmp, json, "utf8");
    if (existsSync(full)) {
      try { copyFileSync(full, full + ".bak"); } catch (e) { /* 备份失败不影响主流程 */ }
    }
    renameSync(tmp, full);
    return { path: full, savedAt: doc.savedAt, bytes: Buffer.byteLength(json) };
  }

  return { dir: dir, file: full, read: read, write: write, exists: function () { return existsSync(full); } };
}

/**
 * 命名单元文档存储：便利贴（StickyNote.json）、废纸篓（Wastebasket.json）这类
 * 「整份 JSON 文档」用的通用存储，和主数据一样走「临时文件 → 原子改名 → .bak」。
 * 文档内容原样存取（结构由各功能自己解释），坏档同样隔离成 .corrupt-<时间戳>。
 */
export function createDocStore(options) {
  const opts = options || {};
  const dir = opts.dir;
  const full = join(dir, opts.file);

  function ensureDir() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** 读出文档；不存在返回 null。解析失败隔离坏档后也返回 null。 */
  function read() {
    if (!existsSync(full)) return null;
    let raw;
    try {
      raw = readFileSync(full, "utf8");
    } catch (err) {
      return null;
    }
    if (raw.trim() === "") return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      try { renameSync(full, full + ".corrupt-" + Date.now()); } catch (e) { /* 挪不动就算了 */ }
      return null;
    }
  }

  function write(doc) {
    const json = JSON.stringify(doc, null, 2);
    if (Buffer.byteLength(json) > MAX_BYTES) throw new Error("文档超过 " + MAX_BYTES + " 字节");
    ensureDir();
    const tmp = full + ".tmp";
    writeFileSync(tmp, json, "utf8");
    if (existsSync(full)) {
      try { copyFileSync(full, full + ".bak"); } catch (e) { /* 备份失败不影响主流程 */ }
    }
    renameSync(tmp, full);
    return { path: full, bytes: Buffer.byteLength(json) };
  }

  return { file: full, read: read, write: write };
}
