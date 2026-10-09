/**
 * 绿色版自检：用 CDP 在真实 Chromium 里以 file:// 打开 Planora.html，
 * 检查「能渲染 / 本地存储可用 / 能新建计划 / 刷新后还在」这几件事。
 * 用法：node tools/verify-portable.mjs <Planora.html 绝对路径>
 */
import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const html = process.argv[2];
if (!html) { console.error("缺少 Planora.html 路径"); process.exit(2); }
const PORT = 9400 + Math.floor(Math.random() * 80);
const profile = join(tmpdir(), "planora-verify-" + Date.now());

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
      const page = list.filter(function (t) { return t.type === "page" && t.url.indexOf("file:") === 0; })[0];
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

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "抛错: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
  return r.result && r.result.value;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail === undefined ? "" : String(detail).slice(0, 400) });
}

const child = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-sync", "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + profile, pathToFileURL(html).href
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
  await sleep(1200);

  check("页面标题", (await evaluate("document.title")) === "Planora · 每日计划", await evaluate("document.title"));
  check("品牌字样", /Planora/.test(await evaluate("document.querySelector('.masthead__title').textContent")) && /PLANORA/.test(await evaluate("document.querySelector('.masthead__sub').textContent")), await evaluate("document.querySelector('.masthead__title').textContent + ' / ' + document.querySelector('.masthead__sub').textContent"));
  const hours = await evaluate("document.querySelectorAll('.tl__hour').length");
  check("时间轴小时数", hours >= 16, hours);
  const bandTxt = await evaluate("document.querySelector('#band').innerText.replace(/\\n/g,' / ')");
  check("日期导航渲染", String(bandTxt).length > 3 && /今天/.test(String(bandTxt)) && /周/.test(String(bandTxt)), String(bandTxt).slice(0, 120));
  const sumTxt = await evaluate("document.querySelector('#summary').innerText.replace(/\\n/g,' / ')");
  check("统计条渲染", String(sumTxt).length > 1, String(sumTxt).slice(0, 120));
  const svg = await evaluate("document.querySelectorAll('svg').length");
  check("图标 SVG 渲染", svg > 0, svg);
  const font = await evaluate("(function(){var s=getComputedStyle(document.querySelector('.masthead__title'));return s.fontFamily})()");
  check("字体已内联", /Big Shoulders/i.test(String(font)), font);
  const storage = await evaluate("(function(){try{var k='__probe__';localStorage.setItem(k,'1');var v=localStorage.getItem(k);localStorage.removeItem(k);return v==='1'?'ok':'bad'}catch(e){return 'throw:'+e.name}})()");
  check("file:// 下 localStorage 可用", storage === "ok", storage);
  const colo0 = await evaluate("document.querySelector('#colophon').innerText.replace(/\\n/g,' / ')");
  check("页脚说明此刻用的是浏览器存储", /浏览器 localStorage/.test(String(colo0)), colo0);
  check("页脚指路：换 exe 启动就用程序目录的 JSON 文件", /Planora\.exe/.test(String(colo0)) && /JSON 文件/.test(String(colo0)), colo0);
  check("初始为空档", /存档 0 条/.test(String(colo0)), colo0);

  // 新建一条计划：按钮文案是「新增计划」，弹窗元素常驻 DOM，所以不能只看它在不在
  await evaluate("(function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return /新增/.test(x.textContent)})[0];if(b)b.click();return 1})()");
  await sleep(400);
  const dlgInfo = await evaluate("(function(){var d=document.querySelector('#dialog-root dialog');if(!d)return 'no-dialog';var i=d.querySelector('input');return 'inputs='+d.querySelectorAll('input').length+' first='+(i?i.type+'|'+i.placeholder:'none')+' open='+d.open})()");
  check("新建弹窗带输入框", /first=text/.test(String(dlgInfo)) && /open=true/.test(String(dlgInfo)), dlgInfo);
  const filled = await evaluate("(function(){var d=document.querySelector('#dialog-root dialog');var i=d&&d.querySelector('input');if(!i)return 'no-input';i.value='绿色版自检';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return 'filled:'+i.value})()");
  await sleep(250);
  const saved = await evaluate("(function(){var d=document.querySelector('#dialog-root dialog');var b=[].slice.call(d.querySelectorAll('button')).filter(function(x){return /保存/.test(x.textContent)})[0];if(!b)return 'no-save:'+[].map.call(d.querySelectorAll('button'),function(x){return x.textContent.trim()}).join(',');b.click();return 'saved:'+b.textContent.trim()})()");
  await sleep(500);
  const colo1 = await evaluate("document.querySelector('#colophon').innerText.replace(/\\n/g,' / ')");
  const ledger = await evaluate("document.querySelector('#ledger').innerText.replace(/\\n/g,' / ')");
  const stillOpen = await evaluate("(function(){var d=document.querySelector('#dialog-root dialog');return d?d.open:'gone'})()");
  check("保存后计入存档", /存档 1 条/.test(String(colo1)), filled + " | " + saved + " | open=" + stillOpen + " | " + colo1);
  check("列表里出现新计划", /绿色版自检/.test(String(ledger)), String(ledger).slice(0, 160));
  // 刷新后是否还在（file:// 持久化）
  await send("Page.reload", { ignoreCache: true });
  await sleep(1800);
  const colo2 = await evaluate("document.querySelector('#colophon').innerText.replace(/\\n/g,' / ')");
  const ledger2 = await evaluate("document.querySelector('#ledger').innerText.replace(/\\n/g,' / ')");
  check("刷新后数据仍在", /存档 1 条/.test(String(colo2)) && /绿色版自检/.test(String(ledger2)), colo2);

  // 存储里确实是 Planora 自己的键
  const keys = await evaluate("Object.keys(localStorage).join(',')");
  check("localStorage 键名为 planora/*", String(keys).indexOf("planora/plans/v1") >= 0, keys);

  // 主题切换 + 筛选（顺带确认交互没坏）
  const themeBefore = await evaluate("document.documentElement.dataset.themePreference");
  await evaluate("(function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return /油墨|跟随系统/.test(x.textContent)})[0];if(b)b.click();return 1})()");
  await sleep(300);
  const themeAfter = await evaluate("document.documentElement.dataset.themePreference + '/' + document.documentElement.dataset.theme");
  check("主题切换生效", String(themeAfter).indexOf(String(themeBefore)) !== 0, themeBefore + " -> " + themeAfter);
  const filter = await evaluate("(function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return /^已完成/.test(x.textContent.trim())})[0];if(!b)return 'no-filter:'+[].map.call(document.querySelectorAll('#band button'),function(x){return x.textContent.trim()}).join(',');b.click();return 'clicked:'+b.textContent.trim()})()");
  await sleep(300);
  const ledger3 = await evaluate("document.querySelector('#ledger').innerText.replace(/\\n/g,' / ')");
  check("筛选可用", /^clicked/.test(String(filter)) && /(1 条|没有计划)/.test(String(ledger3)), filter + " | " + String(ledger3).slice(0, 120));
} catch (e) {
  check("自检流程", false, (e && e.message) || String(e));
} finally {
  try { if (ws) ws.close(); } catch (e) { }
  try { child.kill(); } catch (e) { }
  await sleep(600);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
}

let pass = 0;
console.log("Planora 绿色版自检 —— " + html);
console.log("");
for (const r of results) {
  if (r.ok) pass += 1;
  console.log((r.ok ? "  [通过] " : "  [失败] ") + r.name + "   " + r.detail);
}
console.log("");
console.log("通过 " + pass + " / " + results.length);
process.exit(pass === results.length ? 0 : 1);
