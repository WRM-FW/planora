#!/usr/bin/env node
/**
 * 组装绿色版发布包（一条命令从源码到 zip）：
 *   1. 打单文件 Planora.html
 *   2. 用系统自带的 csc 编译 Planora.exe
 *   3. 陈列成 releases/Planora/Planora-<版本>/
 *   4. 断言 exe 没有控制台子系统（这是「全程不出现黑窗」的机器可验证条件）
 *   5. 打 zip、打印指纹；可选：在指定位置建/更新快捷方式
 *
 * 用法：node tools/make-release.mjs [输出根目录] [快捷方式路径]
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "..");
const buildDir = join(project, "build");
const iconPath = join(project, "assets", "icon.ico");
const htmlPath = join(buildDir, "Planora.html");
const exePath = join(buildDir, "Planora.exe");
const csPath = join(here, "PlanoraServer.cs");
const manifestPath = join(here, "Planora.exe.manifest");
const wv2Dir = join(here, "webview2");
// WebView2 运行时依赖：编译期引用托管 DLL，运行期这三个必须和 Planora.exe 同目录。
const wv2Refs = ["Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll"];
const wv2Ship = ["Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll"];

const version = readVersion();
// 发布物默认落在工程目录旁的 releases/（可用第一个参数指定别的位置），命名沿用
// planora_<版本>；绝不放到桌面。
const outRoot = resolve(process.argv[2] || join(project, "..", "releases"));
const stage = join(outRoot, "planora_" + version);
const zipPath = join(outRoot, "planora_" + version + ".zip");

console.log("");
console.log("Planora " + version + " 发布包");
console.log("  项目目录 : " + project);
console.log("  输出目录 : " + outRoot);

function readVersion() {
  const m = /APP_VERSION\s*=\s*"([^"]+)"/.exec(readFileSync(join(project, "src", "config.js"), "utf8"));
  if (!m) throw new Error("读不到 src/config.js 里的 APP_VERSION");
  return m[1];
}

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 180000 });
  if (r.error) throw new Error(label + " 起不来：" + r.error.message);
  if (r.status !== 0) throw new Error(label + " 失败（退出码 " + r.status + "）：" + (r.stdout || "") + (r.stderr || ""));
  return r;
}

function findCsc() {
  const candidates = [
    "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
    "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  const w = spawnSync("where", ["csc"], { encoding: "utf8" });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.split(/\r?\n/)[0].trim();
  throw new Error("找不到 csc.exe（需要系统自带的 .NET Framework 4.x）");
}

/** PE 头的子系统字段：2 = Windows GUI（没有控制台），3 = 控制台程序。 */
function subsystemOf(file) {
  const buf = readFileSync(file);
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error(file + " 不是 PE 文件");
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error(file + " 不是 PE 文件");
  return buf.readUInt16LE(peOff + 24 + 68);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}
function kb(file) { return (statSync(file).size / 1024).toFixed(1) + " KB"; }

// 1) 单文件 HTML
mkdirSync(buildDir, { recursive: true });
run(process.execPath, [join(here, "build-portable.mjs"), htmlPath], "打包单文件 HTML");
console.log("  1/5  单文件 HTML  " + kb(htmlPath));

// 2) 编译 exe
const csc = findCsc();
for (const dll of wv2Refs) {
  if (!existsSync(join(wv2Dir, dll))) throw new Error("缺少 WebView2 依赖：" + join(wv2Dir, dll));
}
const cscArgs = ["/nologo", "/target:winexe", "/optimize+", "/platform:anycpu",
  "/win32icon:" + iconPath, "/win32manifest:" + manifestPath,
  "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll"];
for (const dll of wv2Refs) cscArgs.push("/r:" + join(wv2Dir, dll));
cscArgs.push("/out:" + exePath, csPath);
run(csc, cscArgs, "编译 Planora.exe");
const subsystem = subsystemOf(exePath);
if (subsystem !== 2) throw new Error("Planora.exe 的 PE 子系统是 " + subsystem + "，不是 2（无控制台），拒绝发布");
console.log("  2/5  Planora.exe   " + kb(exePath) + "  PE 子系统=" + subsystem + "（无控制台）");

// 3) 陈列发布目录
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const items = [
  [exePath, "Planora.exe"],
  [htmlPath, "Planora.html"],
  [iconPath, "icon.ico"],
  [join(project, "使用说明.txt"), "使用说明.txt"],
  [join(project, "README.md"), "README.md"]
];
for (const dll of wv2Ship) items.push([join(wv2Dir, dll), dll]);
for (const pair of items) {
  if (!existsSync(pair[0])) throw new Error("缺少发布文件：" + pair[0]);
  cpSync(pair[0], join(stage, pair[1]));
}
console.log("  3/5  发布目录      " + stage);

// 4) zip（用系统自带 Compress-Archive；再用 .NET 的 ZipFile 回读校验一遍条目）
//    注意：不能用 tar -tf 回读 —— 有的机器上 tar 是 GNU tar，读不了 zip。
rmSync(zipPath, { force: true });
run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Compress-Archive -LiteralPath '" + stage + "' -DestinationPath '" + zipPath + "' -Force"], "打包 zip");
const listing = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" +
  "$z=[System.IO.Compression.ZipFile]::OpenRead('" + zipPath + "');" +
  "$z.Entries | ForEach-Object { $_.FullName };" +
  "$z.Dispose()"], "回读 zip");
const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
if (entries.length < items.length) throw new Error("zip 里的条目太少：" + entries.length);
if (!entries.some(function (e) { return e.indexOf("Planora.exe") >= 0; })) throw new Error("zip 里没有 Planora.exe");
for (const dll of wv2Ship) {
  if (!entries.some(function (e) { return e.indexOf(dll) >= 0; })) throw new Error("zip 里缺少 WebView2 依赖：" + dll);
}
console.log("  4/5  zip           " + kb(zipPath) + "  条目 " + entries.length + " 个");

// 5) 指纹（可选：建快捷方式）
console.log("  5/5  指纹");
for (const f of [join(stage, "Planora.exe"), join(stage, "Planora.html"), zipPath]) {
  console.log("        " + sha256(f).slice(0, 16) + "…  " + kb(f) + "  " + f);
}
const lnk = process.argv[3];
if (lnk) {
  const target = join(stage, "Planora.exe");
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('" + resolve(lnk) + "');" +
    "$s.TargetPath = '" + target + "';" +
    "$s.WorkingDirectory = '" + stage + "';" +
    "$s.IconLocation = '" + join(stage, "icon.ico") + "';" +
    "$s.Description = 'Planora 每日计划';" +
    "$s.Save()"], "创建快捷方式");
  if (!existsSync(resolve(lnk))) throw new Error("快捷方式没建出来：" + resolve(lnk));
  console.log("        快捷方式已指向 " + target);
}
console.log("");
console.log("完成。" + (lnk ? "" : " 提示：加第三个参数可以顺便把快捷方式指过来。"));
console.log("");
