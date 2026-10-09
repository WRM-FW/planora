# Planora · 每日计划

一个给自己每天用的轻量级计划表：把一天的学习、工作、生活排进时间轴，随时看到**现在该做什么**、**今天做完了多少**。

当前版本 **1.1.2**。发布形态是 **绿色免安装版**：解压后双击 `Planora.exe` 就能用 —— 不装任何东西、**不出现任何命令行黑窗**、**不再借浏览器**：Planora 打开**自己的独立窗口**（内嵌 WebView2 渲染），计划存在**程序目录里的 JSON 文件**（`data\planora.json`）里，换电脑、清浏览器数据都不会丢。

源码同样是零依赖、零构建：`node server.mjs` 就能跑，也可以用 `tools/build-portable.mjs` 打出上面那个单文件绿色版。

已经打包好的绿色版在仓库的 **Releases** 里（`planora_<版本>.zip`，解压即用）；源码仓库带一份 `data/planora.json` 示例存档，格式和你真实的数据文件完全一样。

---

## 快速开始

### 绿色版：解压就能用

发布包解压后是一个 `planora_1.1.2` 文件夹（`make-release.mjs` 的命名规则是 `planora_<版本>`；文件夹叫什么无所谓，程序只认自己所在的目录）：

```
planora_1.1.2/
├── Planora.exe                          启动入口（双击它）：自带窗口 + 本机数据服务
├── Planora.html                         应用本体：单文件，样式 / 字体 / 脚本全部内联
├── icon.ico                             程序图标（已内嵌进 exe）
├── Microsoft.Web.WebView2.Core.dll      窗口渲染引擎（WebView2）运行库
├── Microsoft.Web.WebView2.WinForms.dll  窗口渲染引擎（WebView2）运行库
├── WebView2Loader.dll                   窗口渲染引擎（WebView2）加载器
├── 使用说明.txt
├── README.md
├── LICENSE                              MIT
├── NOTICE.md                            第三方组件与许可
├── THIRD_PARTY_LICENSES/                WebView2 SDK 与字体的许可原文
├── docs/                                给 Agent 看的：批量添加日程的规则 + 提示词模板
└── data/                第一次改动后自动出现，计划就存在这里
    ├── planora.json     ← 你的全部计划（纯文本，能直接打开看、直接拷走）
    └── planora.log      运行日志，出问题时的排查线索
```

