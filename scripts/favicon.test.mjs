import assert from "node:assert/strict";
import test from "node:test";
import { GEOMETRY, ICO_SIZES, renderIco, renderSvg } from "./favicon.mjs";

const EXPECTED_COLORS = new Set(["#0e0e0d", "#e8e3d5", "#c1432e"]);
const EXPECTED_GEOMETRY = [
  { x: 0, y: 0, width: 32, height: 32, fill: "#0e0e0d" },
  { x: 4, y: 10, width: 6, height: 6, fill: "#c1432e" },
  { x: 22, y: 10, width: 6, height: 6, fill: "#c1432e" },
  { x: 10, y: 20, width: 12, height: 2, fill: "#e8e3d5" },
];

function readIcoDirectory(ico) {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    return {
      width: ico[offset] || 256,
      height: ico[offset + 1] || 256,
      bitCount: ico.readUInt16LE(offset + 6),
      byteLength: ico.readUInt32LE(offset + 8),
      imageOffset: ico.readUInt32LE(offset + 12),
    };
  });
}

function readFrameColorCounts(ico, entry) {
  const headerWidth = ico.readInt32LE(entry.imageOffset + 4);
  const headerHeight = ico.readInt32LE(entry.imageOffset + 8) / 2;
  const colorCounts = new Map();
  const pixelOffset = entry.imageOffset + 40;

  assert.equal(headerWidth, entry.width);
  assert.equal(headerHeight, entry.height);

  for (let index = 0; index < entry.width * entry.height; index += 1) {
    const offset = pixelOffset + index * 4;
    const blue = ico[offset];
    const green = ico[offset + 1];
    const red = ico[offset + 2];
    const alpha = ico[offset + 3];
    const color = `#${[red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`;

    assert.equal(alpha, 255);
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
  }

  return colorCounts;
}

test("favicon geometry aligns to the 16, 32, and 48 pixel grids", () => {
  for (const size of ICO_SIZES) {
    const scale = size / 32;
    for (const rectangle of GEOMETRY) {
      for (const value of [rectangle.x, rectangle.y, rectangle.width, rectangle.height]) {
        assert.equal(Number.isInteger(value * scale), true);
      }
    }
  }
});

test("favicon geometry preserves the ._. proportions", () => {
  assert.deepEqual(GEOMETRY, EXPECTED_GEOMETRY);
});

test("favicon geometry uses only the fixed contract palette", () => {
  assert.deepEqual(new Set(GEOMETRY.map(({ fill }) => fill)), EXPECTED_COLORS);
});

test("favicon SVG is self-contained with an opaque edge-to-edge ground", () => {
  const svg = renderSvg();
  assert.match(svg, /viewBox="0 0 32 32"/);
  assert.match(svg, /<rect x="0" y="0" width="32" height="32" fill="#0e0e0d"\/>/);
  assert.doesNotMatch(
    svg,
    /<script|on\w+=|foreignObject|(?:href|src)=["']https?:|light-dark|color-scheme/,
  );
});

test("favicon ICO contains native 16, 32, and 48 pixel 32-bit frames", () => {
  const ico = renderIco();
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const entries = readIcoDirectory(ico);
  assert.deepEqual(
    entries.map(({ width, height, bitCount }) => ({ width, height, bitCount })),
    ICO_SIZES.map((size) => ({ width: size, height: size, bitCount: 32 })),
  );

  for (const entry of entries) {
    const scale = entry.width / 32;
    const inkPixels = 12 * 2 * scale ** 2;
    const accentPixels = 2 * 6 * 6 * scale ** 2;
    const colorCounts = readFrameColorCounts(ico, entry);
    assert.deepEqual(new Set(colorCounts.keys()), EXPECTED_COLORS);
    assert.equal(colorCounts.get("#e8e3d5"), inkPixels);
    assert.equal(colorCounts.get("#c1432e"), accentPixels);
    assert.equal(colorCounts.get("#0e0e0d"), entry.width ** 2 - inkPixels - accentPixels);
  }
});
