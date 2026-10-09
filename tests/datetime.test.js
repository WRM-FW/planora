import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays, dayNumber, diffDays, durationMinutes, formatClock, formatDateLabel,
  formatDuration, formatTimeRange, fromDateKey, isValidDateKey, isValidTime,
  minutesFromTime, monthNumber, nowMinutes, pad2, relativeDayLabel, timeFromMinutes,
  toDateKey, todayKey, weekdayLabel
} from "../src/domain/datetime.js";

test("toDateKey / fromDateKey 往返一致，且用本地时区", function () {
  const d = new Date(2026, 9, 8, 23, 30);
  assert.equal(toDateKey(d), "2026-10-08");
  const back = fromDateKey("2026-10-08");
  assert.equal(back.getFullYear(), 2026);
  assert.equal(back.getMonth(), 9);
  assert.equal(back.getDate(), 8);
  assert.equal(back.getHours(), 0);
});

test("isValidDateKey 拒绝不存在的日期与错误格式", function () {
  assert.equal(isValidDateKey("2026-02-30"), false);
  assert.equal(isValidDateKey("2026-13-01"), false);
  assert.equal(isValidDateKey("2026-1-1"), false);
  assert.equal(isValidDateKey(""), false);
  assert.equal(isValidDateKey(null), false);
  assert.equal(isValidDateKey("2024-02-29"), true);
});

test("addDays 跨月、跨年、跨闰日均正确", function () {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-10-08", 0), "2026-10-08");
});

test("diffDays 计算相差天数", function () {
  assert.equal(diffDays("2026-10-08", "2026-10-08"), 0);
  assert.equal(diffDays("2026-10-09", "2026-10-08"), 1);
  assert.equal(diffDays("2026-10-07", "2026-10-08"), -1);
  assert.equal(diffDays("2026-11-01", "2026-10-01"), 31);
});

test("weekdayLabel 与 formatDateLabel 用固定数组，不依赖运行环境", function () {
  assert.equal(weekdayLabel("2026-10-08"), "周四");
  assert.equal(weekdayLabel("2026-10-11"), "周日");
  assert.equal(formatDateLabel("2026-10-08"), "2026年10月8日");
  assert.equal(dayNumber("2026-10-08"), "08");
  assert.equal(monthNumber("2026-10-08"), "10");
});

test("relativeDayLabel 给出相对今天的口语标签", function () {
  assert.equal(relativeDayLabel("2026-10-08", "2026-10-08"), "今天");
  assert.equal(relativeDayLabel("2026-10-09", "2026-10-08"), "明天");
  assert.equal(relativeDayLabel("2026-10-07", "2026-10-08"), "昨天");
  assert.equal(relativeDayLabel("2026-10-20", "2026-10-08"), "");
});

test("时间解析：合法/非法输入与分钟互转", function () {
  assert.equal(isValidTime("00:00"), true);
  assert.equal(isValidTime("23:59"), true);
  assert.equal(isValidTime("24:00"), false);
  assert.equal(isValidTime("9:00"), false);
  assert.equal(minutesFromTime("09:30"), 570);
  assert.equal(Number.isNaN(minutesFromTime("nope")), true);
  assert.equal(timeFromMinutes(570), "09:30");
  assert.equal(timeFromMinutes(1439), "23:59");
  assert.equal(timeFromMinutes(1440), "00:00");
});

test("durationMinutes 与 formatDuration", function () {
  assert.equal(durationMinutes("09:00", "10:30"), 90);
  assert.equal(formatDuration(90), "1 小时 30 分");
  assert.equal(formatDuration(120), "2 小时");
  assert.equal(formatDuration(45), "45 分钟");
  assert.equal(formatDuration(0), "0 分钟");
  assert.equal(formatDuration(NaN), "0 分钟");
  assert.equal(formatTimeRange("09:00", "10:30"), "09:00 – 10:30");
});

test("nowMinutes / formatClock / pad2 / todayKey", function () {
  const d = new Date(2026, 9, 8, 7, 5);
  assert.equal(nowMinutes(d), 425);
  assert.equal(formatClock(d), "07:05");
  assert.equal(pad2(3), "03");
  assert.equal(pad2(12), "12");
  assert.equal(todayKey(d), "2026-10-08");
});
