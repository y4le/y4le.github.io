import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const SVG_PATH = path.join(ROOT_DIRECTORY, "favicon.svg");
const ICO_PATH = path.join(ROOT_DIRECTORY, "favicon.ico");
const VIEWBOX_SIZE = 32;
const ICO_SIZES = [16, 32, 48];

const GEOMETRY = [
  { x: 0, y: 0, width: 32, height: 32, fill: "#0e0e0d" },
  { x: 4, y: 10, width: 6, height: 6, fill: "#c1432e" },
  { x: 22, y: 10, width: 6, height: 6, fill: "#c1432e" },
  { x: 10, y: 20, width: 12, height: 2, fill: "#e8e3d5" },
];

function renderSvg() {
  const rectangles = GEOMETRY.map(
    ({ x, y, width, height, fill }) =>
      `  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`,
  ).join("\n");

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges" role="img">',
    "  <title>YaleThom.as</title>",
    rectangles,
    "</svg>",
    "",
  ].join("\n");
}

function parseHexColor(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function renderIcoFrame(size) {
  const scale = size / VIEWBOX_SIZE;
  const pixels = Buffer.alloc(size * size * 4);

  for (const { x, y, width, height, fill } of GEOMETRY) {
    const [red, green, blue, alpha] = parseHexColor(fill);
    const left = x * scale;
    const top = y * scale;
    const right = (x + width) * scale;
    const bottom = (y + height) * scale;

    for (let pixelY = top; pixelY < bottom; pixelY += 1) {
      for (let pixelX = left; pixelX < right; pixelX += 1) {
        const bottomUpY = size - 1 - pixelY;
        const offset = (bottomUpY * size + pixelX) * 4;
        pixels[offset] = blue;
        pixels[offset + 1] = green;
        pixels[offset + 2] = red;
        pixels[offset + 3] = alpha;
      }
    }
  }

  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(pixels.length, 20);

  return Buffer.concat([header, pixels, mask]);
}

function renderIco() {
  const frames = ICO_SIZES.map(renderIcoFrame);
  const directory = Buffer.alloc(6 + ICO_SIZES.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(ICO_SIZES.length, 4);

  let imageOffset = directory.length;
  frames.forEach((frame, index) => {
    const entryOffset = 6 + index * 16;
    const size = ICO_SIZES[index];
    directory[entryOffset] = size;
    directory[entryOffset + 1] = size;
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(frame.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += frame.length;
  });

  return Buffer.concat([directory, ...frames]);
}

async function assertCurrent(filePath, expected) {
  const actual = await readFile(filePath).catch(() => null);
  if (actual === null || !actual.equals(expected)) {
    throw new Error(`${path.basename(filePath)} is out of date; run npm run favicon`);
  }
}

async function main() {
  const svg = Buffer.from(renderSvg());
  const ico = renderIco();

  if (process.argv.includes("--check")) {
    await Promise.all([assertCurrent(SVG_PATH, svg), assertCurrent(ICO_PATH, ico)]);
    console.log("Favicon assets are up to date");
    return;
  }

  await Promise.all([writeFile(SVG_PATH, svg), writeFile(ICO_PATH, ico)]);
  console.log("Built favicon.svg and favicon.ico from shared geometry");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Favicon build failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { GEOMETRY, ICO_SIZES, renderIco, renderSvg };