双击 **Planora.exe** → Planora 打开**自己的窗口**（标题栏「Planora · 每日计划」），完事。第一次启动会建好 `data\` 目录和运行日志 `planora.log`，`planora.json` 则在你第一次改动（加一条计划、改个状态、甚至切一下主题）时写出来 —— 之后**任何改动都会立刻写回这个文件**，关掉再打开还是最新的数据。再双击一次不会开第二个窗口，只会把已有窗口叫到前台。

**为什么没有黑窗、也不借浏览器**：`Planora.exe` 编译成 `winexe` 子系统（`/target:winexe`），Windows **根本不会给它分配控制台**，所以从启动到退出全程没有 CMD / PowerShell 窗口。它自己就是一个极小的本机 HTTP 服务：只监听 `127.0.0.1`（不对外、不联网、不装服务、不写注册表），并通过 `/api/store` 读写 `data\planora.json`；界面不再交给系统浏览器，而是由进程内一个 WinForms 窗口里的 **WebView2** 控件加载这个本机服务来渲染 —— 所以 Planora 有属于自己的窗口、自己的图标和任务栏按钮。**关掉这个窗口，服务和窗口引擎的子进程一起退出，不留常驻后台进程。**

**数据在哪儿**：优先存在**程序目录**的 `data\planora.json`（一个与浏览器无关的物理文件）。程序目录写不了时（比如放在只读盘或 `Program Files` 下）自动改存 `%LOCALAPPDATA%\Planora\data\`，页脚会写明当前实际用的路径；也可以用环境变量 `PLANORA_DATA_DIR` 自己指定。写入顺序是「先写临时文件 → 原子替换 → 上一份留成 `.bak`」，所以中途断电、强杀进程都不会把存档写坏。窗口引擎的缓存放在程序目录的 `.webview2\`（只是浏览器内核 profile，不是计划数据）。

**直接双击 `Planora.html` 也能用**（不经过 exe）：这时没有本机服务，数据退回浏览器 localStorage，页脚会说明这一点，留底请用「导出备份」。

### 从源码跑（开发用）

```bash
cd planora
node server.mjs          # 默认 http://localhost:5173
```

打开 http://localhost:5173 即可。**不需要 `npm install`**，因为没有任何依赖（连打包器都没有）。换端口：`node server.mjs 8080`，或设环境变量 `PORT=8080`。

第一次跑会直接读到仓库里那份 `data/planora.json`（14 条虚构计划，含两条每天重复的系列和一处时间相接的重叠），所以页面上立刻有东西可看；它也是「数据文件长什么样」的现成样本。想从空档开始就把这个文件删掉，程序会自己重建。你自己的日程别提交上来：`.gitignore` 里 `data/planora.json` 那行取消注释即可。

`node server.mjs` 也实现了和 exe 一样的 `/api/store`（数据写到项目里的 `data/planora.json`），所以**开发环境和绿色版行为完全一致**，不会出现「开发时好好的、打包后又不一样」。

开发时也可以双击 `Planora-dev.cmd`（拉起本地服务 + 开浏览器 + 探测已有实例 + 端口自动递增）。这是**开发方式**，会出现一个控制台窗口用来关服务、看日志；绿色版不走这条路。

跑测试与打包：

```bash
node --test                                               # 87 个用例，秒级跑完
node tools/build-portable.mjs <输出路径>                   # 打单文件 Planora.html
node tools/verify-portable.mjs <Planora.html>             # 真实浏览器自检单文件版（18 项，file:// 兜底路径）
node tools/verify-file-store.mjs http://localhost:5173/   # 真实浏览器自检文件存储（22 项，需先启动 exe）
node tools/make-release.mjs                               # 单文件 HTML + csc 编译 exe + 组装 <输出根>/planora_<版本> 与 zip（默认根目录是工程旁的 releases/）
```

编译 `Planora.exe` 只需要 .NET Framework 4.x 自带的 `csc`（Windows 自带，无需安装任何 SDK）。1.1.2 起界面由 WebView2 承载，所以还要引用随带的 WebView2 运行库（`tools/webview2/`，发布时一并拷贝到 exe 同目录）：

```bash
csc /nologo /target:winexe /optimize+ /platform:anycpu ^
    /win32manifest:tools\Planora.exe.manifest /win32icon:assets\icon.ico ^
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll ^
    /r:tools\webview2\Microsoft.Web.WebView2.Core.dll ^
    /r:tools\webview2\Microsoft.Web.WebView2.WinForms.dll ^
    /out:build\Planora.exe tools\PlanoraServer.cs
```

> 需要 Node 18+（用到了原生 ES Module、`node --test`、`node:fs` 递归读取）。
> 注意：**源码目录里的 `index.html` 不能直接双击打开** —— ES Module 和 `@font-face` 在 `file://` 下会被 CORS 拦掉，必须走 HTTP。绿色版之所以能双击，是因为打包脚本把模块、样式、字体全部内联进了一个 HTML（见下文「绿色版是怎么打出来的」）。

---

## 为什么是这套技术栈

这个体量的应用，引入框架和打包器带来的复杂度大于收益。所以：

| 选择 | 理由 |
| --- | --- |
| 原生 ES Module | 浏览器直接支持，不需要转译、不需要构建步骤 |
| 零运行时依赖 | 没有 `node_modules`，十年后 `node server.mjs` 依然能跑 |
| 一个 30 行的静态服务器 | 只是为了让模块能被 HTTP 加载；不引入 express |
| `node --test` | Node 自带测试运行器，逻辑层是纯函数，可以直接单测 |
| 原生 `<dialog>` / `<input type="date">` | 少写一堆交互代码，且天然支持键盘和辅助技术 |

代价是：所有 UI 都要自己写（约 900 行视图代码），且只能用现代浏览器。对这个项目来说这笔账是划算的。

---

## 目录结构

