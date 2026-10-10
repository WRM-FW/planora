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

test("撕下有内容的贴才进废纸篓；撕空白贴直接丢弃不占篓", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  const blankId = store.get().currentId;
  store.tear(blankId);                       // 空白 → 丢弃
  assert.equal(store.get().wasteCount, 0);   // 不进废纸篓
  assert.equal(store.get().notes.length, 1); // 仍保留一张可写的空白贴

  const cur = store.get().currentId;
  store.setText(cur, "有内容");
  store.tear(cur);                           // 有内容 → 进篓
  assert.equal(store.get().wasteCount, 1);
  assert.equal(store.get().waste[0].text, "有内容");
});

test("多张时撕掉一张只减一张，不再补空白贴（标签不会赖着不走）", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  store.setText(store.get().currentId, "第一张");
  store.addBlank();
  assert.equal(store.get().notes.length, 2);
  const second = store.get().currentId;
  store.tear(second);                        // 撕第二张
  assert.equal(store.get().notes.length, 1); // 只剩第一张，没有多补一张空白
  assert.equal(store.get().current.text, "第一张");
});

test("restore 放回：当前是空白贴则占位复用，不增殖", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  const first = store.get().currentId;
  store.setText(first, "要被撕掉");
  store.tear(first);                         // 进篓，当前变一张空白贴
  assert.equal(store.get().notes.length, 1);
  assert.ok(store.get().current.text === "");
  const gone = store.get().waste[0].id;
  assert.equal(store.restore(gone), true);
  const s = store.get();
  assert.equal(s.notes.length, 1);           // 复用空白贴，没有变成 2 张
  assert.equal(s.wasteCount, 0);
  assert.equal(s.current.text, "要被撕掉");
});

test("restore 放回：当前贴有内容则作为新贴追加", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  const a = store.get().currentId;
  store.setText(a, "留着的贴");
  const b = store.addBlank();
  store.setText(b.id, "将被撕");
  store.tear(b.id);                          // b 有内容 → 进篓；当前切到 a（有内容）
  assert.equal(store.get().current.text, "留着的贴");
  store.restore(store.get().waste[0].id);    // 当前非空 → 追加
  assert.equal(store.get().notes.length, 2);
});

test("purge 与 emptyWaste 彻底删除", async function () {
  const req = fakeRequest();
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  const first = store.get().currentId;
  store.setText(first, "x");
  store.tear(first);
  assert.equal(store.purge(store.get().waste[0].id), true);
  assert.equal(store.get().wasteCount, 0);
});

test("重启后（同一份文档）便利贴与废纸篓都还在", async function () {
  const req = fakeRequest();
  const a = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await a.load();
  const id = a.get().currentId;
  a.setText(id, "留存测试");
  a.tear(id);                                // 进篓，留一张空白贴
  const kept = a.addBlank();
  a.setText(kept.id, "另一张");              // 让它非空，避免被空贴归一化收掉
  a.flush();

  const b = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await b.load();
  const s = b.get();
  assert.equal(s.wasteCount, 1);
  assert.equal(s.waste[0].text, "留存测试");
  assert.equal(s.notes.length, 2);           // 撕下补的空白贴 + 有内容的一张
});

test("加载时把历史 bug 攒下的一堆空白贴收敛成一张", async function () {
  const req = fakeRequest();
  req.docs.sticky = {
    format: "planora-notes/v1", current: "b1",
    notes: [
      { id: "b1", text: "", color: "#f2b134", updatedAt: "2026-10-09T00:00:00.000Z" },
      { id: "c1", text: "有内容", color: "#7fb3c8", updatedAt: "2026-10-09T00:00:00.000Z" },
      { id: "b2", text: "   ", color: "#e8553d", updatedAt: "2026-10-09T00:00:00.000Z" },
      { id: "b3", text: "", color: "#a8c6a1", updatedAt: "2026-10-09T00:00:00.000Z" }
    ]
  };
  const store = createNoteStore({ request: req, storage: createMemoryStorage(), now: now });
  await store.load();
  const s = store.get();
  const blanks = s.notes.filter(function (n) { return !n.text.trim(); });
  assert.equal(s.notes.length, 2);           // 一张空白 + 一张有内容
  assert.equal(blanks.length, 1);
  assert.equal(s.currentId, "b1");           // 保留的是当前那张空白
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
