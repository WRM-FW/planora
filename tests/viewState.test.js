import test from "node:test";
import assert from "node:assert/strict";
import { createViewState, nextTheme, resolveTheme } from "../src/state/viewState.js";
import { createMemoryStorage } from "../src/data/storage.js";

const FIXED = new Date(2026, 9, 8, 9, 0);
const VIEW_KEY = "planora/view/v1";

function make(storage) {
  return createViewState({ storage: storage, now: function () { return FIXED; } });
}

test("默认从今天开始，筛选用全部，主题跟随系统", function () {
  const view = make(createMemoryStorage()).get();
  assert.deepEqual(view, { date: "2026-10-08", filter: "all", theme: "auto" });
});

test("筛选与主题会记住，日期每次都回到今天", function () {
  const storage = createMemoryStorage();
  const view = make(storage);
  view.setFilter("done");
  view.setTheme("night");
  view.setDate("2026-10-20");

  const reopened = make(storage);
  assert.equal(reopened.getFilter(), "done");
  assert.equal(reopened.getTheme(), "night");
  assert.equal(reopened.getDate(), "2026-10-08", "每天打开都应该落在今天");
});

test("非法值被拒绝且不触发变更", function () {
  const view = make(createMemoryStorage());
  let notified = 0;
  view.subscribe(function () { notified += 1; });
  assert.equal(view.setFilter("bogus"), false);
  assert.equal(view.setTheme("bogus"), false);
  assert.equal(view.setDate("2026-02-30"), false);
  assert.equal(view.setDate("2026-10-08"), false, "同一天不算变更");
  assert.equal(notified, 0);
});

test("step 前后翻页与回到今天", function () {
  const view = make(createMemoryStorage());
  view.step(-1);
  assert.equal(view.getDate(), "2026-10-07");
  view.step(1);
  assert.equal(view.getDate(), "2026-10-08");
  view.step(5);
  assert.equal(view.getDate(), "2026-10-13");
  view.today();
  assert.equal(view.getDate(), "2026-10-08");
});

test("存档里的脏偏好会被忽略", function () {
  const storage = createMemoryStorage({ [VIEW_KEY]: JSON.stringify({ version: 1, filter: "nope", theme: "neon" }) });
  const view = make(storage);
  assert.equal(view.getFilter(), "all");
  assert.equal(view.getTheme(), "auto");
});

test("resolveTheme 把偏好解析成实际调色板", function () {
  assert.equal(resolveTheme("auto", true), "night");
  assert.equal(resolveTheme("auto", false), "day");
  assert.equal(resolveTheme("day", true), "day");
  assert.equal(resolveTheme("night", false), "night");
  assert.equal(resolveTheme(undefined, false), "day");
});

test("nextTheme 循环 跟随系统 → 日间 → 夜间", function () {
  assert.equal(nextTheme("auto"), "day");
  assert.equal(nextTheme("day"), "night");
  assert.equal(nextTheme("night"), "auto");
  assert.equal(nextTheme("bogus"), "auto");
});