```
planora/
├── index.html                 应用外壳：区域容器 + 预绘制主题脚本 + 内联 SVG favicon
├── server.mjs                 零依赖静态服务器（导出工厂 + 可直接运行）
├── launch.mjs                 开发用引导：起服务、探测已有实例、开浏览器
├── Planora-dev.cmd            开发用双击入口（检查 Node → 跑 launch.mjs）
├── package.json               type: module + start/dev/launch/test 脚本，无 dependencies
├── README.md                  本文件：设计与实现说明
├── 使用说明.txt                给绿色版用户的说明书（会打进发布包）
├── LICENSE                    MIT
├── NOTICE.md                  第三方组件清单与它们的许可
├── .gitignore
│
├── docs/
│   └── bulk-schedule-import.md  批量添加日程：交给 Agent 写 planora.json 的规则 + 提示词
│
├── data/
│   └── planora.json           示例存档（14 条虚构计划）：格式即真实数据文件的格式
│
├── THIRD_PARTY_LICENSES/      WebView2 SDK 与 OFL 字体的许可原文
│
├── tools/
│   ├── build-portable.mjs     把整个应用打成单文件 Planora.html（内含迷你打包器）
│   ├── verify-portable.mjs    单文件版自检：CDP 驱动真实 Chromium 跑 18 项（file:// 路径）
│   ├── verify-file-store.mjs  文件存储自检：22 项，含「旧浏览器数据自动搬进 JSON 文件」
│   ├── store-file.mjs         数据文件读写：原子替换 + .bak + 坏档隔离
│   ├── make-release.mjs       组装发布目录与 zip
│   ├── PlanoraServer.cs       Planora.exe 的源码（WinExe：自带 WebView2 窗口 + 本机数据服务，无控制台）
│   ├── Planora.exe.manifest   应用清单：asInvoker（不要管理员权限）+ Win10/11 兼容 + DPI 感知
│   ├── webview2/              WebView2 运行库（编译期引用 + 发布期随 exe 同目录分发）
│   └── make-icon.mjs          重新生成 icon.ico 的一次性脚本，运行时不需要
│
├── src/
│   ├── main.js                组合根：连上数据服务 → 组装 store/viewState/app → 启动
│   ├── config.js              所有常量：存储键、枚举、标签、默认时间窗
│   │
│   ├── domain/                ── 纯逻辑层：不碰 DOM、不碰存储、不碰时间源
│   │   ├── datetime.js        日期/时间的字符串运算与中文格式化
│   │   ├── plan.js            计划实体的校验、创建、打补丁、状态流转
│   │   ├── recurrence.js      重复计划：某天是否出现、那天的状态是什么
│   │   └── schedule.js        一天的视图模型：排序、筛选、统计、泳道、时间窗
│   │
│   ├── data/                  ── 持久化层
│   │   ├── backend.js         选路：本机 HTTP 服务（文件）还是浏览器 localStorage
│   │   ├── serverStore.js     /api/store 客户端：写合并、失败留影子副本、迁移决策
│   │   ├── storage.js         Web Storage 形状的抽象：版本号、迁移表、坏档隔离、内存兜底
│   │   ├── planStore.js       计划仓库：唯一的可变状态 + 订阅广播 + 写穿持久化
│   │   └── archive.js         导出/导入 JSON 备份
│   │
│   ├── state/
│   │   └── viewState.js       视图状态：当前日期 / 筛选 / 主题（只持久化后两个）
│   │
│   └── ui/                    ── 渲染与交互层
│       ├── App.js             控制器：组装区域、事件委托、快捷键、通知
│       ├── dom.js             DOM 小工具：el()/svgEl()/icon()/焦点键恢复
│       └── views/             每个区域一个纯渲染函数
│           ├── tools.js       顶栏：主题切换、新增计划
│           ├── band.js        日期导航 + 日期跳转 + 三天票根 + 筛选
│           ├── summary.js     统计数字 + 12 格完成度计量 + 状态提示
│           ├── timeline.js    日时间轴：小时刻度、泳道、当前时刻线
│           ├── planList.js    计划卡片列表 + 两种空状态
│           ├── colophon.js    页脚：导出/导入/快捷键说明/存档信息
│           └── planDialog.js  新增/编辑弹窗（原生 <dialog>）
│
├── styles/
│   ├── tokens.css             调色板与刻度（日/夜两套）+ 纸张纤维/阶梯纹理
│   ├── base.css               重置、纸面、焦点样式、减少动效
│   ├── layout.css             外壳、报头、工作区栅格、响应式断点
│   └── components.css         按钮/卡片/时间轴/弹窗/表单等组件
│
├── assets/
│   ├── fonts/                 本地打包的字体（Big Shoulders Display + Outfit，含 OFL 授权）
│   └── icon.ico               快捷方式用的图标（墨框 + 朱色色条 + 三道墨线）
│
└── tests/                     10 个测试文件，87 个用例（含本机数据服务的 HTTP 契约测试）
```

---

## 分层与数据流

单向数据流，四层各管一件事，**依赖只能从上往下**：

```
       用户操作（点击 / 键盘）
                │
                ▼
   ui/App.js  事件委托，识别 data-action
                │  调用
                ▼
   data/planStore.js  ── 唯一的可变状态（plans 数组）
                │  ├─ 校验/加工：domain/plan.js
                │  ├─ 写穿：data/storage.js → data/serverStore.js → PUT /api/store → data\planora.json
                │  └─ 广播 subscribe()
                ▼
   ui/App.js  收到变更 → 重新渲染
                │  读取
                ▼
   state/viewState.js  当前日期、筛选、主题
                │  传入
                ▼
   domain/schedule.js  buildDayView() 算出「这一天长什么样」
                │  { all, visible, stats, counts, window, current, laneCount }
                ▼
   ui/views/*.js  纯渲染函数，把数据变成 DOM
```

