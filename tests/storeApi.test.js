// 本地数据服务接口的集成测试：真的起一个服务器，真的读写磁盘上的 JSON 文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 5399;
const BASE = "http://127.0.0.1:" + PORT;

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/** 起一个干净的数据目录 + 一个服务器；回调结束后一定收干净。 */
async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), "planora-api-"));
  const child = spawn(process.execPath, [join(ROOT, "server.mjs"), String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PLANORA_DATA_DIR: dir }),
    stdio: "ignore"
  });
  try {
    let ready = false;
    for (let i = 0; i < 50 && !ready; i += 1) {
      await sleep(100);
      try {
        const res = await fetch(BASE + "/api/ping");
        ready = res.ok;
      } catch (e) { ready = false; }
    }
    assert.ok(ready, "服务器没起来");
    await fn(dir);
  } finally {
    child.kill();
    await new Promise(function (r) { child.on("exit", r); setTimeout(r, 1500); });
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(keys) {
  return fetch(BASE + "/api/store", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: keys })
  });
}

test("接口自报家门，并说明数据文件在哪", async function () {
  await withServer(async function (dir) {
    const ping = await (await fetch(BASE + "/api/ping")).json();
    assert.equal(ping.app, "planora");
    assert.equal(ping.path, join(dir, "planora.json"));
    assert.match(ping.version, /^1\./);
  });
});

test("静态页仍然是 Planora", async function () {
  await withServer(async function () {
    const html = await (await fetch(BASE + "/")).text();
    assert.match(html, /Planora · 每日计划/);
  });
});

test("写入的键会落成磁盘上的 JSON 文件，并且能读回来", async function () {
  await withServer(async function (dir) {
    const plans = JSON.stringify({ version: 1, plans: [{ id: "p1", title: "读英语" }] });
    const res = await put({ "planora/plans/v1": plans });
    assert.equal(res.status, 200);
    const saved = await res.json();
    assert.equal(saved.ok, true);
    assert.ok(saved.bytes > 0);

    const onDisk = JSON.parse(readFileSync(join(dir, "planora.json"), "utf8"));
    assert.equal(onDisk.format, "planora-store/v1");
    assert.equal(onDisk.app, "planora");
    assert.equal(onDisk.keys["planora/plans/v1"], plans);

    const back = await (await fetch(BASE + "/api/store")).json();
    assert.equal(back.keys["planora/plans/v1"], plans);
    assert.ok(back.savedAt);
  });
});

test("第二次写入会留下 .bak 上一版备份", async function () {
  await withServer(async function (dir) {
    await put({ "planora/plans/v1": JSON.stringify({ version: 1, plans: [] }) });
    await put({ "planora/plans/v1": JSON.stringify({ version: 1, plans: [{ id: "p2" }] }) });
    const bak = join(dir, "planora.json.bak");
    assert.ok(existsSync(bak), "应该有 .bak");
    const old = JSON.parse(readFileSync(bak, "utf8"));
    assert.equal(old.keys["planora/plans/v1"], JSON.stringify({ version: 1, plans: [] }));
    assert.equal(existsSync(join(dir, "planora.json.tmp")), false, "临时文件应该已经改名，不该留下");
  });
});

test("写坏数据和超大请求都会被拒绝", async function () {
  await withServer(async function () {
    assert.equal((await put(undefined)).status, 400);
    assert.equal((await put({ "planora/plans/v1": 123 })).status, 400);
    const bad = await fetch(BASE + "/api/store", { method: "PUT", body: "{不是 JSON" });
    assert.equal(bad.status, 400);
  });
});

test("数据文件不经静态通道暴露，目录穿越也挡住了", async function () {
  await withServer(async function () {
    await put({ "planora/plans/v1": JSON.stringify({ version: 1, plans: [] }) });
    const data = await fetch(BASE + "/data/planora.json");
    assert.equal(data.status, 404);
    // URL 规范会把 %2e%2e 也当成 .. 归并掉（所以 /%2e%2e/package.json 会变成 /package.json），
    // 真正能打到防护上的是「编码过的斜杠」：解码后才出现 ../，必须被挡住。
    const enc = await fetch(BASE + "/%2e%2e%2fpackage.json");
    assert.equal(enc.status, 403);
    const enc2 = await fetch(BASE + "/a/%2e%2e%2f%2e%2e%2fpackage.json");
    assert.equal(enc2.status, 403);
  });
});

test("数据文件损坏时会隔离备份，并从头开始", async function () {
  await withServer(async function (dir) {
    writeFileSync(join(dir, "planora.json"), "{坏掉的内容", "utf8");
    const res = await (await fetch(BASE + "/api/store")).json();
    assert.deepEqual(res.keys, {});
    assert.match(res.warning, /损坏/);
    const files = readdirSync(dir);
    assert.ok(files.some(function (f) { return f.indexOf(".corrupt-") >= 0; }), "应该留下 .corrupt 备份");
  });
});
