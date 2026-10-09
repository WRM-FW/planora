import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

function listModules(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(function (entry) { return entry.isFile() && entry.name.endsWith(".js"); })
    .map(function (entry) { return join(entry.parentPath || entry.path, entry.name); });
}

/** main.js 在顶层就会操作 document，属于浏览器入口，不参与本测试。 */
const modules = listModules(srcDir).filter(function (file) {
  return relative(srcDir, file) !== join("main.js");
});

test("src 下每个模块都能被导入，且至少导出一个符号（顺带查错导入路径）", async function () {
  assert.equal(modules.length >= 15, true, "应该能找到全部源码模块，实际 " + modules.length);
  for (const file of modules) {
    const ns = await import("file://" + file.replace(/\\/g, "/"));
    assert.equal(Object.keys(ns).length > 0, true, relative(srcDir, file) + " 没有任何导出");
  }
});

test("入口组合根引用的区域与 index.html 一致", async function () {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(join(here, "..", "index.html"), "utf8");
  ["tools", "band", "summary", "rail", "ledger", "colophon", "dialog-root"].forEach(function (id) {
    assert.equal(html.includes('id="' + id + '"'), true, "index.html 缺少 #" + id);
  });
});