关键约束：

- **domain 层是纯的**：不 import 任何 DOM / storage，时间从参数传入。所以它可以被 `node --test` 直接覆盖，也能在未来搬到 Worker 或服务端。
- **只有 store 会变**：UI 不持有状态副本，每次渲染都重新算。省掉了「状态不同步」这一整类 bug。
- **组合根只有一个**：整个项目只有 `main.js` 认识 `window` / `document`。`App.js` 通过参数注入 `document`，这也是为什么渲染逻辑可以在测试里被喂假对象。

---

## 绿色版是怎么打出来的

`tools/build-portable.mjs` 做三件事，全部零依赖：

1. **内联样式与字体**：读 `index.html` 的 `<link rel="stylesheet">`，把 5 份 CSS 拼成一段 `<style>`；`url()` 指向的 woff2 转成 base64 data URI（只处理看起来像相对路径的引用，`url(%23grain)` 这类编码引用原样保留，缺文件就直接报错）。
2. **把 21 个模块打成一个普通 `<script>`**：顺着 `import` 递归收集 `src/**`，深度优先后序排列（遇到循环依赖立刻报错退出）；每个模块包成 `__def(id, function (__exports) { "use strict"; ... })`，`import { a } from "./x.js"` 改写成 `const { a } = __req("src/x.js")`，`export` 名字收集起来在模块末尾 `Object.assign(__exports, {...})`。产物是**普通脚本而不是 module**，所以不受 `file://` 的 CORS 限制；它放在 `</body>` 前原位替换，执行时 DOM 已就绪。
3. **收尾自检**：构建完断言页面里再没有 `src="./…"` / `href="./…"` 外链，否则直接失败退出。

产物约 210 KB，其中约 90 KB 是 base64 字体的体积；其余是内联 CSS 与打包后的脚本。

---

## 本机数据服务（1.1.1 起的默认存储）

**为什么非要一个服务**：浏览器里的页面（`file://` 或普通网页）既不能读也不能写它旁边的文件 —— 没有文件写权限，还会被 CORS 挡住。要让「数据就存在程序目录里的一个 JSON 文件」成立，只能由程序自己起一个只监听回环地址的小服务。代价是多了一个 HTTP 服务，收益是数据变成了与浏览器无关、可以直接拷走的物理文件。

**接口只有四个**：

| 接口 | 作用 |
| --- | --- |
| `GET /api/ping` | 报个平安，顺便告诉页面数据文件在哪、exe 版本是多少 |
| `GET /api/store` | 取回全部键（`{ keys: { "planora/plans/v1": "…" } }`） |
| `PUT /api/store` | 整份写回（请求体 `{ keys: {…} }`），落盘后才回 200 |
| `POST /api/bye` | 可选的礼貌告别（现在客户端不用它） |

其余路径一律走白名单：`/`、`/index.html`、`/Planora.html`、`/icon.ico`、`/favicon.ico`，所以不存在目录穿越；`/data/*` 明确 404（存档不会通过 HTTP 泄露）；请求体上限 4 MB。

**端口**：先抢 `5173`；被占用就依次试 `5180`-`5189`。老版本（1.0.0 之前）用的是 `localhost:5173` 的浏览器存储，所以**只要 5173 没被别的程序占掉，第一次启动就会自动把老数据认领进 JSON 文件**，不用手动导出导入。若 5173 被占用而落到了别的端口，自动认领拿不到老数据（浏览器按源隔离），这时用页脚的「导出备份 / 导入备份」搬一次即可。

**只监听 `127.0.0.1`，而且故意不开 CORS**。这两个选择是连在一起的：如果为了「让 file:// 页面也能写文件」而放开跨域，那**任何一个网站都能读你的计划、往你的数据文件里写东西**。所以宁可让 `file://` 直开时退回 localStorage，也不放开这个口子。

