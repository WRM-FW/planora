/**
 * 便利贴领域层：纯逻辑，不碰 DOM、不碰存储。
 * 一张便利贴 = { id, text, color, updatedAt }。
 * 「当前贴」按 id 记在文档的 current 里，撕下后进废纸篓并自动补一张空白贴。
 */
import { NOTE_DEFAULT_COLOR, NOTE_MAX_CHARS } from "../config.js";

let seq = 0;
function makeId(now) {
  seq += 1;
  return "note-" + (now || Date.now()).toString(36) + "-" + seq.toString(36);
}

/** 把任意底色配一个可读的油墨色：按感知亮度挑深/浅。 */
export function inkFor(hex) {
  const c = normalizeColor(hex) || NOTE_DEFAULT_COLOR;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.58 ? "#F4EBD6" : "#173247";
}

/** 只接受 #rgb / #rrggbb，其余一律回落默认色。 */
export function normalizeColor(value) {
  if (typeof value !== "string") return null;
  let v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }
  return null;
}

/** 认一张原始便利贴；不合法返回 null。text 允许多行、含换行。 */
export function normalizeNote(raw, deps) {
  const d = deps || {};
  const now = (d.now || function () { return new Date(); })();
  if (!raw || typeof raw !== "object") return null;
  // 落盘的便利贴一定带 id；没有 id 的就是坏条目，直接丢，别凭空造一张空白贴。
  if (typeof raw.id !== "string" || !raw.id) return null;
  const text = typeof raw.text === "string" ? raw.text.slice(0, NOTE_MAX_CHARS) : "";
  const color = normalizeColor(raw.color) || NOTE_DEFAULT_COLOR;
  return {
    id: raw.id,
    text: text,
    color: color,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now.toISOString()
  };
}

export function createNote(seed, deps) {
  const d = deps || {};
  const now = (d.now || function () { return new Date(); })();
  return {
    id: makeId(now.getTime()),
    text: typeof (seed && seed.text) === "string" ? seed.text.slice(0, NOTE_MAX_CHARS) : "",
    color: normalizeColor(seed && seed.color) || NOTE_DEFAULT_COLOR,
    updatedAt: now.toISOString()
  };
}

/** 解析文档里的 notes 数组：坏条目丢掉，保证 UI 永远拿到干净列表。 */
export function readNotes(doc) {
  const list = doc && Array.isArray(doc.notes) ? doc.notes : [];
  const out = [];
  const seen = {};
  for (let i = 0; i < list.length; i += 1) {
    const note = normalizeNote(list[i], {});
    if (note && !seen[note.id]) { seen[note.id] = true; out.push(note); }
  }
  return out;
}

/** 解析废纸篓条目：多一个 tornAt（撕下时间）。 */
export function readWaste(doc) {
  const list = doc && Array.isArray(doc.items) ? doc.items : [];
  const out = [];
  const seen = {};
  for (let i = 0; i < list.length; i += 1) {
    const note = normalizeNote(list[i], {});
    if (!note || seen[note.id]) continue;
    seen[note.id] = true;
    note.tornAt = typeof list[i].tornAt === "string" ? list[i].tornAt : note.updatedAt;
    out.push(note);
  }
  return out;
}

function indexOf(notes, id) {
  for (let i = 0; i < notes.length; i += 1) if (notes[i].id === id) return i;
  return -1;
}

/** 改文字（含换行）。返回新数组，不改入参。 */
export function editText(notes, id, text, deps) {
  const d = deps || {};
  const now = (d.now || function () { return new Date(); })();
  const i = indexOf(notes, id);
  if (i < 0) return notes.slice();
  const next = notes.slice();
  next[i] = Object.assign({}, notes[i], {
    text: String(text == null ? "" : text).slice(0, NOTE_MAX_CHARS),
    updatedAt: now.toISOString()
  });
  return next;
}

export function editColor(notes, id, color, deps) {
  const d = deps || {};
  const now = (d.now || function () { return new Date(); })();
  const i = indexOf(notes, id);
  if (i < 0) return notes.slice();
  const c = normalizeColor(color);
  if (!c) return notes.slice();
  const next = notes.slice();
  next[i] = Object.assign({}, notes[i], { color: c, updatedAt: now.toISOString() });
  return next;
}

/** 撕下：把这张移出 notes，返回 { notes, torn }。torn 带上撕下时间。 */
export function tearOff(notes, id, deps) {
  const d = deps || {};
  const now = (d.now || function () { return new Date(); })();
  const i = indexOf(notes, id);
  if (i < 0) return { notes: notes.slice(), torn: null };
  const torn = Object.assign({}, notes[i], { tornAt: now.toISOString() });
  const next = notes.filter(function (n) { return n.id !== id; });
  return { notes: next, torn: torn };
}

/** 从废纸篓放回便利贴：返回 { waste, restored }。 */
export function restoreFrom(waste, id) {
  const i = indexOf(waste, id);
  if (i < 0) return { waste: waste.slice(), restored: null };
  const restored = Object.assign({}, waste[i]);
  delete restored.tornAt;
  return { waste: waste.filter(function (n) { return n.id !== id; }), restored: restored };
}

/** 废纸篓里彻底删除一张。 */
export function purgeFrom(waste, id) {
  return waste.filter(function (n) { return n.id !== id; });
}

/** 追加到废纸篓头部（最新的在最上面），并限制总量。 */
export function addToWaste(waste, torn, limit) {
  const cap = limit || 200;
  const list = [torn].concat(waste.filter(function (n) { return n.id !== torn.id; }));
  return list.slice(0, cap);
}
