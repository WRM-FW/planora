import test from "node:test";
import assert from "node:assert/strict";
import { READ_STATUS, createJsonStore, createMemoryStorage, resolveBrowserStorage } from "../src/data/storage.js";

const KEY = "test/key";

test("createMemoryStorage 行为与 Web Storage 一致", function () {
  const s = createMemoryStorage({ a: "1" });
  assert.equal(s.getItem("a"), "1");
  assert.equal(s.getItem("b"), null);
  s.setItem("b", 2);
  assert.equal(s.getItem("b"), "2");
  assert.equal(s.length, 2);
  s.removeItem("a");
  assert.equal(s.getItem("a"), null);
  assert.equal(s.__memoryOnly, true);
});

test("写入再读出：带版本号往返", function () {
  const storage = createMemoryStorage();
  const store = createJsonStore({ key: KEY, storage: storage, version: 1 });
  assert.deepEqual(store.write({ plans: [{ id: "a" }] }), { ok: true, error: null });

  const raw = JSON.parse(storage.getItem(KEY));
  assert.equal(raw.version, 1);

  const read = store.read();
  assert.equal(read.status, READ_STATUS.OK);
  assert.equal(read.data.plans[0].id, "a");
});

test("空存储返回 EMPTY 而不是报错", function () {
  const store = createJsonStore({ key: KEY, storage: createMemoryStorage() });
  assert.deepEqual(store.read(), { status: READ_STATUS.EMPTY, data: null });
});

test("坏 JSON 会被隔离备份，而不是让整份存档报废", function () {
  const storage = createMemoryStorage({ [KEY]: "{ 这不是 json" });
  const store = createJsonStore({ key: KEY, storage: storage });
  const read = store.read();
  assert.equal(read.status, READ_STATUS.CORRUPT);
  assert.equal(read.data, null);
  assert.equal(storage.getItem(KEY), null);
  assert.equal(storage.getItem(KEY + ".corrupt"), "{ 这不是 json");
});

test("版本高于当前程序时按损坏处理（不降级读脏数据）", function () {
  const storage = createMemoryStorage({ [KEY]: JSON.stringify({ version: 9, plans: [] }) });
  const store = createJsonStore({ key: KEY, storage: storage, version: 1 });
  assert.equal(store.read().status, READ_STATUS.CORRUPT);
});

test("缺少迁移函数时旧版本按损坏处理", function () {
  const storage = createMemoryStorage({ [KEY]: JSON.stringify({ version: 0, plans: [] }) });
  const store = createJsonStore({ key: KEY, storage: storage, version: 2 });
  assert.equal(store.read().status, READ_STATUS.CORRUPT);
});

test("按 migrations 逐级迁移旧数据", function () {
  const storage = createMemoryStorage({ [KEY]: JSON.stringify({ version: 0, items: [{ id: "a" }] }) });
  const store = createJsonStore({
    key: KEY,
    storage: storage,
    version: 2,
    migrations: {
      0: function (payload) { return { version: 1, plans: payload.items }; },
      1: function (payload) { return { version: 2, plans: payload.plans, extra: true }; }
    }
  });
  const read = store.read();
  assert.equal(read.status, READ_STATUS.MIGRATED);
  assert.equal(read.data.plans[0].id, "a");
  assert.equal(read.data.extra, true);
});

test("存储不可用时读写都安全返回", function () {
  const store = createJsonStore({ key: KEY, storage: null });
  assert.equal(store.available(), false);
  assert.equal(store.read().status, READ_STATUS.UNAVAILABLE);
  assert.deepEqual(store.write({ plans: [] }), { ok: false, error: "storage-unavailable" });
  assert.equal(store.isPersistent(), false);
});

test("setItem 抛错（例如配额满）时 write 返回失败而不抛异常", function () {
  const storage = createMemoryStorage();
  storage.setItem = function () { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; };
  const store = createJsonStore({ key: KEY, storage: storage });
  assert.deepEqual(store.write({ plans: [] }), { ok: false, error: "QuotaExceededError" });
});

test("resolveBrowserStorage 在 localStorage 不可用时退回内存实现", function () {
  assert.equal(resolveBrowserStorage(null).__memoryOnly, true);
  const throwing = {
    get localStorage() { throw new Error("blocked"); }
  };
  assert.equal(resolveBrowserStorage(throwing).__memoryOnly, true);
  const fake = {
    map: new Map(),
    getItem: function (k) { return this.map.has(k) ? this.map.get(k) : null; },
    setItem: function (k, v) { this.map.set(k, String(v)); },
    removeItem: function (k) { this.map.delete(k); }
  };
  assert.equal(resolveBrowserStorage({ localStorage: fake }), fake, "可用的 localStorage 应原样返回");

  // 探针写入失败（隐私模式下常见）也要退回内存实现
  const halfBroken = {
    localStorage: {
      getItem: function () { return null; },
      setItem: function () { throw new Error("blocked"); },
      removeItem: function () {}
    }
  };
  assert.equal(resolveBrowserStorage(halfBroken).__memoryOnly, true);
});

test("当前版本号的存档算 OK，不算迁移", function () {
  const storage = createMemoryStorage();
  const store = createJsonStore({ key: KEY, storage: storage, version: 3 });
  store.write({ plans: [] });
  assert.equal(store.read().status, READ_STATUS.OK);
});