**数据目录优先级**：`PLANORA_DATA_DIR` 环境变量 → 程序目录下的 `data\`（可写就用它） → `%LOCALAPPDATA%\Planora\data\`。页脚永远显示当前实际用的路径，不猜。

**写盘与容错**：

- 每次改动都会触发一次写；连续快速改动会合并成一次（尾随去抖），页面被关掉的瞬间用 `keepalive` 请求把最后一次写送完。
- 落盘顺序：写 `planora.json.tmp` → `File.Replace` 原子替换 → 旧内容自动成为 `planora.json.bak`。**任何时刻磁盘上要么是旧的完整文件、要么是新的完整文件**，不会出现半个 JSON。
- 文件被外部改坏（手工编辑出错等）：读不动就把坏文件改名成 `planora.json.corrupt-<时间戳>` 保留证据，然后从空档继续跑，不白屏。
- 写失败（磁盘满、权限变化）：浏览器里留一份「影子副本」，页脚报警；下一次写成功后自动清掉。
- 只有「拿到的是空档 且 浏览器里确实有老数据 且 从没认领过」三个条件同时成立才会认领老数据。认领过会记一个标记，所以**把 `planora.json` 删掉也不会把浏览器里的老数据又翻出来**。

**生命周期（1.1.2 改为「窗口即应用」）**：进程里跑着一个 WinForms 窗口，窗口内的 WebView2 控件加载本机服务渲染界面。**窗口的寿命就是进程的寿命**：点 × 关窗 → `Application.Run` 返回 → 停掉本机服务、释放 WebView2（它的浏览器子进程随之退出）→ 进程结束，后台不留任何东西。不再有 1.1.1 那套「页面关掉后靠 5 分钟空闲超时自杀」的间接机制。再双击一次 `Planora.exe` 不会开第二个窗口：用一个命名 Mutex 做单实例，后启动的那个把已有窗口叫到前台后自己退出。

**为什么 1.1.2 不再打开系统浏览器**：1.1.1 的绿色版虽然没有了黑窗，但界面是交给系统默认浏览器的一个标签页 —— 用户看到的「Planora」其实是 Edge/Chrome 的窗口，而且为了「双击后一定能看到页面」要维护七种打开浏览器的兜底办法（`ShellExecute` 在无消息循环的 winexe 进程里会静默失败等一堆坑）。1.1.2 把界面收回到进程自己的窗口里（WebView2 内嵌渲染），这些兜底逻辑整体退役：窗口由 WinForms 直接创建，不经过外壳异步交接，也就没有「双击了什么都没发生」的问题。唯一保留的兜底是：万一这台机器没装 WebView2 运行时，弹框说明并临时改用系统浏览器打开，保证功能不中断。

**WebView2 初始化必须留在 UI（STA）线程上**：把 `CoreWebView2Environment.CreateAsync(...)` 丢到线程池（MTA）上 await 会报 `RPC_E_CHANGED_MODE`（0x80010106，「无法在设置线程模式后对其加以更改」），窗口就白屏。正确做法是在 `form.Shown`（本来就在 UI 线程）里直接 `await` 环境创建与 `EnsureCoreWebView2Async`，再 `Navigate` 到本机服务地址。

窗口引擎的 profile / 缓存放在程序目录的 `.webview2\`（只读目录时退到 `%LOCALAPPDATA%\Planora\webview2`）。它只是浏览器内核的缓存，**不是计划数据**；计划数据始终且只在 `data\planora.json`。

自动化测试想对着运行中的服务跑自检，直接启动 exe 后用 `node tools/verify-file-store.mjs http://localhost:5173/` 即可（它自己起一个无头 Chromium 连服务，不碰 Planora 的窗口）。

---

## 数据模型

存档就是一个纯文本 JSON 文件 `data\planora.json`，格式是「键 → 值」，值沿用原来的那几段 JSON 字符串：

```json
{
  "format": "planora-store/v1",
  "app": "planora",
  "version": "1.1.2",
  "savedAt": "2026-10-08T18:18:41+08:00",
  "keys": {
    "planora/plans/v1": "{\"version\":1,\"plans\":[…]}",
    "planora/view/v1": "{\"version\":1,\"filter\":\"all\",\"theme\":\"auto\"}"
  }
}
```

键名一直沿用 localStorage 时代的 `planora/plans/v1` / `planora/view/v1`（更名前还用过 `daily-planner/*`，会自动认领），所以**换存储方式不改数据格式**，以前导出的备份照样能导入。计划那一段长这样：

