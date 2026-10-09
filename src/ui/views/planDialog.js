/**
 * 新增 / 编辑计划弹窗。用原生 <dialog>：焦点陷阱、Esc 关闭都由浏览器负责。
 * 校验错误来自 domain 层的 PlanValidationError.fields，逐字段贴回表单。
 */
import { PRIORITIES, STATUS_CYCLE, STATUS_LABEL } from "../../config.js";
import { timeFromMinutes } from "../../domain/datetime.js";
import { el, icon } from "../dom.js";

export const PRIORITY_HINT = { high: "先做", medium: "常规", low: "有空再说" };

/** 默认时间：下一个半点开始，一小时长（晚上太晚就往前收）。 */
export function suggestSlot(now) {
  const d = now || new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  let start = Math.ceil((nowMin + 5) / 30) * 30;
  if (start > 22 * 60) start = 22 * 60;
  return {
    start: timeFromMinutes(start),
    end: timeFromMinutes(Math.min(start + 60, 23 * 60))
  };
}

export function createPlanDialog(options) {
  const opts = options || {};
  const doc = opts.document || document;
  const onSubmit = opts.onSubmit || function () {};

  const refs = {};
  let currentId = null;

  function textField(config) {
    const input = el("input", {
      class: "input",
      id: "plan-" + config.name,
      attrs: {
        type: config.type,
        name: config.name,
        step: config.step || null,
        min: config.min || null,
        max: config.max || null,
        maxlength: config.maxlength || null,
        placeholder: config.placeholder || null,
        autocomplete: "off",
        required: config.required ? true : null
      }
    });
    const error = el("p", { class: "field__error", attrs: { "data-error": config.name } });
    const field = el("div", { class: "field" + (config.wide ? " field--wide" : "") }, [
      el("label", { class: "field__label", attrs: { for: "plan-" + config.name } }, [
        el("span", { text: config.label }),
        config.optional ? el("span", { class: "field__optional", text: "（可选）" }) : null
      ]),
      input,
      error
    ]);
    return { field: field, input: input, error: error };
  }

  function choiceGroup(name, items, legendText, labelFor, swatchClassFor) {
    const inputs = [];
    const legend = el("legend", { class: "fieldset__legend", text: legendText });
    const group = el("fieldset", { class: "fieldset" }, [
      legend,
      el("div", { class: "choice" }, items.map(function (item) {
        const input = el("input", {
          class: "visually-hidden",
          id: "plan-" + name + "-" + item.id,
          attrs: { type: "radio", name: "plan-" + name, value: item.id }
        });
        inputs.push(input);
        return el("label", {
          class: "choice__item " + swatchClassFor(item),
          attrs: { for: "plan-" + name + "-" + item.id }
        }, [
          input,
          el("span", { class: "choice__swatch", attrs: { "aria-hidden": "true" } }),
          el("span", { class: "choice__text", text: labelFor(item) })
        ]);
      }))
    ]);
    return { group: group, inputs: inputs, legend: legend };
  }

  const title = textField({ name: "title", type: "text", label: "标题", wide: true, required: true, maxlength: 60, placeholder: "例如：复习线性代数" });
  const date = textField({ name: "date", type: "date", label: "日期", required: true });
  const start = textField({ name: "start", type: "time", label: "开始时间", step: 300, required: true });
  const end = textField({ name: "end", type: "time", label: "结束时间", step: 300, required: true });
  const priority = choiceGroup("priority", PRIORITIES, "优先级", function (item) { return item.label + " · " + PRIORITY_HINT[item.id]; }, function (item) { return "pr-" + item.id; });
  const status = choiceGroup("status", STATUS_CYCLE.map(function (id) { return { id: id }; }), "状态", function (item) { return STATUS_LABEL[item.id]; }, function (item) { return "st-" + item.id; });

  const repeatDaily = el("input", { class: "check__box", id: "plan-repeat", attrs: { type: "checkbox", name: "repeatDaily" } });
  const repeatUntil = el("input", {
    class: "input",
    id: "plan-repeatUntil",
    attrs: { type: "date", name: "repeatUntil", "aria-label": "重复截止日期" }
  });
  const repeatError = el("p", { class: "field__error", attrs: { "data-error": "repeatUntil" } });

  const repeatBlock = el("div", { class: "field field--wide repeat" }, [
    el("label", { class: "check", attrs: { for: "plan-repeat" } }, [
      repeatDaily,
      el("span", { class: "check__mark", attrs: { "aria-hidden": "true" } }, [icon("repeat", { size: 12 })]),
      el("span", { class: "check__text", text: "每天重复（同一条日程，每天各记各的完成状态）" })
    ]),
    el("div", { class: "repeat__until" }, [
      el("label", { class: "field__label", attrs: { for: "plan-repeatUntil" }, text: "重复截止" }),
      repeatUntil
    ]),
    repeatError
  ]);

  const heading = el("h2", { class: "dialog__title", text: "新增计划" });
  const hint = el("p", { class: "dialog__hint", text: "" });
  const note = el("p", { class: "dialog__note", attrs: { role: "status" } });

  const closeBtn = el("button", {
    class: "dialog__close",
    attrs: { type: "button", "aria-label": "关闭" }
  }, [icon("close", { size: 16, weight: 2.5 })]);

  const form = el("form", { class: "dialog__form", attrs: { novalidate: true } }, [
    el("header", { class: "dialog__band" }, [heading, hint, closeBtn]),
    el("div", { class: "dialog__body" }, [
      title.field,
      el("div", { class: "dialog__row dialog__row--3" }, [date.field, start.field, end.field]),
      el("div", { class: "dialog__row" }, [priority.group, status.group]),
      repeatBlock
    ]),
    el("footer", { class: "dialog__foot" }, [
      note,
      el("div", { class: "dialog__buttons" }, [
        el("button", { class: "btn btn--ghost", attrs: { type: "button" }, data: { action: "cancel" } }, ["取消"]),
        el("button", { class: "btn btn--primary", attrs: { type: "submit" } }, ["保存计划"])
      ])
    ])
  ]);

  const dialog = el("dialog", { class: "dialog", id: "plan-dialog" }, [form]);

  function errorNode(name) {
    return form.querySelector('[data-error="' + name + '"]');
  }

  function clearErrors() {
    Array.prototype.slice.call(form.querySelectorAll(".field__error")).forEach(function (node) {
      node.textContent = "";
    });
    Array.prototype.slice.call(form.querySelectorAll(".input")).forEach(function (node) {
      node.removeAttribute("aria-invalid");
    });
    note.textContent = "";
  }

  function showErrors(fields) {
    const order = ["title", "date", "start", "end", "priority", "status", "repeatUntil"];
    let first = null;
    order.forEach(function (name) {
      if (!fields[name]) return;
      const node = errorNode(name) || errorNode(name === "priority" ? "priority" : name);
      if (node) node.textContent = fields[name];
      const input = form.querySelector("#plan-" + name);
      if (input) {
        input.setAttribute("aria-invalid", "true");
        if (!first) first = input;
      }
      if (name === "priority" || name === "status") {
        const legend = form.querySelector(".fieldset__legend");
        if (!first && legend) first = legend;
      }
    });
    if (first && first.focus) first.focus();
  }

  function checkedValue(inputs) {
    for (let i = 0; i < inputs.length; i += 1) {
      if (inputs[i].checked) return inputs[i].value;
    }
    return null;
  }

  function setChecked(inputs, value) {
    inputs.forEach(function (input) { input.checked = input.value === value; });
  }

  function readValues() {
    return {
      title: title.input.value,
      date: date.input.value,
      start: start.input.value,
      end: end.input.value,
      priority: checkedValue(priority.inputs),
      status: checkedValue(status.inputs),
      repeat: repeatDaily.checked ? "daily" : "none",
      repeatUntil: repeatUntil.value || null
    };
  }

  function openFor(plan, defaults) {
    const base = Object.assign({
      title: "",
      date: defaults && defaults.date ? defaults.date : date.input.value,
      start: defaults && defaults.start ? defaults.start : "09:00",
      end: defaults && defaults.end ? defaults.end : "10:00",
      priority: "medium",
      status: "todo",
      repeat: "none",
      repeatUntil: ""
    }, plan ? {
      title: plan.title,
      date: plan.date,
      start: plan.start,
      end: plan.end,
      priority: plan.priority,
      status: plan.status,
      repeat: plan.repeat,
      repeatUntil: plan.repeatUntil || ""
    } : null);

    clearErrors();
    currentId = plan ? plan.id : null;
    title.input.value = base.title;
    date.input.value = base.date;
    start.input.value = base.start;
    end.input.value = base.end;
    setChecked(priority.inputs, base.priority);
    setChecked(status.inputs, base.status);
    repeatDaily.checked = base.repeat === "daily";
    repeatUntil.value = base.repeatUntil;

    heading.textContent = plan ? "编辑计划" : "新增计划";
    hint.textContent = plan
      ? (plan.repeat === "daily" ? "这是每天重复的计划，改动会应用到所有日期。" : "改完点保存即可生效。")
      : "给这段时间起个名字，它会出现在当天的时间轴上。";
    status.legend.textContent = base.repeat === "daily" ? "状态（重复计划的默认状态）" : "状态";

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    title.input.focus();
    if (title.input.select) title.input.select();
  }

  function close() {
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  closeBtn.addEventListener("click", close);
  form.querySelector('[data-action="cancel"]').addEventListener("click", close);

  repeatDaily.addEventListener("change", function () {
    status.legend.textContent = repeatDaily.checked ? "状态（重复计划的默认状态）" : "状态";
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearErrors();
    try {
      onSubmit(readValues(), currentId);
      close();
    } catch (err) {
      if (err && err.fields) showErrors(err.fields);
      else note.textContent = (err && err.message) || "保存失败，请检查输入。";
    }
  });

  return {
    element: dialog,
    openFor: openFor,
    close: close,
    isOpen: function () { return !!dialog.open; }
  };
}
