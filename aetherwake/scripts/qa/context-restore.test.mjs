import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { describe, it } from "node:test";
import { canvasHasContent, contextRestoreVerdict, pngPixelStats } from "./context-restore.mjs";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function pngRgb(w, h, fillRow) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const rgb = fillRow(x, y);
      const o = y * (stride + 1) + 1 + x * 3;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("context restore", () => {
  it("does not mark recovered from a toast-only / blank canvas", () => {
    const blank = { nonzero: 0, sum: 0, w: 64, h: 64 };
    const r = contextRestoreVerdict({
      lostFired: true,
      restoredFired: true,
      before: { nonzero: 800, sum: 40000, w: 64, h: 64 },
      after: blank,
    });
    assert.equal(r.recovered, false);
    assert.equal(canvasHasContent(blank), false);
  });

  it("marks recovered only when restored canvas has non-zero pixels", () => {
    const r = contextRestoreVerdict({
      lostFired: true,
      restoredFired: true,
      before: { nonzero: 10, sum: 100, w: 64, h: 64 },
      after: { nonzero: 900, sum: 50000, w: 64, h: 64, unique: 12, blank: false },
    });
    assert.equal(r.recovered, true);
    assert.equal(r.afterHas, true);
  });

  it("refuses recovered if restore event never fired", () => {
    const r = contextRestoreVerdict({
      lostFired: true,
      restoredFired: false,
      after: { nonzero: 900, sum: 50000, w: 64, h: 64 },
    });
    assert.equal(r.recovered, false);
  });

  it("treats a solid-color PNG as blank and a multi-color PNG as content", () => {
    const solid = pngPixelStats(pngRgb(4, 4, () => [10, 20, 30]));
    assert.equal(solid.ok, true);
    assert.equal(solid.blank, true);
    assert.equal(canvasHasContent(solid), false);
    const varied = pngPixelStats(pngRgb(8, 8, (x, y) => [x * 30, y * 20, 80]));
    assert.equal(varied.ok, true);
    assert.equal(varied.blank, false);
    assert.equal(canvasHasContent(varied), true);
  });
});
