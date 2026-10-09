// 双击启动：拉起本地服务并打开浏览器。
// 已经在运行就只打开浏览器，不会起第二个实例（端口被别的程序占用会自动往后找）。
//
// 用法: node launch.mjs [--port 5173] [--no-open]
import { spawn } from 'node:child_process';
import { DEFAULT_PORT, startServer } from './server.mjs';

const argv = process.argv.slice(2);
const PORT_TRIES = 10;
const PROBE_TIMEOUT_MS = 1500;

function flagValue(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const noOpen = argv.indexOf('--no-open') >= 0;
const basePort = Number(flagValue('--port', process.env.PORT || DEFAULT_PORT)) || DEFAULT_PORT;

function line(text) {
  console.log('  ' + text);
}

function openBrowser(url) {
  if (noOpen) {
    line('(--no-open：跳过自动打开浏览器)');
    return;
  }
  try {
    // 用 cmd start 交给系统默认浏览器打开，不阻塞本进程
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    line('已用默认浏览器打开：' + url);
  } catch (err) {
    line('没能自动打开浏览器，请手动访问：' + url);
  }
}

/** 探测这个端口上跑的是不是本应用（免得把别的程序误判成自己）。 */
async function isOurAppRunning(port) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, PROBE_TIMEOUT_MS);
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/', { signal: controller.signal });
    if (!res.ok) return false;
    const html = await res.text();
    return html.indexOf('Planora') >= 0;
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function tryListen(port) {
  return new Promise(function (settle) {
    const server = startServer({ port: port, quiet: true });
    server.once('listening', function () { settle({ server: server }); });
    server.once('error', function (err) { settle({ error: err }); });
  });
}

async function main() {
  console.log('');
  line('Planora · 每日计划   v1.0.0');

  for (let i = 0; i < PORT_TRIES; i += 1) {
    const port = basePort + i;
    const url = 'http://localhost:' + port;
    const result = await tryListen(port);

    if (!result.error) {
      console.log('');
      line('服务已启动：' + url);
      line('数据存在这台浏览器的本地存储里，刷新不会丢。');
      line('关掉这个窗口就会停止服务（数据不受影响）。');
      console.log('');
      openBrowser(url);
      return;
    }

    if (result.error.code !== 'EADDRINUSE') {
      console.log('');
      line('启动失败：' + result.error.message);
      process.exitCode = 1;
      return;
    }

    if (await isOurAppRunning(port)) {
      console.log('');
      line('已经有一个实例在 ' + url + ' 上运行，直接用那个。');
      openBrowser(url);
      return;
    }
  }

  console.log('');
  line('端口 ' + basePort + '–' + (basePort + PORT_TRIES - 1) + ' 都被别的程序占用了，没能启动。');
  process.exitCode = 1;
}

main();
