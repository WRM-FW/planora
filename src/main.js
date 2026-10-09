/**
 * 组合根：整个应用只有这里知道「浏览器」的存在。
 * 上层模块都通过参数拿依赖，所以 domain / data / state 可以在 Node 里直接测试。
 *
 * 启动顺序：先问本地数据服务要数据（程序目录里的 JSON 文件），
 * 拿不到才退回浏览器 localStorage —— 单文件版本依然能直接双击打开。
 */
import { openBackend, attachUnload } from "./data/backend.js";
import { createNoteStore } from "./data/noteStore.js";
import { createApp } from "./ui/App.js";

function fatal(err) {
  const box = document.getElementById("summary");
  if (box) {
    box.textContent = "Planora 启动失败：" + ((err && err.message) || err);
  }
  if (typeof console !== "undefined" && console.error) console.error(err);
}

openBackend({ window: window, document: document }).then(function (backend) {
  const noteStore = createNoteStore({
    request: backend.request,
    storage: backend.storage,
    window: window
  });
  // 先拉取便利贴 / 废纸篓文档，再启动 UI —— 保证首帧就有内容，不闪空白贴。
  return noteStore.load().then(function () {
    const app = createApp({
      document: document,
      window: window,
      storage: backend.storage,
      status: backend.status,
      noteStore: noteStore
    });
    app.start();
    attachUnload(window, backend.storage);
    // 便利贴也挂到「离开前保存」上，关窗前把没落盘的改动送出去。
    if (window && typeof window.addEventListener === "function") {
      window.addEventListener("pagehide", function () { noteStore.flush(); });
    }
    // 方便在控制台里查看/调试本地数据
    window.planora = app;
    return app;
  });
}, fatal);
