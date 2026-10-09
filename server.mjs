// 零依赖静态文件服务器 —— 这个项目唯一的运行时依赖是 Node 本身。
//
// 直接运行:  node server.mjs [port]
// 作为模块:  导入 createStaticServer / startServer，launch.mjs 复用同一份实现，
//            避免出现两份互相漂移的服务器代码。
//
// 除了发静态文件，它还提供本地数据服务：/api/store 把程序目录里的
// data/planora.json 当成可写存储，绿色版（Planora.exe）用的是同一套协议。
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from './src/config.js';
import { createFileStore, createDocStore } from './tools/store-file.mjs';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
export const DEFAULT_PORT = 5173;

/** 文档接口白名单：URL 里的名字 → 程序目录 data\ 下的文件名。只认这两个。 */
export const DOC_FILES = {
  sticky: 'StickyNote.json',
  waste: 'Wastebasket.json'
};

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

/** 数据接口：桌面绿色版里的 Planora.exe 用同一套请求/响应。 */
async function handleApi(req, res, pathname, store, port) {
  if (pathname === '/api/ping') {
    return sendJson(res, 200, {
      ok: true,
      app: 'planora',
      version: APP_VERSION,
      port: port || null,
      dataDir: store.dir,
      path: store.file,
      pid: process.pid,
      host: 'node'
    });
  }
  if (pathname !== '/api/store') return false;

  if (req.method === 'GET') {
    const current = store.read();
    return sendJson(res, 200, {
      ok: true,
      path: store.file,
      dataDir: store.dir,
      savedAt: current.savedAt,
      keys: current.keys,
      warning: current.warning
    });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body;
    try {
      body = await readBody(req, 4 * 1024 * 1024);
    } catch (err) {
      return sendJson(res, 413, { ok: false, error: (err && err.message) || '读取失败' });
    }
    let doc;
    try {
      doc = JSON.parse(body || '{}');
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
    }
    const keys = doc && doc.keys;
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
      return sendJson(res, 400, { ok: false, error: '缺少 keys 对象' });
    }
    const clean = {};
    const bad = Object.keys(keys).filter(function (k) { return typeof keys[k] !== 'string'; });
    if (bad.length) return sendJson(res, 400, { ok: false, error: '值必须是字符串: ' + bad.join(', ') });
    Object.keys(keys).forEach(function (k) { clean[k] = keys[k]; });
    try {
      const saved = store.write(clean, { version: APP_VERSION });
      return sendJson(res, 200, { ok: true, path: saved.path, savedAt: saved.savedAt, bytes: saved.bytes });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: (err && err.message) || '写入失败' });
    }
  }

  return sendJson(res, 405, { ok: false, error: '不支持的方法 ' + req.method });
}

/** 文档接口：/api/doc/<name>，整份 JSON 原样读写（便利贴 / 废纸篓）。 */
async function handleDoc(req, res, name, docStore) {
  const store = docStore(name);
  if (req.method === 'GET') {
    const doc = store.read();
    return sendJson(res, 200, { ok: true, path: store.file, doc: doc });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    let body;
    try {
      body = await readBody(req, 4 * 1024 * 1024);
    } catch (err) {
      return sendJson(res, 413, { ok: false, error: (err && err.message) || '读取失败' });
    }
    let doc;
    try {
      doc = JSON.parse(body || 'null');
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
    }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
      return sendJson(res, 400, { ok: false, error: '文档必须是一个 JSON 对象' });
    }
    try {
      const saved = store.write(doc);
      return sendJson(res, 200, { ok: true, path: saved.path, bytes: saved.bytes });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: (err && err.message) || '写入失败' });
    }
  }
  return sendJson(res, 405, { ok: false, error: '不支持的方法 ' + req.method });
}

/** 建一个还没 listen 的静态服务器；root 之外的文件一律 403。 */
export function createStaticServer(options) {
  const opts = options || {};
  const root = opts.root ? resolve(opts.root) : ROOT;
  const dataDir = process.env.PLANORA_DATA_DIR || join(root, 'data');
  const store = opts.store || createFileStore({ dir: dataDir });
  const docStores = Object.create(null);
  function docStore(name) {
    if (!docStores[name]) docStores[name] = createDocStore({ dir: dataDir, file: DOC_FILES[name] });
    return docStores[name];
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);

      if (pathname === '/api/ping' || pathname === '/api/store') {
        const handled = await handleApi(req, res, pathname, store, opts.port);
        if (handled !== false) return;
      }
      const docMatch = pathname.match(/^\/api\/doc\/([A-Za-z0-9_-]+)$/);
      if (docMatch && DOC_FILES[docMatch[1]]) {
        return await handleDoc(req, res, docMatch[1], docStore);
      }
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: '没有这个接口' });
      // 数据文件不走静态通道，避免被页面或别的程序当普通文件抓走
      if (pathname === '/data' || pathname.startsWith('/data/')) return send(res, 404, '404 Not Found');

      if (pathname.endsWith('/')) pathname += 'index.html';
      const target = resolve(join(root, pathname));
      // 目录穿越防护：只允许 root 子树内的文件
      if (target !== root && !target.startsWith(root + sep)) return send(res, 403, '403 Forbidden');
      const info = await stat(target).catch(function () { return null; });
      if (!info) return send(res, 404, '404 Not Found: ' + pathname);
      if (info.isDirectory()) {
        const idx = join(target, 'index.html');
        const idxInfo = await stat(idx).catch(function () { return null; });
        if (!idxInfo) return send(res, 404, '404 Not Found: ' + pathname);
        return send(res, 200, await readFile(idx), MIME['.html']);
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store'
      });
      createReadStream(target).pipe(res);
    } catch (err) {
      send(res, 500, '500 ' + (err && err.message));
    }
  });
}

/** listen 并打印欢迎信息，返回 server 实例。quiet 时不打印。 */
export function startServer(options) {
  const opts = options || {};
  const port = Number(opts.port || process.env.PORT || DEFAULT_PORT);
  const store = opts.store || createFileStore({
    dir: process.env.PLANORA_DATA_DIR || join(opts.root ? resolve(opts.root) : ROOT, 'data')
  });
  const server = createStaticServer(Object.assign({}, opts, { port: port, store: store }));
  server.store = store;
  server.listen(port, function () {
    if (opts.quiet) return;
    console.log('');
    console.log('  Planora · 每日计划   v' + APP_VERSION);
    console.log('  → http://localhost:' + port);
    console.log('  数据文件: ' + store.file);
    console.log('  按 Ctrl+C 停止');
    console.log('');
  });
  return server;
}

// 只有直接 node server.mjs 才自动启动；被 import 时保持安静。
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const port = Number(process.argv[2] || process.env.PORT || DEFAULT_PORT);
  const server = startServer({ port: port });
  server.on('error', function (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.error('  端口 ' + port + ' 已被占用：可能已经有一个实例在运行了。');
      console.error('  换一个端口试试：node server.mjs ' + (port + 1));
      process.exit(1);
    }
    throw err;
  });
}
