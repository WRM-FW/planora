/**
 * 派生层：把「所有计划 + 某一天 + 筛选」算成一份可以直接渲染的当日视图模型。
 * UI 只读这份结果，不再自己判断业务规则 —— 这是本项目「UI / 逻辑 / 数据」分层的落点。
 */
import { DEFAULT_WINDOW } from "../config.js";
import { minutesFromTime, nowMinutes, todayKey, formatClock } from "./datetime.js";
import { occurrencesOn } from "./recurrence.js";
import { priorityRank } from "./plan.js";

/** 统计：当天计划数、已完成数、完成率（后续统计页可直接复用）。 */
export function summarize(occurrences) {
  let done = 0;
  let doing = 0;
  let todo = 0;
  (occurrences || []).forEach(function (o) {
    if (o.status === "done") done += 1;
    else if (o.status === "doing") doing += 1;
    else todo += 1;
  });
  const total = (occurrences || []).length;
  return {
    total: total,
    done: done,
    doing: doing,
    todo: todo,
    open: total - done,
    rate: total === 0 ? 0 : Math.round((done / total) * 100)
  };
}

/** 时间顺序优先，其次优先级，最后标题 —— 让列表和当天日程一致。 */
export function sortOccurrences(list) {
  return (list || []).slice().sort(function (a, b) {
    const byStart = minutesFromTime(a.plan.start) - minutesFromTime(b.plan.start);
    if (byStart) return byStart;
    const byPriority = priorityRank(a.plan.priority) - priorityRank(b.plan.priority);
    if (byPriority) return byPriority;
    return String(a.plan.title).localeCompare(String(b.plan.title), "zh-Hans-CN");
  });
}

export function filterOccurrences(list, filter) {
  if (filter === "open") return (list || []).filter(function (o) { return o.status !== "done"; });
  if (filter === "done") return (list || []).filter(function (o) { return o.status === "done"; });
  return (list || []).slice();
}

export function countByFilter(occurrences) {
  const stats = summarize(occurrences);
  return { all: stats.total, open: stats.open, done: stats.done };
}

/**
 * 时间轴泳道分配：按开始时间贪心装箱，重叠的计划各占一列。
 * 返回 items（带 lane）与 laneCount。
 */
export function packLanes(occurrences) {
  const sorted = sortOccurrences(occurrences);
  const laneEnds = [];
  const items = sorted.map(function (o) {
    // 已经 decorate 过的出现自带 start/end/duration，这里只对裸 occurrence 兜底。
    const interval = Number.isFinite(o.start) && Number.isFinite(o.end)
      ? { start: o.start, end: o.end, duration: o.end - o.start }
      : resolveInterval(o.plan);
    const start = interval.start;
    const end = interval.end;
    let lane = -1;
    for (let i = 0; i < laneEnds.length; i += 1) {
      if (laneEnds[i] <= start) { lane = i; break; }
    }
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(end); }
    else laneEnds[lane] = end;
    return {
      id: o.id,
      plan: o.plan,
      dateKey: o.dateKey,
      status: o.status,
      isRepeat: o.isRepeat,
      start: start,
      end: end,
      duration: interval.duration,
      lane: lane
    };
  });
  return { items: items, laneCount: Math.max(1, laneEnds.length) };
}

/** 时间轴可见范围：默认 06–22 点，有计划超出就自动扩边（写到 24 点为止）。 */
export function computeWindow(items, override) {
  const base = override || DEFAULT_WINDOW;
  let startHour = base.startHour;
  let endHour = base.endHour;
  (items || []).forEach(function (item) {
    startHour = Math.min(startHour, Math.floor(item.start / 60));
    endHour = Math.max(endHour, Math.ceil(item.end / 60));
  });
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, Math.max(endHour, startHour + 1));
  return {
    startHour: startHour,
    endHour: endHour,
    startMinutes: startHour * 60,
    endMinutes: endHour * 60
  };
}

/** 结束时间必须晚于开始时间；数据非法时给一个兜底长度，保证界面不会算出 NaN。 */
export function resolveInterval(plan) {
  const rawStart = minutesFromTime(plan.start);
  const start = Number.isFinite(rawStart) ? rawStart : 0;
  const rawEnd = minutesFromTime(plan.end);
  const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 15;
  return { start: start, end: end, duration: end - start };
}

/** 给一次出现打上「现在 / 已过时段」这类时间语境，并算出时长。 */
function decorate(occurrence, dateKey, clockMinutes, isToday) {
  const interval = resolveInterval(occurrence.plan);
  const done = occurrence.status === "done";
  const isNow = isToday && !done && clockMinutes >= interval.start && clockMinutes < interval.end;
  return Object.assign({}, occurrence, {
    start: interval.start,
    end: interval.end,
    duration: interval.duration,
    isNow: isNow,
    isPast: isToday && !done && !isNow && interval.end <= clockMinutes,
    isDone: done
  });
}

/**
 * 当日视图模型。
 * @param {{plans: Array, dateKey: string, filter?: string, now?: Date, window?: object}} input
 */
export function buildDayView(input) {
  const src = input || {};
  const plans = src.plans || [];
  const now = src.now || new Date();
  const dateKey = src.dateKey || todayKey(now);
  const filter = src.filter || "all";
  const today = todayKey(now);
  const isToday = dateKey === today;
  const clock = nowMinutes(now);

  const all = sortOccurrences(occurrencesOn(plans, dateKey)).map(function (o) {
    return decorate(o, dateKey, clock, isToday);
  });

  const packed = packLanes(all);
  const window_ = computeWindow(packed.items, src.window);
  const laneCount = packed.laneCount;

  const laneById = {};
  packed.items.forEach(function (item) { laneById[item.id] = item.lane; });
  const decorated = all.map(function (o) {
    return Object.assign({}, o, { lane: laneById[o.id] || 0, laneCount: laneCount });
  });

  const visibleIds = {};
  filterOccurrences(decorated, filter).forEach(function (o) { visibleIds[o.id] = true; });
  const visible = decorated.filter(function (o) { return visibleIds[o.id]; });

  let current = null;
  decorated.forEach(function (o) { if (!current && o.isNow) current = o; });

  return {
    dateKey: dateKey,
    todayKey: today,
    isToday: isToday,
    all: decorated,
    visible: visible,
    laneCount: laneCount,
    stats: summarize(decorated),
    counts: countByFilter(decorated),
    window: window_,
    clock: { minutes: clock, label: formatClock(now) },
    hasPlans: decorated.length > 0,
    current: current
  };
}
