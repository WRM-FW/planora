# 批量添加日程：把整周课表交给 Agent 写进 `planora.json`

手动加一条计划要点七八下（新增、标题、日期、开始、结束、优先级、保存）。十几条还行，一份三十节的课表就是两百多次点击，还得连着几天把每天的重复项勾出来。

所以量大的时候，正确的做法不是去点界面，而是**把日程原文和 `data\planora.json` 一起交给 Agent（Qoder / Claude / Cursor 之类的都行），让它按规则整理并写回文件**。Planora 的数据就是一个纯文本 JSON，程序对「文件是自己写的还是 Agent 写的」没有任何区别 —— 它只在乎格式对不对、字段过不过校验。

这篇文档说清楚四件事：文件格式的坑在哪、字段的硬规则、直接复制给 Agent 的提示词、写完怎么自检。

---

## 先选一条路

| 情况 | 走哪条 |
| --- | --- |
| 十条以内 | 别折腾，界面上加更快 |
| 往里加一批已有的数据、或者不想手改数据文件 | **方式 B**：让 Agent 产出「导入备份」文件，页脚点「导入备份」 |
| 从空档开始建档、要一次写几十上百条、或者要整份重排 | **方式 A**：让 Agent 直接写 `data\planora.json` |

**已有数据优先走 B。** 那个文件里的 `plans` 是**真正的 JSON 数组**，没有下面要说的那层字符串转义；导入时程序自己走一遍校验，坏了会在页脚告诉你原因，而且按 `id` 合并、不会清空现有数据。它的短板只有两条：不能删东西，也不能改已有条目的结构。A 的掌控力更强（能整份重写），代价是三条硬规矩一条都不能破。

---

## 方式 A 的三条硬规矩

**1. 先完全退出 Planora（把窗口关掉）。**
页面启动时把整份数据读进内存，之后每一次改动都是「把内存里的全部键整份 PUT 回文件」。程序还开着的时候改文件，你改的那一份会在下一次点击时被内存里的旧副本覆盖掉 —— 现象是「明明写进去了，重开又没了」。同理，也别绕道去 `PUT http://localhost:5173/api/store`：改了文件也照样被页面覆盖回来。

**2. 先把 `data\planora.json` 复制一份。**
文件被改坏时程序不会崩：解析不了的话，它把坏文件改名成 `planora.json.corrupt-<时间戳>` 保留证据，然后从空档继续跑。所以出事的表现是「打开后一条计划都没有」，而不是报错。有备份才能一键回滚。（程序自己保存时也会留 `planora.json.bak`，但那是它上一次成功保存的内容，救不了手改的这次。）

**3. 只追加，不重写。**
让 Agent 在现有 `plans` 数组后面加条目，不要删除或改写已有条目，尤其不要改已有的 `id` —— `id` 是「导入备份」判重的唯一依据，改了就没法对应上了。

---

## 文件结构：外层信封 + 内层字符串

`data\planora.json` 长这样（这是仓库里那份示例存档的真实结构）：

```json
{
  "format": "planora-store/v1",
  "app": "planora",
  "version": "1.1.2",
  "savedAt": "2026-10-09T08:00:00.000Z",
  "keys": {
    "planora/plans/v1": "{\"version\":1,\"plans\":[ … ]}",
    "planora/view/v1": "{\"version\":1,\"filter\":\"all\",\"theme\":\"auto\"}"
  }
}
```

**最容易翻车的一点：`keys` 里每个值都是一个字符串，不是对象。** 计划那段 JSON 是被转义过的（`\"` 这种）。这是从 localStorage 时代沿用下来的形状 —— 存储层只认「字符串键值」：`tools/store-file.mjs` 读盘时把**不是字符串的值整条丢掉**，exe 那边的 `tools/PlanoraServer.cs` 同样只留字符串值。所以：

- 写成 `"planora/plans/v1": {"version":1,"plans":[…]}`（对象）→ 这个键直接消失，打开程序所有计划都不见了。
- 外层 JSON 少个引号、多个逗号 → 整个文件解析失败，被改名成 `.corrupt-<时间戳>`，从空档开始。

手搓这么长一串转义 JSON 迟早出错。稳妥做法是**让 Agent 只写内层的 plans，外层信封用脚本套**。把这段存成项目根目录的 `wrap-plans.mjs`（用完可以删掉，不是仓库内容）：

