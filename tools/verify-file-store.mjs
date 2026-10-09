/**
 * 文件存储自检：对着正在运行的 Planora 数据服务，用 CDP 在真实 Chromium 里验证
 * 「数据真的落在程序目录的 JSON 文件里」，而不是浏览器 localStorage。
 *
 * 用法：node tools/verify-file-store.mjs <url> [数据文件路径]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = (process.argv[2] || "http://localhost:5173/").replace(/\/?$/, "/");
const DATA_KEY = "planora/plans/v1";
const VIEW_KEY = "planora/view/v1";
const PORT = 9500 + Math.floor(Math.random() * 60);
const profile = join(tmpdir(), "planora-filestore-" + Date.now());
let dataFile = process.argv[3] || null;

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function httpJson(path) {
  return new Promise(function (resolve, reject) {
    get({ host: "127.0.0.1", port: PORT, path: path, timeout: 3000 }, function (res) {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", function (c) { body += c; });
      res.on("end", function () { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function findPage() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await httpJson("/json/list");
      const page = list.filter(function (t) { return t.type === "page" && t.url.indexOf("http") === 0; })[0];
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (e) { /* 还没起来 */ }
    await sleep(400);
  }
  throw new Error("等不到浏览器页面目标");
}

let seq = 0;
const pending = new Map();
let ws = null;

function send(method, params) {
  const id = (seq += 1);
  return new Promise(function (resolve, reject) {
    pending.set(id, { resolve: resolve, reject: reject });
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    setTimeout(function () {
      if (pending.has(id)) { pending.delete(id); reject(new Error(method + " 超时")); }
    }, 15000);
  });
}

async function q(expression) {
  const r = await send("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "抛错: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
  return r.result && r.result.value;
}

const text = function (sel) {
  return q("(function(){var n=document.querySelector('" + sel + "');return n?n.innerText.replace(/\\n/g,' / '):'no-node'})()");
};

const clickText = function (re, scope) {
  return q("(function(){var list=[].slice.call(document.querySelectorAll('" + (scope || "button") + "'));var b=list.filter(function(x){return /" + re + "/.test(x.textContent)})[0];if(!b)return 'none:'+list.map(function(x){return x.textContent.trim()}).join(',');b.click();return 'clicked:'+b.textContent.trim()})()");
};

const results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail === undefined ? "" : String(detail).slice(0, 300) });
}

function readKeys() {
  if (!dataFile || !existsSync(dataFile)) return {};
  try {
    const doc = JSON.parse(readFileSync(dataFile, "utf8"));
    return doc && doc.keys ? doc.keys : {};
  } catch (e) { return {}; }
}

function plansIn(keys) {
  try {
    const doc = JSON.parse(keys[DATA_KEY] || "{}");
    return Array.isArray(doc.plans) ? doc.plans : [];
  } catch (e) { return []; }
}

async function waitForFile(predicate, ms) {
  const deadline = Date.now() + (ms || 6000);
  while (Date.now() < deadline) {
    const keys = readKeys();
    if (predicate(keys)) return keys;
    await sleep(150);
  }
  return readKeys();
}

// 先问服务要数据文件路径
try {
  const ping = await (await fetch(base + "api/ping")).json();
  if (!dataFile && ping.path) dataFile = ping.path;
} catch (e) { /* 下面用命令行给的 */ }

const child = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-sync", "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + profile, base
], { detached: false, stdio: "ignore" });

