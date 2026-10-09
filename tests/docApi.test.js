// /api/doc/<name> 接口集成测试：真的起服务器，真的读写 data\StickyNote.json 与 Wastebasket.json。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 5401;
const BASE = "http://127.0.0.1:" + PORT;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), "planora-doc-"));
  const child = spawn(process.execPath, [join(ROOT, "server.mjs"), String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PLANORA_DATA_DIR: dir }),
    stdio: "ignore"
  });
  try {
    let ready = false;
    for (let i = 0; i < 50 && !ready; i += 1) {
      await sleep(100);
      try { ready = (await fetch(BASE + "/api/ping")).ok; } catch (e) { ready = false; }
    }
    assert.ok(ready, "服务器没起来");
    await fn(dir);
  } finally {
    child.kill();
    await new Promise(function (r) { child.on("exit", r); setTimeout(r, 1500); });
    rmSync(dir, { recursive: true, force: true });
  }
}

function putDoc(name, doc) {
  return fetch(BASE + "/api/doc/" + name, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc)
  });
}

test("便利贴写进 data\\StickyNote.json，废纸篓写进 data\\Wastebasket.json", async function () {
  await withServer(async function (dir) {
    const sticky = { format: "planora-notes/v1", current: "n1", notes: [{ id: "n1", text: "多行\n内容", color: "#f2b134" }] };
    const waste = { format: "planora-waste/v1", items: [{ id: "n0", text: "旧贴", color: "#7fb3c8", tornAt: "2026-10-09T00:00:00.000Z" }] };
    assert.equal((await putDoc("sticky", sticky)).status, 200);
    assert.equal((await putDoc("waste", waste)).status, 200);

    assert.ok(existsSync(join(dir, "StickyNote.json")), "StickyNote.json 应存在");
    assert.ok(existsSync(join(dir, "Wastebasket.json")), "Wastebasket.json 应存在");
    const onDisk = JSON.parse(readFileSync(join(dir, "StickyNote.json"), "utf8"));
    assert.equal(onDisk.notes[0].text, "多行\n内容");

    const back = await (await fetch(BASE + "/api/doc/sticky")).json();
    assert.equal(back.doc.notes[0].color, "#f2b134");
  });
});

test("UTF-8 中文与换行原样往返", async function () {
  await withServer(async function (dir) {
    const doc = { notes: [{ id: "n1", text: "中文测试 ✓ 换行\n第二行", color: "#e8553d" }], current: "n1" };
    await putDoc("sticky", doc);
    const back = await (await fetch(BASE + "/api/doc/sticky")).json();
    assert.equal(back.doc.notes[0].text, "中文测试 ✓ 换行\n第二行");
  });
});

test("白名单之外的文档名一律 404，主数据接口不受影响", async function () {
  await withServer(async function () {
    assert.equal((await fetch(BASE + "/api/doc/etc")).status, 404);
    assert.equal((await fetch(BASE + "/api/doc/planora")).status, 404);
    assert.equal((await putDoc("passwd", { a: 1 })).status, 404);
    // /api/store 照常工作
    assert.equal((await (await fetch(BASE + "/api/store")).json()).ok, true);
  });
});

test("非法请求体被拒；文档接口不经静态通道暴露", async function () {
  await withServer(async function () {
    assert.equal((await fetch(BASE + "/api/doc/sticky", { method: "PUT", body: "{坏 JSON" })).status, 400);
    assert.equal((await fetch(BASE + "/api/doc/sticky", { method: "PUT", body: "[1,2]" })).status, 400);
    await putDoc("sticky", { notes: [], current: null });
    assert.equal((await fetch(BASE + "/data/StickyNote.json")).status, 404);
  });
});

test("第二次写入留下 .bak，临时文件不残留", async function () {
  await withServer(async function (dir) {
    await putDoc("sticky", { notes: [{ id: "a", text: "v1", color: "#f2b134" }], current: "a" });
    await putDoc("sticky", { notes: [{ id: "a", text: "v2", color: "#f2b134" }], current: "a" });
    const bak = JSON.parse(readFileSync(join(dir, "StickyNote.json.bak"), "utf8"));
    assert.equal(bak.notes[0].text, "v1");
    assert.equal(existsSync(join(dir, "StickyNote.json.tmp")), false);
  });
});