```js
// wrap-plans.mjs —— 把内层 plans 文件套上信封，按 id 合并进 data/planora.json
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

const FILE = "data/planora.json";
const KEY = "planora/plans/v1";
const IN = "plans.new.json";   // Agent 产出的内层：{"version":1,"plans":[…]} 或裸数组

if (existsSync(FILE)) copyFileSync(FILE, FILE + ".backup");   // 先留一份

const doc = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, "utf8"))
  : { format: "planora-store/v1", app: "planora", version: "1.1.2", keys: {} };
if (!doc.keys || typeof doc.keys !== "object") throw new Error("存档没有 keys 对象，先别写");

const payload = JSON.parse(readFileSync(IN, "utf8"));
const plans = Array.isArray(payload) ? payload : payload.plans;
if (!Array.isArray(plans)) throw new Error(IN + " 里没有找到计划数组");

const byId = new Map();
const old = doc.keys[KEY] ? JSON.parse(doc.keys[KEY]) : { version: 1, plans: [] };
(old.plans || []).forEach(function (p) { byId.set(p.id, p); });
plans.forEach(function (p, i) {
  if (!p.id) p.id = "plan-" + Date.now().toString(36) + "-" + i + Math.random().toString(36).slice(2, 6);
  byId.set(p.id, p);   // 同 id 覆盖，新 id 追加
});

doc.keys[KEY] = JSON.stringify({ version: 1, plans: Array.from(byId.values()) });
doc.savedAt = new Date().toISOString();
writeFileSync(FILE, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log("OK: total " + byId.size + " plans (merged " + plans.length + ")");
```

跑 `node wrap-plans.mjs`。它只换 `planora/plans/v1` 这一个键，视图偏好之类的其它键原样保留。

---

## 字段规则

每条计划必须长成这样。其中 `title` / `date` / `start` / `end` / `priority` / `status` 是必填 —— **少任何一个、或取值不合法，这条会被静默丢弃**，不报错也不提示：

```json
{
  "id": "plan-mw101-422e",
  "title": "线性代数",
  "date": "2026-10-12",
  "start": "08:30",
  "end": "10:10",
  "priority": "high",
  "status": "todo",
  "repeat": "none",
  "repeatUntil": null,
  "overrides": {},
  "createdAt": "2026-10-09T08:00:00.000Z",
  "updatedAt": "2026-10-09T08:00:00.000Z"
}
```

| 字段 | 必填 | 合法取值 | Agent 常犯的错 |
| --- | --- | --- | --- |
| `id` | 可省略（缺了会自动生成一个） | 非空字符串，整个数组里唯一 | 两条用了同一个 id（后一条顶掉前一条） |
| `title` | 是 | 去首尾空格后 1–60 字 | 超长；只有空格 |
| `date` | 是 | `YYYY-MM-DD`，必须是真实日期 | `2026-2-3` 没补零；`2026-02-30` 不存在 |
| `start` / `end` | 是 | `HH:MM` 24 小时制、两位补零，`00:00`–`23:59` | 写成 `9:00`；`end` 写成 `24:00`（不合法，最晚 `23:59`）；`end` 早于 `start` |
| `priority` | 是 | `high` / `medium` / `low` | 写 `urgent`、`中`、`1` |
| `status` | 是 | `todo` / `doing` / `done` | 写 `completed`、`finish` |
| `repeat` | 可省略（缺了按 `none`） | `none` / `daily` | 写 `weekly`（不支持）；见下一节 |
| `repeatUntil` | 可省略（缺了按 `null`，即永久重复） | `YYYY-MM-DD` 或 `null`，不能早于 `date` | 以为「不重复」要填空串；截止日期早于开始日期 |
| `overrides` | 可省略（缺了按 `{}`） | `{"YYYY-MM-DD": "todo\|doing\|done"}` | 给一次性计划写 overrides（会被忽略）；值写成三个状态以外的东西 |
| `createdAt` / `updatedAt` | 建议 | ISO 8601 字符串 | 缺了会被补成「程序读文件的当下」，不影响使用，但排查时时间线会失真 |

时间**不支持跨零点**：一段 22:00–02:00 的夜班写不进去（`end` 必须晚于 `start`，且都在同一天内）。真要写就拆成两条。