try {
  const page = await findPage();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(function (resolve, reject) {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", function () { reject(new Error("WebSocket 连接失败")); }, { once: true });
  });
  ws.addEventListener("message", function (ev) {
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    }
  });
  await send("Runtime.enable", {});
  await send("Page.enable", {});
  await sleep(1600);

  /* ---------- 一、数据落在文件里 ---------- */
  check("页面标题", (await q("document.title")) === "Planora · 每日计划", await q("document.title"));
  check("品牌字样", /Planora/.test(String(await q("document.querySelector('.masthead__title').textContent"))), await q("document.querySelector('.masthead__title').textContent"));
  const colo0 = await text("#colophon");
  check("页脚说明数据在 JSON 文件里", /JSON 文件/.test(colo0), colo0);
  check("页脚显示数据文件路径", /planora\.json/.test(colo0), colo0);
  check("页脚显示保存状态", /已就绪|已写入数据文件/.test(colo0), colo0);
  check("初始为空档", /存档 0 条/.test(colo0), colo0);
  const lsPlans = await q("localStorage.getItem('" + DATA_KEY + "')");
  check("localStorage 里没有计划数据", lsPlans === null || lsPlans === undefined, "值=" + lsPlans);

  await clickText("新增");
  await sleep(400);
  await q("(function(){var d=document.querySelector('#dialog-root dialog');var i=d&&d.querySelector('input');if(!i)return 'no';i.value='文件存储自检';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()");
  await sleep(260);
  await clickText("保存", "#dialog-root dialog button");
  await sleep(700);
  const ledger = await text("#ledger");
  const colo1 = await text("#colophon");
  check("界面里出现新计划", /文件存储自检/.test(ledger), ledger.slice(0, 160));
  check("页脚确认已写入数据文件", /已写入数据文件/.test(colo1), colo1);
  const keys1 = await waitForFile(function (k) { return plansIn(k).length === 1; });
  check("磁盘 JSON 文件里有这条计划", plansIn(keys1).length === 1 && plansIn(keys1)[0].title === "文件存储自检", JSON.stringify(plansIn(keys1)).slice(0, 200));
  const legacyPayload = keys1[DATA_KEY];

  await send("Page.reload", { ignoreCache: true });
  await sleep(2400);
  check("刷新后数据仍在（来自文件）", /文件存储自检/.test(await text("#ledger")) && /存档 1 条/.test(await text("#colophon")), await text("#colophon"));

  await q("(function(){var s=window.planora.store;var p=s.getPlans()[0];s.setStatus(p.id,p.dateKey||new Date().toISOString().slice(0,10),'done');return 1})()");
  const keys2 = await waitForFile(function (k) { return JSON.stringify(plansIn(k)).indexOf("done") >= 0; });
  check("改状态后文件同步", JSON.stringify(plansIn(keys2)).indexOf("done") >= 0, JSON.stringify(plansIn(keys2)).slice(0, 200));

  await q("(function(){window.planora.store.remove(window.planora.store.getPlans()[0].id);return 1})()");
  const keys3 = await waitForFile(function (k) { return plansIn(k).length === 0; });
  check("删除后文件同步", plansIn(keys3).length === 0, JSON.stringify(plansIn(keys3)).slice(0, 200));

  await clickText("油墨|跟随系统");
  const keys4 = await waitForFile(function (k) { return typeof k[VIEW_KEY] === "string" && k[VIEW_KEY].indexOf("theme") >= 0; });
  check("主题偏好写进数据文件", typeof keys4[VIEW_KEY] === "string", String(keys4[VIEW_KEY]).slice(0, 160));

  /* ---------- 二、旧浏览器数据自动迁进来 ---------- */
  const injected = await q("localStorage.setItem('" + DATA_KEY + "', " + JSON.stringify(legacyPayload) + "); localStorage.removeItem('planora/migrated/v1'); (localStorage.getItem('" + DATA_KEY + "')||'').length");
  check("旧数据已写进浏览器存储（供迁移用）", Number(injected) > 20, "长度=" + injected);
  if (dataFile && existsSync(dataFile)) rmSync(dataFile, { force: true });
  await sleep(200);
  await send("Page.reload", { ignoreCache: true });
  await sleep(5000);
  const colo3 = await text("#colophon");
  check("旧数据被认领并显示", /文件存储自检/.test(await text("#ledger")), (await text("#ledger")).slice(0, 160));
  check("页脚说明搬迁了多少条", /搬进数据文件/.test(colo3), colo3);
  const keys5 = await waitForFile(function (k) { return plansIn(k).length === 1; });
  check("旧数据已写进数据文件", plansIn(keys5).length === 1 && plansIn(keys5)[0].title === "文件存储自检", JSON.stringify(plansIn(keys5)).slice(0, 200));
  check("迁移标记已记住", (await q("localStorage.getItem('planora/migrated/v1')")) === "1", await q("localStorage.getItem('planora/migrated/v1')"));

  /* ---------- 三、导出/导入图标语义 ---------- */
  const paths = "function(sel){var n=document.querySelector(sel);if(!n)return 'missing';var p=n.querySelectorAll('path');return [].map.call(p,function(x){return x.getAttribute('d')}).join('|')}";
  const exportIcon = String(await q("(" + paths + ")('[data-action=\"export-data\"]')"));
  const importIcon = String(await q("(" + paths + ")('label[for=\"import-file\"]')"));
  check("导出备份 = 向上箭头（导出）", exportIcon.indexOf("M12 20 V9") >= 0, exportIcon);
  check("导入备份 = 向下箭头（导入）", importIcon.indexOf("M12 4 V15") >= 0, importIcon);
  check("两个按钮文案与图标没有串位", /导出备份/.test(String(await q("document.querySelector('[data-action=\"export-data\"]').textContent"))) && /导入备份/.test(String(await q("document.querySelector('label[for=\"import-file\"]').textContent"))), exportIcon.slice(0, 40) + " || " + importIcon.slice(0, 40));
} catch (e) {
  check("自检流程", false, (e && e.message) || String(e));
} finally {
  try { if (ws) ws.close(); } catch (e) { }
  try { child.kill(); } catch (e) { }
  await sleep(600);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
}

let pass = 0;
console.log("Planora 文件存储自检 —— " + base + "  数据文件: " + dataFile);
console.log("");
for (const r of results) {
  if (r.ok) pass += 1;
  console.log((r.ok ? "  [通过] " : "  [失败] ") + r.name + "   " + r.detail);
}
console.log("");
console.log("通过 " + pass + " / " + results.length);
process.exit(pass === results.length ? 0 : 1);
