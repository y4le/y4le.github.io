import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stringify } from "yaml";
import { parseYamlMapping, validateProjectList } from "./project-manifest.mjs";
import { parseArguments, rebuildManifest } from "./rebuild-manifest.mjs";

const SITE = { title: "YaleThom.as", link: "https://yalethom.as" };

function project(title, overrides = {}) {
  const slug = title.toLocaleLowerCase("en-US").replaceAll(/[^a-z0-9]+/g, "-");
  return {
    schema: 1,
    title,
    description: `${title} does one useful thing well.`,
    bullets: [`Explains the concrete value of ${title}.`],
    date: { start: "2026-01", end: "present" },
    link: `https://yalethom.as/${slug}/`,
    type: "tool",
    tags: ["testing"],
    svg: ".yalethomas/card.svg",
    ...overrides,
  };
}

async function writeSourceProject(scanRoot, directory, declaration, svg = `<svg viewBox="0 0 1618 1000"><title>${declaration.title}</title></svg>\n`) {
  const metadata = path.join(scanRoot, directory, ".yalethomas");
  await mkdir(metadata, { recursive: true });
  await writeFile(path.join(metadata, "project.yaml"), stringify(declaration));
  if (declaration.svg !== null) {
    await writeFile(path.join(scanRoot, directory, declaration.svg), svg);
  }
}

async function readAggregate(manifestPath) {
  const source = await readFile(manifestPath, "utf8");
  return { source, value: parseYamlMapping(source, manifestPath) };
}

test("rebuild mode replaces projects, copies SVGs, and leaves unrelated files alone", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "y4le-manifest-rebuild-"));
  const scanRoot = path.join(workspace, "sources");
  const siteRoot = path.join(workspace, "site");
  const manifestPath = path.join(siteRoot, "projects.yaml");
  const assetDirectory = path.join(siteRoot, "images", "projects");
  const unrelatedPath = path.join(siteRoot, "index.html");
  const unmatchedAsset = path.join(assetDirectory, "old.svg");

  await mkdir(assetDirectory, { recursive: true });
  await writeFile(unrelatedPath, "do not rebuild me\n");
  await writeFile(unmatchedAsset, "do not delete me\n");
  await writeFile(manifestPath, stringify({
    site: SITE,
    projects: [project("Old", { svg: null })],
  }));
  await mkdir(path.join(scanRoot, "not-published", ".yalethomas"), { recursive: true });
  await writeSourceProject(scanRoot, "zeta", project("Zeta"), "zeta-svg\n");
  await writeSourceProject(scanRoot, "alpha", project("Alpha"), "alpha-svg\n");

  const result = await rebuildManifest({ scanRoot, manifestPath, assetDirectory });
  const aggregate = await readAggregate(manifestPath);

  assert.equal(result.mode, "rebuild");
  assert.equal(result.scannedCount, 2);
  assert.deepEqual(validateProjectList(aggregate.value.projects).map(({ title }) => title), ["Alpha", "Zeta"]);
  assert.equal(aggregate.value.projects[0].svg, "images/projects/alpha.svg");
  assert.equal(await readFile(path.join(assetDirectory, "alpha.svg"), "utf8"), "alpha-svg\n");
  assert.equal(await readFile(path.join(assetDirectory, "zeta.svg"), "utf8"), "zeta-svg\n");
  assert.equal(await readFile(unrelatedPath, "utf8"), "do not rebuild me\n");
  assert.equal(await readFile(unmatchedAsset, "utf8"), "do not delete me\n");
  assert.match(aggregate.source, /start: "2026-01"/);
  assert.match(aggregate.source, /end: "present"/);
});

test("update mode replaces named projects, preserves unmatched entries, and appends new ones", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "y4le-manifest-update-"));
  const scanRoot = path.join(workspace, "sources");
  const siteRoot = path.join(workspace, "site");
  const manifestPath = path.join(siteRoot, "projects.yaml");
  const assetDirectory = path.join(siteRoot, "images", "projects");
  const legacyAsset = path.join(assetDirectory, "legacy.svg");
  const legacy = project("Legacy", { svg: "images/projects/legacy.svg" });
  const staleAlpha = project("Alpha", {
    description: "This stale description should be replaced.",
    svg: null,
  });

  await mkdir(assetDirectory, { recursive: true });
  await writeFile(legacyAsset, "legacy-svg\n");
  await writeFile(manifestPath, stringify({ site: SITE, projects: [legacy, staleAlpha] }));
  await writeSourceProject(scanRoot, "alpha", project("alpha", {
    description: "The current Alpha declaration replaces the stale entry.",
  }));
  await writeSourceProject(scanRoot, "beta", project("Beta"));

  const result = await rebuildManifest({
    scanRoot,
    update: true,
    manifestPath,
    assetDirectory,
  });
  const { value } = await readAggregate(manifestPath);

  assert.equal(result.mode, "update");
  assert.deepEqual(value.projects.map(({ title }) => title), ["Legacy", "alpha", "Beta"]);
  assert.deepEqual(value.projects[0], legacy);
  assert.equal(value.projects[1].description, "The current Alpha declaration replaces the stale entry.");
  assert.equal(await readFile(legacyAsset, "utf8"), "legacy-svg\n");
});

test("validation completes before any manifest or SVG is written", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "y4le-manifest-invalid-"));
  const scanRoot = path.join(workspace, "sources");
  const siteRoot = path.join(workspace, "site");
  const manifestPath = path.join(siteRoot, "projects.yaml");
  const assetDirectory = path.join(siteRoot, "images", "projects");
  const original = stringify({ site: SITE, projects: [] });

  await mkdir(siteRoot, { recursive: true });
  await writeFile(manifestPath, original);
  await writeSourceProject(scanRoot, "one", project("Duplicate", {
    link: "https://yalethom.as/duplicate-one/",
  }));
  await writeSourceProject(scanRoot, "two", project("duplicate", {
    link: "https://yalethom.as/duplicate-two/",
  }));

  await assert.rejects(
    rebuildManifest({ scanRoot, manifestPath, assetDirectory }),
    /duplicate title/i,
  );
  assert.equal(await readFile(manifestPath, "utf8"), original);
  assert.equal(await stat(assetDirectory).catch(() => null), null);
});

test("CLI arguments default to rebuild mode and accept update mode", () => {
  assert.deepEqual(parseArguments(["/tmp/projects"]), {
    help: false,
    scanRoot: "/tmp/projects",
    update: false,
  });
  assert.deepEqual(parseArguments(["--update", "/tmp/projects"]), {
    help: false,
    scanRoot: "/tmp/projects",
    update: true,
  });
  assert.throws(() => parseArguments([]), /directory to scan is required/i);
});
