/**
 * 重复计划：一份「每天重复」的计划只存一条记录，某一天的完成状态存在 plan.overrides 上。
 * 这样删改一份日程不会留下孤儿实例，统计任意日期也只是一次过滤。
 */
import { isValidDateKey } from "./datetime.js";

/** 这份计划是否落在某一天。 */
export function occursOn(plan, dateKey) {
  if (!plan || !isValidDateKey(dateKey)) return false;
  if (plan.repeat !== "daily") return plan.date === dateKey;
  if (dateKey < plan.date) return false;
  if (plan.repeatUntil && dateKey > plan.repeatUntil) return false;
  return true;
}

/** 某一天这条计划的状态：重复计划优先取当天覆盖值。 */
export function statusOn(plan, dateKey) {
  if (!plan) return "todo";
  if (plan.repeat === "daily" && plan.overrides) {
    const override = plan.overrides[dateKey];
    if (override) return override;
  }
  return plan.status;
}

/** 把「计划 + 某天」合成一次出现（occurrence）——列表和时间轴都消费这个形状。 */
export function toOccurrence(plan, dateKey) {
  return {
    id: plan.id,
    plan: plan,
    dateKey: dateKey,
    status: statusOn(plan, dateKey),
    isRepeat: plan.repeat === "daily"
  };
}

export function occurrencesOn(plans, dateKey) {
  const list = [];
  (plans || []).forEach(function (plan) {
    if (occursOn(plan, dateKey)) list.push(toOccurrence(plan, dateKey));
  });
  return list;
}