```json
{
  "version": 1,
  "plans": [
    {
      "id": "k3f9x2a1",
      "title": "复习线性代数",
      "date": "2026-10-08",
      "start": "09:00",
      "end": "10:30",
      "priority": "high",
      "status": "todo",
      "repeat": "none",
      "repeatUntil": null,
      "overrides": {},
      "createdAt": "2026-10-08T01:12:00.000Z",
      "updatedAt": "2026-10-08T01:12:00.000Z"
    }
  ]
}
```

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `id` | 字符串 | 创建时生成，导入备份时用来判重 |
| `title` | 1–60 字 | 前后空白会被裁掉 |
| `date` | `YYYY-MM-DD` | 计划开始的那一天 |
| `start` / `end` | `HH:MM` | `end` 必须晚于 `start` |
| `priority` | `high` / `medium` / `low` | 影响排序、配色和卡片左侧色条 |
| `status` | `todo` / `doing` / `done` | 未开始 / 进行中 / 已完成 |
| `repeat` | `none` / `daily` | `daily` = 从 `date` 起每天出现 |
| `repeatUntil` | `YYYY-MM-DD` 或 null | 重复截止日（含当天）；null = 一直重复 |
| `overrides` | `{ "YYYY-MM-DD": status }` | **重复计划在某一天的状态覆盖值** |

### 重复计划为什么不复制成多条记录

「每天背单词」如果每天生成一条记录，一周后就会有 7 条几乎一样的计划：编辑要改 7 次，统计会数错，删除要删 7 次。

所以这里把重复计划当**一条系列记录**：

- 它在日历上是「从 `date` 到 `repeatUntil` 的每一天都出现」（`domain/recurrence.js` 的 `occursOn`）。
- **每天各有各的完成状态**，存在 `overrides[日期]` 里；没被覆盖的日子用系列默认的 `status`。
- 关键规则：**在重复计划上改状态，永远写覆盖值，绝不改系列默认值**（`planStore.setStatus`）。否则把某一天勾成完成，整条系列都会变成完成。
- 覆盖值恰好等于系列默认值时会删掉，避免存档里堆积冗余。

删除删的是整条系列；编辑改的也是整条系列。

### 其他两个设计选择

- **日期和时间用字符串，只在算数时转成分钟**。`"2026-10-08"` 不会因为时区偏移变成前一天，`"09:00"` 也不会因为序列化丢精度。转换集中在 `datetime.js`（`minutesFromTime` / `timeFromMinutes`）。
- **存储带版本号和迁移表**。`createJsonStore({ version, migrations })` 按 `0 → 1 → 2` 逐级迁移；读不动就整份隔离成 `<key>.corrupt` 并**从空库继续跑**，而不是白屏。存储完全不可用时（隐私模式）自动退回内存实现，界面会照实说明「本地存储不可用」。
- **换存储方式不动上层**。`planStore` 只认识一个「Web Storage 形状」的对象（`getItem` / `setItem` / `removeItem`）。1.1.1 加文件存储时，新写的是一个**形状相同的适配器**（`serverStore.js`：把 `setItem` 变成「合并 + PUT」），`planStore`、`viewState`、UI 一行都没改。这也是当初把存储收进 `data/` 这一层的原因。

---

## 批量添加日程：把整份课表交给 Agent

一份 30 节的课表要在界面上点 180 次。量大的时候别一条条加：**把日程原文和 `data\planora.json` 一起交给 Agent（Qoder / Claude / Cursor 之类都行），让它整理成规定字段后写回文件**。数据就是一个纯文本 JSON，程序不在乎这一条是谁写进去的，只在乎格式和字段过不过校验。

完整的写法、字段规则表、可直接复制的提示词模板和自检脚本在 **[`docs/bulk-schedule-import.md`](docs/bulk-schedule-import.md)**。这里只留三条最容易踩的：

1. **先退出 Planora 再改文件。** 页面启动时把整份数据读进内存，之后每次改动都是「把内存里的全部键整份写回」。程序还开着就改文件，你写的那份会在下一次点击时被内存里的旧副本覆盖掉。
2. **`keys["planora/plans/v1"]` 的值是字符串，不是对象。** 计划那段 JSON 在外层文件里是被转义过的（里面的引号写成 `\"`）。写成对象的话，读盘时「不是字符串的值」会被直接丢掉，表现为打开后所有计划都不见了 —— 这是 Agent 批量写入最常见的翻车点。
3. **重复只有 `daily`，没有「每周几」。** 周一三五的课必须按每一个具体日期各写一条 `repeat: "none"`；只有真正天天要做的事才写成一条 `daily` 系列（`date` 起始日 + `repeatUntil` 结束日，某一天的完成情况放 `overrides`）。用 `daily` 糊过去，周末也会长出课来。

还有个必须知道的性质：**校验没过的那条会被静默丢弃**，不报错也不提示，下一次保存就把这条永久写没了。所以写完先拿 `normalizePlan()` 过一遍（文档里有现成的一小段脚本），别靠「打开看看好像是对的」。

如果不想手改数据文件，还有更稳的一条路：让 Agent 产出页脚「导入备份」那种格式的文件（`{"app","version","exportedAt","plans":[…]}`，`plans` 是真正的 JSON 数组，没有转义坑），再在界面里导入 —— 按 `id` 合并、由程序自己校验、不会清空现有数据。两条路的取舍写在上面那份文档里。

