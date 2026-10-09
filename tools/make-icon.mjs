// 生成 assets/icon.ico（多尺寸 32 位 ICO）。这是"造图标"的一次性工具，
// 应用运行时完全不需要它。要换图标就改下面的颜色/比例再跑一次：
//   node tools/make-icon.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const OUT = join(HERE, '..', 'assets', 'icon.ico');

// 取自 styles/tokens.css：纸白 / 墨黑 / 朱红（高优先级色）
const PAPER = [0xf4, 0xeb, 0xd9];
const INK = [0x17, 0x18, 0x1a];
const ACCENT = [0xd8, 0x40, 0x2f];

/** 画一张 size×size 的图：纸底 + 墨框 + 朱色优先级条 + 三条墨线。 */
export function draw(size) {
  const px = [];
  for (let i = 0; i < size * size; i += 1) px.push(PAPER);

  const set = function (x, y, c) {
    if (x >= 0 && y >= 0 && x < size && y < size) px[y * size + x] = c;
  };
  const rect = function (x0, y0, w, h, c) {
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) set(x, y, c);
  };

  const b = Math.max(1, Math.round(size / 16));        // 边框
  const bar = Math.max(2, Math.round(size / 5));       // 优先级色条
  const gap = Math.max(1, Math.round(size / 16));
  const lh = Math.max(1, Math.round(size / 16));       // 墨线粗细

  rect(0, 0, size, b, INK);
  rect(0, size - b, size, b, INK);
  rect(0, 0, b, size, INK);
  rect(size - b, 0, b, size, INK);

  rect(b, b, bar, size - 2 * b, ACCENT);

  const x0 = b + bar + gap;
  const innerW = size - x0 - b;
  const innerH = size - 2 * b;
  const widths = [0.72, 0.5, 0.62];
  for (let i = 0; i < 3; i += 1) {
    const y = b + Math.round(((i + 0.9) * innerH) / 4.2);
    rect(x0, y, Math.max(2, Math.round(innerW * widths[i])), lh, INK);
  }
  return px;
}

/** 一张 32 位 DIB（自下而上的 BGRA + 全 0 的 AND 掩码）。 */
function dib(size) {
  const px = draw(size);
  const xorSize = size * size * 4;
  const andStride = Math.ceil(size / 32) * 4;
  const buf = Buffer.alloc(40 + xorSize + andStride * size);

  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(xorSize, 20);

  let off = 40;
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const c = px[y * size + x];
      buf[off] = c[2]; buf[off + 1] = c[1]; buf[off + 2] = c[0]; buf[off + 3] = 0xff;
      off += 4;
    }
  }
  return buf;
}

export function buildIco(sizes) {
  const images = sizes.map(dib);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const dir = Buffer.alloc(16 * sizes.length);
  let offset = 6 + 16 * sizes.length;
  sizes.forEach(function (size, i) {
    const img = images[i];
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(img.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.length;
  });

  return Buffer.concat([header, dir].concat(images));
}

/** 把产物解回来核对像素，顺便打印一张 ASCII 预览（. 纸 / # 墨 / = 朱）。 */
export function verify(file) {
  const buf = readFileSync(file);
  const count = buf.readUInt16LE(4);
  const results = [];
  for (let i = 0; i < count; i += 1) {
    const o = 6 + i * 16;
    const size = buf[o] || 256;
    const dataOff = buf.readUInt32LE(o + 12);
    const bytes = buf.readUInt32LE(o + 8);
    const width = buf.readInt32LE(dataOff + 4);
    const height = buf.readInt32LE(dataOff + 8);
    const bitCount = buf.readUInt16LE(dataOff + 14);
    const at = function (x, y) {
      const start = dataOff + 40 + ((size - 1 - y) * size + x) * 4;
      return [buf[start + 2], buf[start + 1], buf[start]];
    };
    const same = function (c, ref) { return c[0] === ref[0] && c[1] === ref[1] && c[2] === ref[2]; };
    results.push({
      size: size,
      entryBytes: bytes,
      header: width + "x" + height + " " + bitCount + "bpp",
      cornerInk: same(at(0, 0), INK),
      centerAccent: same(at(Math.round(size / 6), Math.round(size / 2)), ACCENT),
      paperOnRight: same(at(size - 3, Math.round(size / 2)), INK) === false
    });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, buildIco([16, 32, 48]));
  console.log("写入 " + OUT);
  console.log(JSON.stringify(verify(OUT), null, 1));
  const px = draw(32);
  const ch = function (c) {
    if (c === INK) return "#";
    if (c === ACCENT) return "=";
    return ".";
  };
  let art = "";
  for (let y = 0; y < 32; y += 1) {
    let row = "";
    for (let x = 0; x < 32; x += 1) row += ch(px[y * 32 + x]);
    art += row + "\n";
  }
  console.log("\n32x32 预览:\n" + art);
}
