import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const INDEX_PATH = new URL("../index.html", import.meta.url);

test("every SVG card has a native source without waiting for JavaScript", async () => {
  const html = await readFile(INDEX_PATH, "utf8");
  const svgCards = html.match(/<object class="project-media project-svg"[^>]*>/g) ?? [];

  assert.ok(svgCards.length > 0, "expected the generated page to contain SVG cards");
  for (const card of svgCards) {
    assert.match(card, /\sdata="images\/projects\/[^"]+\.svg"/);
    assert.doesNotMatch(card, /\sdata-src=/);
  }
});