---

## 使用说明

**加计划**：右上角「新增计划」或按 `N`。弹窗会按当前时间自动推荐一个时段（下一个整/半点开始，一小时长）。

**改和删**：卡片右侧的铅笔 / 垃圾桶。删除是两步确认（点了删除后变成「确认删除」），不做弹窗拦截。

**改状态**：点卡片左侧的印章在「已完成 / 未完成」间切换；点中间的状态按钮按「未开始 → 进行中 → 已完成」循环。

**看别的日期**：`←` / `→` 换天，`T` 回到今天；也可以直接点日期输入框跳转，或用「昨天 / 今天 / 明天」三个票根。查看其它日期时不会出现「现在」标记。

**筛选**：全部 / 未完成 / 已完成，后面跟着当天的条数。

**深色模式**：顶栏的太阳/月亮按钮三态循环——跟随系统 → 日间油墨 → 夜间油墨。夜间不是简单反色，而是同一块版「换一色再印」：版式、套印偏移、纹理方向都不变，只换油墨。

**备份**：页脚「导出备份」下载 `planora-<日期>.json`；「导入备份」按 `id` 合并（同 id 覆盖，新 id 追加），不会清空现有数据。

**进行中提示**：正在进行的计划会有琥珀色描边、卡片左侧加粗色条和「NOW」角标，时间轴上对应的块也会点亮；已过时段会变淡。页面每 60 秒自动重绘一次，所以时刻线会自己走。

### 键盘快捷键

| 按键 | 作用 |
| --- | --- |
| `←` / `→` | 前一天 / 后一天 |
| `T` | 回到今天 |
| `N` | 新增计划 |
| `Esc` | 关闭弹窗 |
| `Tab` | 正常遍历；弹窗打开时焦点锁在弹窗内 |

在输入框里打字时方向键和字母键不会被抢走。重新渲染后会按「焦点键」把键盘位置还原到同一张卡片的同一个按钮上，所以连续操作不会丢焦点。

---

## 视觉：丝印海报

视觉参考的是丝印海报（silkscreen poster），不是常见的柔和拟物卡片：

- **一色一印**：整页最多 6 种油墨 + 纸白，每个优先级/状态各占一种墨色，语义靠「颜色 + 形状」双重编码（色盲也能分辨）。
- **没有渐变**：需要层次就用**阶调**——完成度是 12 格阶梯计量条，时间轴底部是台阶纹理。
- **硬边与套印偏移**：2px 实边、零圆角、位移 3px 的实色投影（`--reg`），像印版没对准的错位。
- **纸感**：纸底色 + SVG `feTurbulence` 纤维纹理（日间正片叠底、夜间滤色），外面留一圈纸白（`inset 0 0 0 2px`）。
- **字体本地打包**：Big Shoulders Display（数字/标题）+ Outfit（标签），离线可用；中文回退到系统雅黑/苹方。

---

## 测试

```bash
node --test
```

87 个用例，覆盖：

| 文件 | 覆盖内容 |
| --- | --- |
| `datetime.test.js` | 日期键校验（含 2 月 30 日、闰年）、跨月跨年加减、星期/中文格式化、时间与分钟互转 |
| `plan.test.js` | 逐字段校验、错误能贴回表单、补丁白名单、坏数据归一化、状态流转与优先级排序 |
| `recurrence.test.js` | 重复的出现区间、按天取状态、一次性计划忽略脏 overrides |
| `schedule.test.js` | 统计与完成率、筛选、排序、泳道分配、时间窗自动扩边、`isNow`/`isPast`、时长不为 NaN |
| `storage.test.js` | 版本往返、坏 JSON 隔离备份、高版本拒读、逐级迁移、配额异常、内存兜底 |
| `planStore.test.js` | 写穿持久化、订阅广播、**重复计划的状态只写当天覆盖值**、逐天勾选互不影响 |
| `viewState.test.js` | 日期不持久化（每天回到今天）、脏偏好被忽略、主题三态解析 |
| `archive.test.js` | 导出/导入往返、坏条目跳过计数、裸数组兼容 |
| `modules.test.js` | 动态 import `src` 下每个模块（顺带查错导入路径），并核对外壳区域 id |
| `storeApi.test.js` | **真起一个服务进程**：ping、静态文件、PUT→落盘→GET、`.bak` 与临时文件清理、400/403/404/413、坏档隔离 |

