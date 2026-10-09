/**
 * 极小 DOM 工具箱。没有虚拟 DOM：视图函数直接返回真实节点，新节点建好再整体替换区域。
 * 全部用 textContent / setAttribute 写入，不做字符串拼 HTML —— 计划标题是用户输入，
 * 绝不能进 innerHTML。
 */
const SVG_NS = "http://www.w3.org/2000/svg";

export function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : (children == null ? [] : [children]);
  for (let i = 0; i < list.length; i += 1) {
    const child = list[i];
    if (child == null || child === false || child === true) continue;
    node.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * el("div", { class, text, id, attrs, data, on }, children)
 */
export function el(tag, options, children) {
  const opts = options || {};
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.id) node.id = opts.id;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) {
    Object.keys(opts.attrs).forEach(function (key) {
      const value = opts.attrs[key];
      if (value == null || value === false) return;
      node.setAttribute(key, value === true ? "" : String(value));
    });
  }
  if (opts.data) {
    Object.keys(opts.data).forEach(function (key) { node.dataset[key] = String(opts.data[key]); });
  }
  if (opts.on) {
    Object.keys(opts.on).forEach(function (type) { node.addEventListener(type, opts.on[type]); });
  }
  return appendChildren(node, children);
}

export function svgEl(tag, attrs, children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (key) {
      if (attrs[key] == null) return;
      node.setAttribute(key, String(attrs[key]));
    });
  }
  return appendChildren(node, children);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 用新内容整体替换区域内容；节点是新建的，因此天然避免脏状态。 */
export function replace(node, children) {
  clear(node);
  return appendChildren(node, children);
}

export function frag(children) {
  return appendChildren(document.createDocumentFragment(), children);
}

/* ---------- 图标：几何化线条，方头收笔，贴合丝印的硬边 ---------- */

const ICON_SPECS = {
  "chevron-left": [["path", { d: "M14 5 L7 12 L14 19" }]],
  "chevron-right": [["path", { d: "M10 5 L17 12 L10 19" }]],
  plus: [["path", { d: "M12 5 V19" }], ["path", { d: "M5 12 H19" }]],
  check: [["path", { d: "M4 13 L9.5 18.5 L20 6" }]],
  sun: [
    ["circle", { cx: 12, cy: 12, r: 4.5 }],
    ["path", { d: "M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5 M5.2 5.2 L7.4 7.4 M16.6 16.6 L18.8 18.8 M18.8 5.2 L16.6 7.4 M7.4 16.6 L5.2 18.8" }]
  ],
  moon: [["path", { d: "M20.5 14.5 A8.5 8.5 0 1 1 9.5 3.5 A6.8 6.8 0 0 0 20.5 14.5 Z" }]],
  edit: [["path", { d: "M4 20 L4 16 L16 4 L20 8 L8 20 Z" }], ["path", { d: "M13 7 L17 11" }]],
  trash: [["path", { d: "M4.5 7 H19.5" }], ["path", { d: "M9.5 7 V4.5 H14.5 V7" }], ["path", { d: "M6.5 7 L7.8 20 H16.2 L17.5 7" }]],
  repeat: [["path", { d: "M4 9 H17 M14 6 L17 9 L14 12" }], ["path", { d: "M20 15 H7 M10 12 L7 15 L10 18" }]],
  download: [["path", { d: "M12 4 V15" }], ["path", { d: "M7 11 L12 16 L17 11" }], ["path", { d: "M5 20 H19" }]],
  upload: [["path", { d: "M12 20 V9" }], ["path", { d: "M7 13 L12 8 L17 13" }], ["path", { d: "M5 4.5 H19" }]],
  close: [["path", { d: "M6 6 L18 18" }], ["path", { d: "M18 6 L6 18" }]],
  clock: [["circle", { cx: 12, cy: 12, r: 8.5 }], ["path", { d: "M12 7 V12.5 L16 15" }]]
};

export function icon(name, options) {
  const opts = options || {};
  const spec = ICON_SPECS[name] || [];
  const size = opts.size || 18;
  return svgEl("svg", {
    class: "icon" + (opts.class ? " " + opts.class : ""),
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": opts.weight || 2,
    "stroke-linecap": opts.cap || "square",
    "stroke-linejoin": "miter",
    "aria-hidden": "true",
    focusable: "false"
  }, spec.map(function (part) { return svgEl(part[0], part[1]); }));
}

/* ---------- 焦点保持：区域整体替换后，把焦点还给同一个语义按钮 ---------- */

export function captureFocusKey() {
  const active = document.activeElement;
  return active && active.dataset ? (active.dataset.focusKey || null) : null;
}

export function restoreFocus(root, key) {
  if (!key) return false;
  const target = root.querySelector('[data-focus-key="' + key + '"]');
  if (!target || typeof target.focus !== "function") return false;
  target.focus();
  return true;
}
