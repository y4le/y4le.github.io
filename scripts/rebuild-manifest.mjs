import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Scalar } from "yaml";
import {
  assert,
  isRecord,
  parseYamlMapping,
  projectSlug,
  validateProject,
  validateProjectList,
  validateSite,
} from "./project-manifest.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, "projects.yaml");
const DEFAULT_ASSET_DIRECTORY = path.join(REPO_ROOT, "images", "projects");
const DEFAULT_SITE = {
  title: "YaleThom.as",
  link: "https://yalethom.as",
};
const PRUNED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dependencies",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv",
]);

function normalizedTitle(project) {
  return project.title.toLocaleLowerCase("en-US");
}

async function findProjectManifestPaths(scanRoot) {
  const root = path.resolve(scanRoot);
  const rootInfo = await stat(root).catch(() => null);
  assert(rootInfo?.isDirectory(), `Scan path is not a directory: ${root}`);

  const found = [];

  async function walk(directory) {
    if (path.basename(directory) === ".yalethomas") {
      const manifestPath = path.join(directory, "project.yaml");
      const manifestInfo = await stat(manifestPath).catch(() => null);
      if (manifestInfo?.isFile()) found.push(manifestPath);
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    const metadata = entries.find((entry) => entry.name === ".yalethomas");
    if (metadata?.isDirectory()) {
      const manifestPath = path.join(directory, metadata.name, "project.yaml");
      const manifestInfo = await stat(manifestPath).catch(() => null);
      if (manifestInfo?.isFile()) {
        found.push(manifestPath);
        return;
      }
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !PRUNED_DIRECTORIES.has(entry.name)
      ) {
        await walk(path.join(directory, entry.name));
      }
    }
  }

  await walk(root);
  return found.sort((left, right) => left.localeCompare(right, "en"));
}

async function loadSourceProject(manifestPath, assetDirectory, aggregateRoot) {
  const source = await readFile(manifestPath, "utf8");
  const project = validateProject(parseYamlMapping(source, manifestPath), manifestPath);
  const repositoryRoot = path.dirname(path.dirname(manifestPath));

  if (project.svg === null) {
    return { project, asset: null, manifestPath };
  }

  const sourceSvg = path.resolve(repositoryRoot, project.svg);
  const relativeSvg = path.relative(repositoryRoot, sourceSvg);
  assert(
    relativeSvg && !relativeSvg.startsWith("..") && !path.isAbsolute(relativeSvg),
    `${manifestPath}: svg must remain inside its repository`,
  );

  const svgInfo = await stat(sourceSvg).catch(() => null);
  assert(svgInfo?.isFile(), `${manifestPath}: svg references a missing file: ${project.svg}`);

  const slug = projectSlug(project);
  const destination = path.join(assetDirectory, `${slug}.svg`);
  const copiedPath = path.relative(aggregateRoot, destination).split(path.sep).join("/");
  assert(
    copiedPath && !copiedPath.startsWith("..") && !path.isAbsolute(copiedPath),
    `Asset directory must remain inside the aggregate manifest repository: ${assetDirectory}`,
  );

  return {
    project: { ...project, svg: copiedPath },
    asset: { destination, contents: await readFile(sourceSvg) },
    manifestPath,
  };
}

async function loadAggregate(manifestPath, { validateProjects }) {
  let source;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { site: DEFAULT_SITE, projects: [] };
    }
    throw error;
  }

  const aggregate = parseYamlMapping(source, manifestPath);
  const unknown = Object.keys(aggregate).filter((field) => !["site", "projects"].includes(field));
  assert(unknown.length === 0, `${manifestPath} has unsupported field(s): ${unknown.join(", ")}`);
  assert(Object.hasOwn(aggregate, "site"), `${manifestPath}.site is required`);
  assert(Object.hasOwn(aggregate, "projects"), `${manifestPath}.projects is required`);
  assert(Array.isArray(aggregate.projects), `${manifestPath}.projects must be a list`);

  return {
    site: validateSite(aggregate.site, `${manifestPath}.site`),
    projects: validateProjects
      ? validateProjectList(aggregate.projects, `${manifestPath}.projects`)
      : aggregate.projects,
  };
}