规则来源：`src/domain/plan.js` 的 `validatePlanInput()` 和 `normalizePlan()`，`src/domain/datetime.js` 的 `DATE_RE` / `TIME_RE`。改了这三个文件，这张表就得跟着改。

---

## 「每天重复」不等于「每周几」

`repeat` 只有 `daily`，实现是 `recurrence.js` 的 `occursOn()`：**从 `date` 起到 `repeatUntil`（含）为止，每一天都出现**。没有工作日、没有每周几、没有每月。

于是：

| 原始日程 | 正确的写法 |
| --- | --- |
| 每天早上 7:30 晨读，持续到 11 月底 | **1 条**：`date` = 起始日，`repeat` = `daily`，`repeatUntil` = `2026-11-30`，`overrides` = `{}` |
| 周一、周三、周五 8:30 的线性代数 | **3 条**（一周），每条 `repeat` = `none`。用 `daily` 会把周末也变成有课 |
| 周一到周五晚上自习 | **5 条**，或者接受「周末也有」而写 1 条 `daily` —— 按你实际想看到的效果选 |
| 已经上过的一学期课 | 按具体日期展开，一次性计划；不要建 `daily` 系列再去一天天地删（删除删的是整条系列，删不掉单独一天） |

**一条 `daily` 系列的默认 `status` 要写 `todo`。** 某一天的完成情况写进 `overrides`，比如 `{"2026-10-08": "done"}`。因为界面上「在重复计划上改状态」永远只写当天覆盖值（`planStore.setStatus`），而如果你在 `status` 上直接写 `done`，那这个系列**每一天**都会显示已完成。

---

## 提示词模板（方式 A）

把下面这段连同两份输入一起发给 Agent。规则都写在里面了，所以即使它没读过本仓库也能干活；但它若能读到你项目里的这份文档，效果更稳。

```text
你是我的 Planora 数据维护助手。请按我给的规则，把下面这份日程原文整理并合并进 Planora 的数据文件。

【输入 1】现有 data\planora.json 的全文：
<<<现有存档开始>>>
（把文件内容粘在这里）
<<<现有存档结束>>>

【输入 2】要新增的日程原文（可能几十条）：
<<<日程原文开始>>>
10/12（周一）8:30-10:10 线性代数
10/13（周二）10:30-12:10 概率论
每天早上 7:30 晨读英语半小时，持续到 11 月底
<<<日程原文结束>>>

必须遵守的规则：
1. 只做追加：不要删除、改写或重排已有的计划，不要改已有的 id。
2. 外层 keys["planora/plans/v1"] 的值必须仍然是「字符串」，不要改成对象。
3. 每条计划字段齐全：id / title / date / start / end / priority / status / repeat / repeatUntil / overrides / createdAt / updatedAt。
4. 日期一律 YYYY-MM-DD，时间一律 HH:MM（24 小时制、两位补零）；end 必须晚于 start，不支持跨零点。
5. priority 只能是 high / medium / low；status 只能是 todo / doing / done；repeat 只能是 none / daily。
6. 重复只支持「每天」。所以「周一/周三/周五」这类按周几的课，要按每一个具体日期展开成多条 repeat:"none"，不要用 daily 糊过去。
   只有真正天天要做的事才写成一条 daily 系列（date 起始日 + repeatUntil 结束日）。
7. daily 系列的 status 写 todo，某一天的完成情况才写进 overrides，形如 {"2026-10-08":"done"}。非重复计划 overrides 写 {}。
8. title 去掉首尾空格后不超过 60 字，不要写换行。
9. 新条目的 id 用 plan-<毫秒时间戳的 base36>-<序号加 4 位随机 base36>，并保证在整个数组里唯一。
10. 不要动 keys 里的其它键；内层对象的 version 必须是 1。
11. 不要假设 Planora 正在运行，也不要调用它的本地 HTTP 接口。
12. 原文里缺信息（没写结束时间、没说上几周、教室和星期对不上）时，把问题列出来问我，不要自己编。

请输出三样东西：
A. 合并后的完整 data\planora.json 内容（可以直接覆盖文件的）。
B. 一张对照表：日程原文的每一条 → 你写成了几条、日期和时段分别是什么、是不是 daily 系列。
C. 你不确定、留了空或问我的地方。
```

拿到 A 之后：先关掉 Planora 窗口、备份原文件、覆盖写入，再按下一节自检，最后才打开程序确认。

