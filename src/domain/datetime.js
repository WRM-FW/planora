/**
 * 日期与时间工具（纯函数，无副作用、无本地化依赖）。
 * 计划里日期统一用 "YYYY-MM-DD"、时间统一用 "HH:MM"，都是字符串，
 * 只有需要计算时才转成分钟数或本地 Date —— 这样可以避开时区与序列化的坑。
 */

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

export function toDateKey(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

/** 由 "YYYY-MM-DD" 得到本地零点的 Date；非法输入返回 null。 */
export function fromDateKey(key) {
  const m = DATE_RE.exec(String(key == null ? "" : key));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isValidDateKey(key) {
  const d = fromDateKey(key);
  return !!d && toDateKey(d) === key;
}

export function todayKey(now) {
  return toDateKey(now || new Date());
}

export function addDays(key, delta) {
  const d = fromDateKey(key);
  if (!d) return key;
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

/** a - b，单位天。用四舍五入抵消夏令时造成的 23/25 小时。 */
export function diffDays(a, b) {
  const da = fromDateKey(a);
  const db = fromDateKey(b);
  if (!da || !db) return NaN;
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

export function weekdayLabel(key) {
  const d = fromDateKey(key);
  return d ? WEEKDAYS[d.getDay()] : "";
}

export function formatDateLabel(key) {
  const d = fromDateKey(key);
  if (!d) return "";
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
}

export function formatMonthDay(key) {
  const d = fromDateKey(key);
  if (!d) return "";
  return (d.getMonth() + 1) + "月" + d.getDate() + "日";
}

export function dayNumber(key) {
  const d = fromDateKey(key);
  return d ? pad2(d.getDate()) : "--";
}

export function monthNumber(key) {
  const d = fromDateKey(key);
  return d ? pad2(d.getMonth() + 1) : "--";
}

/** 相对今天的口语标签，用于日期导航上的小提示。 */
export function relativeDayLabel(key, today) {
  const delta = diffDays(key, today || todayKey());
  if (delta === 0) return "今天";
  if (delta === 1) return "明天";
  if (delta === -1) return "昨天";
  if (delta === 2) return "后天";
  if (delta === -2) return "前天";
  return "";
}

export function isValidTime(value) {
  return TIME_RE.test(String(value == null ? "" : value));
}

/** "HH:MM" -> 当天第几分钟；非法输入返回 NaN。 */
export function minutesFromTime(value) {
  const m = TIME_RE.exec(String(value == null ? "" : value));
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 分钟数 -> "HH:MM"（按 24 小时取模）。 */
export function timeFromMinutes(minutes) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
}

export function nowMinutes(now) {
  const d = now || new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function formatClock(now) {
  const d = now || new Date();
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

export function durationMinutes(start, end) {
  const a = minutesFromTime(start);
  const b = minutesFromTime(end);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : NaN;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 分钟";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return h + " 小时 " + m + " 分";
  if (h) return h + " 小时";
  return m + " 分钟";
}

export function formatTimeRange(start, end) {
  return String(start) + " – " + String(end);
}