一个已知的缺口：`src/data/serverStore.js` 里没有单测。它的 HTTP 契约由 `storeApi.test.js` 从服务端侧覆盖，但纯函数 `decideBootstrap()`（启动时决定认服务端 / 认影子副本 / 认旧浏览器数据 / 开新档）本身没有对着它的用例 —— 这块的逻辑只有真机升级时才会被走到。补它只需要一个假 `request`，是这份代码里性价比最高的待补测试。

---

## 浏览器要求

需要支持 ES Module、CSS 自定义属性、`:has()`、`<dialog>`、`input[type=date|time]`：

Chrome / Edge 105+、Firefox 121+、Safari 15.4+。移动端布局可用，但这是按桌面做的工具。

---

## 后续可以怎么扩展

这个结构是照着「以后要加东西」设计的，几个明显的下一步：

- **统计页**：`domain/schedule.js` 已经能给出任意一天的 `summarize()` 结果，加一个周/月视图只需要在新模块里按区间累加，UI 上多一个区域。
- **提醒**：新增 `domain/reminders.js`（纯逻辑：给「现在」和计划列表，算出该提醒什么），UI 上加一个通知视图 + 权限申请；不需要动存储层。
- **更多重复规则**：只改 `recurrence.js` 的 `occursOn()`（比如工作日、每周几），`overrides` 机制不用动。
- **云端同步**：`planStore` 要的还是「Web Storage 形状」的适配器。`serverStore.js` 已经示范了怎么把 `setItem` 接到 HTTP 上，换成远端接口即可，UI 一行都不用改。
- **多设备同步**：现在的服务只监听本机，天然不做同步。真要跨设备，就在 `data/` 下再加一个后端：同一个 `planStore` 接口，写到远端（并且得自己解决冲突）。
- **多语言**：文案集中在 `config.js` 和各视图的常量里，抽出来就是字典。
- **界面内的批量录入**：现在几十上百条靠 Agent 写数据文件（见 `docs/bulk-schedule-import.md`）。最该补的下一步是在应用里做一个「粘贴课表文本 → 解析成条目 → 列表预览 → 确认写入」的入口：校验（`validatePlanInput`）、归一化（`normalizePlan`）和写入（`planStore.replaceAll`）都已经有了，缺的只是一个解析器 —— 而且它得先把「周一三五 8:30-10:10 线性代数」这类按周几的描述，配上起止周展开成一个个具体日期，因为 `repeat` 只有 `daily`、表达不了「每周几」。预览这一步不能省：校验不过的条目是静默丢弃的，「导入成功但少了 3 条」完全可能发生。

---

## 已知取舍

- 用 exe 启动时数据在程序目录的 JSON 文件里：关浏览器、换浏览器、清浏览器数据都不影响；直接双击 `Planora.html` 时才会退回浏览器 localStorage。
- 自动认领老数据只在服务能占到 `5173` 端口时生效（浏览器按源隔离）。占不到就用导出/导入备份搬一次。
- 服务只监听本机回环地址，也没有做鉴权 —— 它本来就不该给别的机器或别的网站访问。
- 重复只支持「每天」，没有工作日 / 每周 / 每月。
- 时间轴不能拖拽改时间，改时间走编辑弹窗。
- 时间窗默认 06:00–22:00，有更早/更晚的计划时自动扩边（最晚到 24:00）。
- 重叠的计划并排显示在两条泳道里，不做自动避让堆叠。

---

## 许可与第三方组件

本项目源码是 **MIT**（`LICENSE`，© 2026 WRM-FW）。两样东西不是我的，也不在这个 MIT 授权范围内：

- **WebView2 SDK**：`tools/webview2/` 里三个 DLL 是 NuGet 包 `Microsoft.Web.WebView2` **1.0.4258.31** 的原样副本，没有改动。Microsoft 那份许可（BSD-3-Clause 风格）允许以源码或二进制形式再分发，前提是保留版权声明和免责声明 —— 原文照抄在 `THIRD_PARTY_LICENSES/Microsoft.Web.WebView2-BSD-3-Clause.txt`，包自带的第三方声明在 `Microsoft.Web.WebView2-NOTICE.txt`。清单和重新获取方式见 `NOTICE.md`。
- **字体**：`assets/fonts/` 下两个 woff2（Big Shoulders Display、Outfit）是 SIL Open Font License 1.1 的子集，原文在 `assets/fonts/OFL.txt`。

另外，真正渲染界面的 **WebView2 Runtime**（Edge/Chromium 内核）是系统组件，Win10/11 一般自带，不在仓库里、也不受本项目许可约束。

npm 依赖为零 —— `package.json` 里没有 `dependencies`，所以不存在任何第三方 JS/CSS 被 vendored 进来。
