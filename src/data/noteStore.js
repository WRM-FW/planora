/**
 * 便利贴仓储：把「当前便利贴文档」和「废纸篓文档」两份存储缝成一个好用的门面。
 * UI 只认这里的方法（setText / setColor / tear / restore / purge …），
 * 不关心数据到底落在 StickyNote.json 还是 Wastebasket.json。
 *
 * 约定：便利贴列表永远至少有一张（撕掉最后一张会自动补一张空白贴），
 * 「当前贴」由 currentId 指定，找不到就退回第一张。
 */
import { STICKY_DOC, WASTE_DOC, NOTE_DEFAULT_COLOR } from "../config.js";
import { createDocStore } from "./docStore.js";
import {
  createNote, readNotes, readWaste, editText, editColor,
  tearOff, restoreFrom, purgeFrom, addToWaste
} from "../domain/note.js";

export function createNoteStore(options) {
  const opts = options || {};
  const now = opts.now || function () { return new Date(); };
  const deps = { now: now };

  const stickyDoc = createDocStore({
    name: STICKY_DOC, request: opts.request, storage: opts.storage, fallbackKey: "planora/doc/sticky"
  });
  const wasteDoc = createDocStore({
    name: WASTE_DOC, request: opts.request, storage: opts.storage, fallbackKey: "planora/doc/waste"
  });

  const listeners = new Set();
  let notes = [];
  let waste = [];
  let currentId = null;

  function emit() {
    const snapshot = api.get();
    listeners.forEach(function (fn) { fn(snapshot); });
  }

  function persistSticky() {
    stickyDoc.set({ format: "planora-notes/v1", current: currentId, notes: notes });
  }
  function persistWaste() {
    wasteDoc.set({ format: "planora-waste/v1", items: waste });
  }

  function currentIndex() {
    for (let i = 0; i < notes.length; i += 1) if (notes[i].id === currentId) return i;
    return notes.length ? 0 : -1;
  }
  function currentNote() {
    const i = currentIndex();
    return i < 0 ? null : notes[i];
  }

  /** 保证列表里至少有一张可写的空白贴。 */
  function ensureCurrent() {
    if (!notes.length) {
      const fresh = createNote({ color: NOTE_DEFAULT_COLOR }, deps);
      notes = [fresh];
      currentId = fresh.id;
      return true;
    }
    if (!currentNote()) currentId = notes[0].id;
    return false;
  }

  /** 启动：拉两份文档 → 归一化 → 兜底一张空白贴。 */
  function load() {
    return Promise.all([stickyDoc.load(), wasteDoc.load()]).then(function () {
      notes = readNotes(stickyDoc.get());
      waste = readWaste(wasteDoc.get());
      const sdoc = stickyDoc.get();
      currentId = sdoc && typeof sdoc.current === "string" ? sdoc.current : null;
      const added = ensureCurrent();
      // 首次没有文档、或补了空白贴：落一次盘，让 data\ 下真的出现文件。
      persistSticky();
      if (added) emit();
      return api.get();
    });
  }

  const api = {
    load: load,
    get: function () {
      return {
        notes: notes.slice(),
        waste: waste.slice(),
        currentId: currentId,
        current: currentNote(),
        wasteCount: waste.length
      };
    },
    select: function (id) {
      if (!notes.some(function (n) { return n.id === id; }) || id === currentId) return;
      currentId = id;
      persistSticky();
      emit();
    },
    setText: function (id, text) {
      notes = editText(notes, id, text, deps);
      persistSticky();
      // 文字改动不广播（避免每敲一个字重画丢焦点）；由视图自己持有输入框。
    },
    setColor: function (id, color) {
      notes = editColor(notes, id, color, deps);
      persistSticky();
      emit();
    },
    /** 新建一张空白贴并切到它（列表未满时）。 */
    addBlank: function () {
      const fresh = createNote({ color: NOTE_DEFAULT_COLOR }, deps);
      notes = notes.concat([fresh]);
      currentId = fresh.id;
      persistSticky();
      emit();
      return fresh;
    },
    /**
     * 撕下：当前贴进废纸篓，自动补一张新的空白贴继续写。
     * 返回被撕下的那张，供视图放「飞进纸篓」的动画。
     */
    tear: function (id) {
      const target = id || currentId;
      const res = tearOff(notes, target, deps);
      if (!res.torn) return null;
      waste = addToWaste(waste, res.torn);
      notes = res.notes;
      const fresh = createNote({ color: res.torn.color }, deps);   // 新贴沿用刚撕下的颜色，顺手
      notes = notes.concat([fresh]);
      currentId = fresh.id;
      persistWaste();
      persistSticky();
      emit();
      return res.torn;
    },
    restore: function (id) {
      const res = restoreFrom(waste, id);
      if (!res.restored) return false;
      waste = res.waste;
      notes = notes.concat([res.restored]);
      currentId = res.restored.id;
      persistWaste();
      persistSticky();
      emit();
      return true;
    },
    purge: function (id) {
      const before = waste.length;
      waste = purgeFrom(waste, id);
      if (waste.length === before) return false;
      persistWaste();
      emit();
      return true;
    },
    emptyWaste: function () {
      if (!waste.length) return false;
      waste = [];
      persistWaste();
      emit();
      return true;
    },
    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    /** 页面隐藏/关闭前把没落盘的改动送出去。 */
    flush: function () { stickyDoc.flushNow(); wasteDoc.flushNow(); }
  };
  return api;
}
