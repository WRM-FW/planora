/**
 * 绿色版打包：把 index.html + 全部样式 + 字体 + ES 模块合成一个自包含 HTML。
 * 产物不联网、不依赖 Node：交给 Planora.exe 的内置服务就是文件存储，
 * 直接双击（file://）也能跑，只是退回浏览器 localStorage。
 * 用法：node tools/build-portable.mjs [输出文件]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ENTRY = "src/main.js";
const VERSION = "1.1.3";

const MIME = {
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

/** 统一成相对仓库根、正斜杠的模块 id。 */
function toId(abs) {
  return relative(ROOT, abs).split("\\").join("/");
}

function readText(rel) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

/* ---------- 1. 顺着 import 收集模块，后序排列（依赖在前） ---------- */

const IMPORT_RE = /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];?[ \t]*$/gm;
const EXPORT_RE = /^([ \t]*)export\s+(?:(async)\s+)?(function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;

function scanImports(id, code) {
  const specs = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code)) !== null) specs.push(m[2]);
  return specs;
}

function collect(entry) {
  const order = [];
  const state = new Map();
  function visit(id, trail) {
    const mark = state.get(id);
    if (mark === "done") return;
    if (mark === "visiting") {
      throw new Error("检测到循环依赖：" + trail.concat(id).join(" -> "));
    }
    state.set(id, "visiting");
    const code = readText(id);
    for (const spec of scanImports(id, code)) {
      if (!/^\./.test(spec)) throw new Error(id + " 引用了非相对路径：" + spec);
      const dep = toId(resolve(dirname(resolve(ROOT, id)), spec));
      visit(dep, trail.concat(id));
    }
    state.set(id, "done");
    order.push(id);
  }
  visit(entry, []);
  return order;
}

/* ---------- 2. 把每个模块改写成 __def(id, function (__exports) {...}) ---------- */

function transform(id, code) {
  const exported = [];
  let out = code;

  out = out.replace(IMPORT_RE, function (all, names, spec) {
    const dep = toId(resolve(dirname(resolve(ROOT, id)), spec));
    const bindings = names.split(",").map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      const parts = s.split(/\s+as\s+/);
      return parts.length === 2 ? parts[0].trim() + ": " + parts[1].trim() : s;
    }).join(", ");
    return "const { " + bindings + " } = __req(" + JSON.stringify(dep) + ");";
  });

  out = out.replace(EXPORT_RE, function (all, indent, isAsync, kind, name) {
    exported.push(name);
    return indent + (isAsync ? "async " : "") + kind + " " + name;
  });

  if (/^[ \t]*export\b/m.test(out)) {
    throw new Error(id + " 还有没处理的 export（只支持 export function/const/let/var/class）");
  }

  const tail = exported.length
    ? "\nObject.assign(__exports, { " + exported.join(", ") + " });\n"
    : "";
  return "__def(" + JSON.stringify(id) + ", function (__exports) {\n" +
    "\"use strict\";\n" + out + tail + "});\n";
}

function bundle() {
  const ids = collect(ENTRY);
  const parts = ids.map(function (id) { return transform(id, readText(id)); });
  const head = [
    "(function () {",
    "  \"use strict\";",
    "  var __defs = Object.create(null);",
    "  var __cache = Object.create(null);",
    "  function __def(id, fn) { __defs[id] = fn; }",
    "  function __req(id) {",
    "    if (__cache[id]) return __cache[id];",
    "    var box = {};",
    "    __cache[id] = box;",
    "    __defs[id](box);",
    "    return box;",
    "  }"
  ].join("\n");
  const foot = "__req(" + JSON.stringify(ENTRY) + ");\n})();";
  return { code: head + "\n" + parts.join("\n") + foot + "\n", ids: ids };
}

/* ---------- 3. 内联样式与字体 ---------- */

function dataUri(abs) {
  const mime = MIME[extname(abs).toLowerCase()] || "application/octet-stream";
  return "data:" + mime + ";base64," + readFileSync(abs).toString("base64");
}

function inlineCss(rel) {
  const abs = resolve(ROOT, rel);
  let css = readFileSync(abs, "utf8");
  const missed = [];
  css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (all, q, ref) {
    // 只处理「看着像相对路径」的引用；data:、#fragment、%23 编码等一律原样保留。
    if (!/^[A-Za-z0-9._\/-]+$/.test(ref)) return all;
    const target = resolve(dirname(abs), ref);
    if (!existsSync(target)) { missed.push(ref); return all; }
    return "url(" + dataUri(target) + ")";
  });
  if (missed.length) throw new Error(rel + " 引用的本地资源不存在：" + missed.join(", "));
  return { rel: rel, css: css, bytes: Buffer.byteLength(css, "utf8") };
}

/* ---------- 4. 合成 HTML ---------- */

function build() {
  let html = readText("index.html");
  const links = [];
  html = html.replace(/[ \t]*<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>\s*\n?/g, function (all, href) {
    links.push(href.replace(/^\.\//, ""));
    return "";
  });
  if (!links.length) throw new Error("index.html 里没有找到样式表链接");

  const sheets = links.map(inlineCss);
  const cssText = sheets.map(function (s) { return "/* ==== " + s.rel + " ==== */\n" + s.css; }).join("\n");
  const styleBlock = "<style>\n" + cssText + "</style>\n";

  if (html.indexOf("</head>") < 0) throw new Error("index.html 缺少 </head>");
  html = html.replace("</head>", styleBlock + "</head>");

  const b = bundle();
  const scriptTag = '<script type="module" src="./src/main.js"></script>';
  if (html.indexOf(scriptTag) < 0) throw new Error("index.html 里没有找到入口 script 标签");
  html = html.replace(scriptTag, "<script>\n" + b.code + "</script>");

  html = html.replace("<!doctype html>",
    "<!doctype html>\n<!-- Planora v" + VERSION + " · 构建产物，由 tools/build-portable.mjs 生成。\n" +
    "     用 Planora.exe 打开时数据存在同目录的 data/planora.json；直接双击本文件（file://）\n" +
    "     时会退回浏览器 localStorage。两种情况都不上传任何服务器。 -->");

  if (/\b(src|href)="\.\//.test(html)) {
    throw new Error("还有没内联的外链资源：\n" + html.match(/[^\n]*\b(src|href)="\.\/[^\n]*/g).join("\n"));
  }
  return { html: html, ids: b.ids, sheets: sheets.length, bytes: Buffer.byteLength(html, "utf8") };
}

const out = process.argv[2] || resolve(ROOT, "..", "Planora.html");
const r = build();
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), r.html);
console.log("Planora v" + VERSION + " 绿色版已生成");
console.log("  输出      : " + resolve(out));
console.log("  大小      : " + (r.bytes / 1024).toFixed(1) + " KB");
console.log("  内联样式  : " + r.sheets + " 份（字体已转 base64）");
console.log("  打包模块  : " + r.ids.length + " 个");
r.ids.forEach(function (id) { console.log("    - " + id); });