如果走方式 B，把第 2 条和第 10 条换成「产出一个导入文件：`{"app":"planora","version":1,"exportedAt":"<ISO 时间>","plans":[ … ]}`，`plans` 是真正的 JSON 数组，不要外层信封、不要转义字符串」，其余规则照用。

---

## 自检：让程序自己的校验函数过一遍

界面上「看起来是对的」不代表存得进去 —— 校验失败的条目是**静默丢弃**的。所以写完文件先跑一遍校验，用的就是应用加载数据时调用的那个 `normalizePlan()`。把这段存成项目根目录的 `check-plans.mjs`：

```js
// check-plans.mjs —— 用应用自己的校验函数检查 data/planora.json
import { readFileSync } from "node:fs";
import { normalizePlan } from "./src/domain/plan.js";

const doc = JSON.parse(readFileSync("data/planora.json", "utf8"));
const raw = doc.keys["planora/plans/v1"];
if (typeof raw !== "string") {
  console.log("BAD: plans key is " + typeof raw + ", must be a JSON string");
  process.exit(1);
}
const inner = JSON.parse(raw);
const seen = new Set();
let dropped = 0;
inner.plans.forEach(function (p, i) {
  const n = normalizePlan(p);
  if (!n) {
    dropped += 1;
    console.log("DROP #" + (i + 1) + ": " + JSON.stringify(p));
    return;
  }
  if (seen.has(n.id)) console.log("DUP id: " + n.id + " (#" + (i + 1) + ")");
  seen.add(n.id);
  Object.keys(n).forEach(function (k) {
    if (JSON.stringify(n[k]) !== JSON.stringify(p[k])) {
      console.log("FIX #" + (i + 1) + " " + k + ": " + JSON.stringify(p[k]) + " -> " + JSON.stringify(n[k]));
    }
  });
});
console.log("plans=" + inner.plans.length + " dropped=" + dropped);
```

```bash
node check-plans.mjs
```

看四件事：`plans` 键是不是字符串、`dropped` 是否为 0、有没有 `DUP id`、`FIX` 行里有没有你不想接受的改动（最常见的是 title 两头空格被裁掉、缺 `id` 被补了一个、缺 `repeatUntil` 被补成 `null`）。输出里刻意用 `DROP`/`FIX` 这种 ASCII 标记，是因为中文 Windows 控制台默认 GBK 编码，打 ✓ 或 ⚠ 会变成乱码。

最省事的对照是跑完直接打开程序：翻到相应日期看条目数，页脚的「存档信息」会写明当前用的文件路径和条数。

---

## 出事对照表

| 现象 | 大概率原因 | 处理 |
| --- | --- | --- |
| 打开后一条计划都没有 | `plans` 键写成了对象；或外层 JSON 语法错 | 文件被改名成 `planora.json.corrupt-<时间戳>`（内层坏则会在同一文件里留一个 `planora/plans/v1.corrupt` 键）；用备份覆盖回去，改好再写 |
| 少了几条，其它正常 | 那几条没过 `normalizePlan`，被静默丢弃 | 跑 `node check-plans.mjs` 看 `DROP` 行 |
| 改完文件、程序里没变化 | 程序还开着，内存副本把你写的覆盖回去了 | 关掉窗口再改，改完再开 |
| 界面上的状态跟 `status` 不符 | 那条是 `daily` 系列，看的是 `overrides[今天]` | 按当天日期写覆盖值 |
| 时间轴上看不到，但「全部」里有 | 时段早于/晚于时间窗；窗口默认 06:00–22:00，越界会自动扩边，但不支持跨零点 | 把时间写回 `00:00`–`23:59` 区间内 |
| 打开提示存档版本过高 | 内层 `version` 写成了 1 以外 | 改回 `1` |

---

## 顺带一提

`data\planora.json` 在仓库里是一份**示例存档**（14 条虚构计划，含两条 `daily` 系列和一处时间相接的重叠），格式跟你自己的完全一致 —— 想直接拿它当模板改也行。你自己的数据文件不要提交到公开仓库：把 `.gitignore` 里 `data/planora.json` 那行取消注释即可。

格式规范的另一份出处是 README 的「数据模型」一节；两边描述的是同一个东西，哪边改了都要同步另一边的表格。
