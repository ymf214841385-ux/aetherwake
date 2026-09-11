/** Context-loss recovery is pixels, not the toast notice. */

import { inflateSync } from "node:zlib";

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(filter, row, prev, out, bpp) {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? out[i - bpp] : 0;
    const up = prev[i];
    const upLeft = i >= bpp ? prev[i - bpp] : 0;
    let v = row[i];
    if (filter === 1) v = (v + left) & 255;
    else if (filter === 2) v = (v + up) & 255;
    else if (filter === 3) v = (v + ((left + up) >> 1)) & 255;
    else if (filter === 4) v = (v + paeth(left, up, upLeft)) & 255;
    out[i] = v;
  }
}

/** Compositor PNG stats. WebGL readPixels is often zeros without preserveDrawingBuffer. */
export function pngPixelStats(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return { ok: false, reason: "not-png" };
  let off = 8;
  let w = 0;
  let h = 0;
  let colorType = 0;
  const idats = [];
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString("ascii", off + 4, off + 8);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") idats.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!w || !h || !idats.length) return { ok: false, reason: "ihdr" };
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idats));
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const stride = w * bpp;
  const pixels = Buffer.alloc(h * stride);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    if (src + 1 + stride > inflated.length) break;
    const filter = inflated[src++];
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    unfilter(filter, row, prev, out, bpp);
    prev = Buffer.from(out);
  }
  let nonzero = 0;
  let sum = 0;
  const seen = new Set();
  for (let i = 0; i < pixels.length; i++) {
    sum += pixels[i];
    if (pixels[i] > 0) nonzero += 1;
  }
  for (let i = 0; i + bpp <= pixels.length; i += bpp * Math.max(1, Math.floor(w / 16))) {
    let k = 0;
    for (let b = 0; b < Math.min(4, bpp); b++) k = (k << 8) | pixels[i + b];
    seen.add(k);
    if (seen.size > 48) break;
  }
  const unique = seen.size;
  const blank = unique <= 2;
  return { ok: true, w, h, nonzero, sum, unique, blank, bpp };
}

export function canvasHasContent(sample) {
  if (!sample) return false;
  if (sample.ok === false) return false;
  if (sample.blank === true) return false;
  if (Number(sample.unique ?? 0) > 2 && Number(sample.nonzero ?? 0) > 0) return true;
  const nonzero = Number(sample.nonzero ?? 0);
  const sum = Number(sample.sum ?? 0);
  return nonzero > 0 && sum > 0 && sample.blank !== true;
}

/**
 * recovered=true only when the restored canvas has non-zero pixels.
 * A toast / overlay notice is not enough (CODEX_REVIEW_04).
 *
 * @param {{
 *   lostFired?: boolean,
 *   restoredFired?: boolean,
 *   before?: object | null,
 *   after?: object | null,
 * }} input
 */
export function contextRestoreVerdict(input = {}) {
  const afterHas = canvasHasContent(input.after);
  const beforeHas = canvasHasContent(input.before);
  const changed =
    Boolean(input.before) &&
    Boolean(input.after) &&
    (Number(input.after.sum) !== Number(input.before.sum) ||
      Number(input.after.nonzero) !== Number(input.before.nonzero));
  const recovered = Boolean(input.restoredFired) && afterHas;
  return {
    recovered,
    afterHas,
    beforeHas,
    changed,
    lostFired: Boolean(input.lostFired),
    restoredFired: Boolean(input.restoredFired),
  };
}
