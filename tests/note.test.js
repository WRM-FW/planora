// 便利贴：领域层纯逻辑 + noteStore 门面（用假 request 模拟本地文档服务）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  inkFor, normalizeColor, createNote, readNotes, readWaste,
  editText, editColor, tearOff, restoreFrom, purgeFrom, addToWaste
} from "../src/domain/note.js";
import { createNoteStore } from "../src/data/noteStore.js";
import { createMemoryStorage } from "../src/data/storage.js";
import { NOTE_MAX_CHARS } from "../src/config.js";

const FIXED = new Date(2026, 9, 9, 9, 0);
function now() { return new Date(FIXED.getTime()); }

/* ---------- domain ---------- */

test("normalizeColor 只认 #rgb/#rrggbb，其余回落 null", function () {
  assert.equal(normalizeColor("#F2B134"), "#f2b134");
  assert.equal(normalizeColor("#abc"), "#aabbcc");
  assert.equal(normalizeColor("red"), null);
  assert.equal(normalizeColor("#12"), null);
});

test("inkFor 按底色亮度挑深/浅油墨", function () {
  assert.equal(inkFor("#173247"), "#F4EBD6");   // 深底 → 浅字
  assert.equal(inkFor("#FAF5E7"), "#173247");   // 浅底 → 深字
});

test("createNote / readNotes 归一化并去重、丢坏条目", function () {
  const n = createNote({ text: "hi\nthere", color: "#7FB3C8" }, { now: now });
  assert.equal(n.text, "hi\nthere");
  assert.equal(n.color, "#7fb3c8");
  const list = readNotes({ notes: [n, n, { nope: 1 }, null] });
  assert.equal(list.length, 1);
});

test("editText 支持多行、超长截断", function () {
  const a = createNote({}, { now: now });
  const notes = editText([a], a.id, "第一行\n第二行\n第三行", { now: now });
  assert.equal(notes[0].text, "第一行\n第二行\n第三行");
  const long = editText(notes, a.id, "字".repeat(NOTE_MAX_CHARS + 50), { now: now });
  assert.equal(long[0].text.length, NOTE_MAX_CHARS);
});

test("editColor 非法色不改动", function () {
  const a = createNote({ color: "#F2B134" }, { now: now });
  assert.equal(editColor([a], a.id, "nope", { now: now })[0].color, "#f2b134");
  assert.equal(editColor([a], a.id, "#000000", { now: now })[0].color, "#000000");
});

test("tearOff 移出并带撕下时间；restoreFrom 放回并去掉 tornAt", function () {
  const a = createNote({ text: "x" }, { now: now });
  const t = tearOff([a], a.id, { now: now });
  assert.equal(t.notes.length, 0);
  assert.ok(t.torn.tornAt);
  const w = addToWaste([], t.torn);
  assert.equal(w.length, 1);
  const r = restoreFrom(w, a.id);
  assert.equal(r.waste.length, 0);
  assert.equal(r.restored.tornAt, undefined);
});

/* ---------- noteStore 门面 ---------- */

/** 一个内存版「文档服务」：GET/PUT /api/doc/<name>，够测门面行为。 */
function fakeRequest() {
  const docs = {};
  const req = function (method, path, body) {
    const name = path.replace("/api/doc/", "");
    if (method === "GET") return Promise.resolve({ ok: true, json: { doc: docs[name] || null } });
    docs[name] = body;
    return Promise.resolve({ ok: true, json: { path: name } });
  };
  req.docs = docs;
  return req;
}

test("load 后至少有一张空白贴，并落一份 sticky 文档", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  store.flush();
  const s = store.get();
  assert.equal(s.notes.length, 1);
  assert.equal(s.currentId, s.notes[0].id);
  assert.ok(req.docs.sticky && Array.isArray(req.docs.sticky.notes));
});

test("setText 写穿到 sticky 文档（含换行）", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  const id = store.get().currentId;
  store.setText(id, "买牛奶\n鸡蛋\n面包");
  store.flush();
  assert.equal(req.docs.sticky.notes[0].text, "买牛奶\n鸡蛋\n面包");
});

test("tear 把当前贴送进废纸篓并自动补一张新空白贴", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  const first = store.get().currentId;
  store.setText(first, "写满的一张贴");
  const torn = store.tear(first);
  assert.equal(torn.text, "写满的一张贴");
  const s = store.get();
  assert.equal(s.wasteCount, 1);
  assert.equal(s.notes.length, 1);
  assert.notEqual(s.currentId, first);
  assert.equal(s.current.text, "");   // 新贴是空白的
});

test("restore 从废纸篓放回，purge 与 emptyWaste 彻底删除", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  const first = store.get().currentId;
  store.tear(first);
  const gone = store.get().waste[0].id;
  assert.equal(store.restore(gone), true);
  assert.equal(store.get().wasteCount, 0);
  // 再撕一张，purge 掉
  const cur = store.get().currentId;
  store.tear(cur);
  assert.equal(store.purge(store.get().waste[0].id), true);
  assert.equal(store.get().wasteCount, 0);
});

test("重启后（同一份文档）便利贴与废纸篓都还在", async function () {
  const req = fakeRequest();
  const a = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await a.load();
  const id = a.get().currentId;
  a.setText(id, "留存测试");
  a.tear(id);
  a.addBlank();
  a.flush();

  const b = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await b.load();
  const s = b.get();
  assert.equal(s.wasteCount, 1);
  assert.equal(s.waste[0].text, "留存测试");
  assert.equal(s.notes.length, 2);   // 撕下补的空白贴 + 手动新建的一张
});

test("没有本地服务时退回 localStorage 兜底，功能不丢", async function () {
  const storage = createMemoryStorage();
  const store = createNoteStore({ request: null, storage: storage, now: now });
  await store.load();
  const id = store.get().currentId;
  store.setText(id, "离线也能写");
  store.flush();
  const raw = JSON.parse(storage.getItem("planora/doc/sticky"));
  assert.equal(raw.notes[0].text, "离线也能写");
});