function mergeProjects(existing, scanned) {
  const scannedByTitle = new Map(scanned.map((project) => [normalizedTitle(project), project]));
  const merged = existing.map((project) => {
    const replacement = scannedByTitle.get(normalizedTitle(project));
    if (replacement) scannedByTitle.delete(normalizedTitle(project));
    return replacement ?? project;
  });

  for (const project of scanned) {
    if (scannedByTitle.has(normalizedTitle(project))) {
      merged.push(project);
      scannedByTitle.delete(normalizedTitle(project));
    }
  }

  return validateProjectList(merged);
}

function stringifyAggregate(site, projects) {
  const document = new Document({ site, projects });
  document.commentBefore = " Generated by npm run manifest; edit source .yalethomas/project.yaml files instead.";

  for (let index = 0; index < projects.length; index += 1) {
    for (const part of ["start", "end"]) {
      const scalar = document.getIn(["projects", index, "date", part], true);
      if (scalar?.value !== null) scalar.type = Scalar.QUOTE_DOUBLE;
    }
  }

  return document.toString({ lineWidth: 0 });
}

async function writeIfChanged(filePath, contents) {
  const current = await readFile(filePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const next = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  if (current?.equals(next)) return false;

  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, next, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return true;
}

export async function rebuildManifest({
  scanRoot,
  update = false,
  manifestPath = DEFAULT_MANIFEST_PATH,
  assetDirectory = DEFAULT_ASSET_DIRECTORY,
}) {
  const aggregateRoot = path.dirname(path.resolve(manifestPath));
  const manifestPaths = await findProjectManifestPaths(scanRoot);
  assert(manifestPaths.length > 0, `No .yalethomas/project.yaml files found under ${path.resolve(scanRoot)}`);

  const loaded = await Promise.all(
    manifestPaths.map((sourcePath) => loadSourceProject(sourcePath, assetDirectory, aggregateRoot)),
  );
  loaded.sort((left, right) => projectSlug(left.project).localeCompare(projectSlug(right.project), "en"));
  const scanned = validateProjectList(loaded.map(({ project }) => project), "scanned projects");
  const existing = await loadAggregate(manifestPath, { validateProjects: update });
  const projects = update ? mergeProjects(existing.projects, scanned) : scanned;

  const changedAssets = [];
  for (const { asset } of loaded) {
    if (asset && await writeIfChanged(asset.destination, asset.contents)) {
      changedAssets.push(asset.destination);
    }
  }

  const manifestChanged = await writeIfChanged(
    manifestPath,
    stringifyAggregate(existing.site, projects),
  );

  return {
    manifestPath,
    manifestChanged,
    changedAssets,
    projectCount: projects.length,
    scannedCount: scanned.length,
    mode: update ? "update" : "rebuild",
  };
}

export function parseArguments(args) {
  let update = false;
  let scanRoot = null;

  for (const argument of args) {
    if (argument === "--update") {
      update = true;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true };
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (scanRoot === null) {
      scanRoot = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  assert(scanRoot, "A directory to scan is required");
  return { help: false, scanRoot, update };
}

function printHelp() {
  console.log(`usage: npm run manifest -- [--update] <path>

Scan recursively for .yalethomas/project.yaml declarations, copy their SVGs
into images/projects/, and rebuild projects.yaml. Rebuild mode replaces the
project list. --update preserves unmatched projects and their ordering.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await rebuildManifest(options);
  console.log(
    `${result.mode === "update" ? "Updated" : "Rebuilt"} ${path.relative(REPO_ROOT, result.manifestPath)} ` +
    `with ${result.projectCount} projects (${result.scannedCount} scanned, ${result.changedAssets.length} SVGs copied)`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`Manifest rebuild failed: ${error.message}`);
    process.exitCode = 1;
  });
}
