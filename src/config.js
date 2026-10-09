/**
 * 全局常量：枚举、存储键、界面文案。
 * 这一层不依赖 DOM，也不依赖存储实现，domain / data / ui 都从这里取事实。
 */

export const APP_NAME = "Planora";
export const APP_NAME_LATIN = "PLANORA";
export const APP_VERSION = "1.1.3";

/** localStorage 键。数据与视图偏好分开存，清视图不会丢数据。 */
export const DATA_KEY = "planora/plans/v1";
export const VIEW_KEY = "planora/view/v1";
/** 更名（每日计划表 → Planora）之前用过的键：新键为空时自动认领旧数据，升级不丢档。 */
export const LEGACY_DATA_KEYS = ["daily-planner/plans/v1"];
export const LEGACY_VIEW_KEYS = ["daily-planner/view/v1"];
export const SCHEMA_VERSION = 1;

/** 本地数据服务：由 Planora.exe 或 server.mjs 提供，把程序目录里的 JSON 文件当成可写存储。 */
export const PING_API = "/api/ping";
export const STORE_API = "/api/store";

/** 便利贴：整份文档接口，服务端分别落盘 data\StickyNote.json 与 data\Wastebasket.json。 */
export const STICKY_DOC = "sticky";
export const WASTE_DOC = "waste";
export function docApi(name) { return "/api/doc/" + name; }
/** 便利贴可选油墨（丝印调色板里的色）；最后一项「自定义」交给取色器。 */
export const NOTE_COLORS = [
  { id: "amber", label: "琥珀", value: "#F2B134" },
  { id: "sky", label: "天青", value: "#7FB3C8" },
  { id: "coral", label: "珊瑚", value: "#E8553D" },
  { id: "paper", label: "纸白", value: "#FAF5E7" },
  { id: "mint", label: "薄荷", value: "#A8C6A1" },
  { id: "lilac", label: "淡紫", value: "#C7B8E0" }
];
export const NOTE_DEFAULT_COLOR = NOTE_COLORS[0].value;
/** 深色底上要用浅色字，浅色底用深色字：按亮度挑油墨。 */
export const NOTE_INK_LIGHT = "#F4EBD6";
export const NOTE_INK_DARK = "#173247";
/** 一张便利贴最多多少字，防手滑粘进整本书。 */
export const NOTE_MAX_CHARS = 2000;
/** 已经从旧版浏览器存储搬到数据文件的标记：避免用户删掉数据文件后又被旧数据「复活」。 */
export const MIGRATED_KEY = "planora/migrated/v1";
/** 保存失败时的浏览器暂存副本（只在异常时写入，正常情况不存在）。 */
export const SHADOW_KEY = "planora/shadow/v1";

/** 旧版数据可能所在的键：绿色版/开发环境用过的 localStorage 键，以及更名前的键。 */
export const MIGRATION_SOURCES = {
  data: ["planora/plans/v1", "daily-planner/plans/v1"],
  view: ["planora/view/v1", "daily-planner/view/v1"]
};

/** 保存状态：给页脚显示用。 */
export const SAVE_STATE = { IDLE: "idle", SAVING: "saving", SAVED: "saved", FAILED: "failed" };

/** 优先级：既是业务枚举，也是视觉标识的来源（见 styles/tokens.css 的 --pr-*）。 */
export const PRIORITIES = [
  { id: "high", label: "高", full: "高优先级" },
  { id: "medium", label: "中", full: "中优先级" },
  { id: "low", label: "低", full: "低优先级" }
];
export const PRIORITY_IDS = PRIORITIES.map(function (p) { return p.id; });
export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
export const PRIORITY_BY_ID = { high: PRIORITIES[0], medium: PRIORITIES[1], low: PRIORITIES[2] };

/** 计划状态。周期顺序即 UI 上「点一下换一个状态」的顺序。 */
export const STATUS_CYCLE = ["todo", "doing", "done"];
export const STATUS_LABEL = { todo: "未开始", doing: "进行中", done: "已完成" };
export const STATUS_IDS = STATUS_CYCLE.slice();

/** 列表筛选。open = 未完成（未开始 + 进行中）。 */
export const FILTERS = [
  { id: "all", label: "全部" },
  { id: "open", label: "未完成" },
  { id: "done", label: "已完成" }
];
export const FILTER_IDS = FILTERS.map(function (f) { return f.id; });

/** 主题：auto 跟随系统，day/night 是同一套几何的两种油墨（丝印的「换色再印」）。 */
export const THEMES = ["auto", "day", "night"];
export const THEME_LABEL = { auto: "跟随系统", day: "日间油墨", night: "夜间油墨" };

/** 一天时间轴默认显示 06:00–22:00，有计划越界时自动扩边。 */
export const DEFAULT_WINDOW = { startHour: 6, endHour: 22 };
export const REPEAT_IDS = ["none", "daily"];
export const REPEAT_LABEL = { none: "不重复", daily: "每天重复" };