import { execFile } from "node:child_process";
import { readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeRoutePath(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

export function findOwnedTailnetRoute(status, { routeName, repoRoot, routePath }) {
  if (!Array.isArray(status?.routes)) return null;

  const expectedPath = normalizeRoutePath(routePath);
  return status.routes.find((route) =>
    route.name === routeName
      && typeof route.repo === "string"
      && path.resolve(route.repo) === path.resolve(repoRoot)
      && typeof route.path === "string"
      && normalizeRoutePath(route.path) === expectedPath
  ) ?? null;
}

async function loadTailnetStatus() {
  const { stdout } = await execFileAsync("tailnet-dev-host", ["status", "--json"], {
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

async function processRunsThisDevServer(pid, { repoRoot, scriptPath }) {
  try {
    const [cwd, commandLine] = await Promise.all([
      readlink(`/proc/${pid}/cwd`),
      readFile(`/proc/${pid}/cmdline`, "utf8"),
    ]);
    const arguments_ = commandLine.split("\0").filter(Boolean);
    const runsScript = arguments_.some((argument) =>
      !argument.startsWith("-") && path.resolve(cwd, argument) === path.resolve(scriptPath)
    );

    return path.resolve(cwd) === path.resolve(repoRoot)
      && runsScript
      && arguments_.includes("--tailscale");
  } catch {
    return false;
  }
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsRunning(pid)) return true;
    await delay(50);
  }
  return !processIsRunning(pid);
}

export async function stopOwnedTailnetDevServer(
  { routeName, repoRoot, routePath, scriptPath },
  {
    loadStatus = loadTailnetStatus,
    processMatches = processRunsThisDevServer,
    sendSignal = (pid) => process.kill(pid, "SIGTERM"),
    waitForExit = waitForProcessExit,
  } = {},
) {
  const route = findOwnedTailnetRoute(await loadStatus(), {
    routeName,
    repoRoot,
    routePath,
  });
  const pid = route?.owner_pid;

  if (!route?.owner_pid_alive || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return null;
  }
  if (!await processMatches(pid, { repoRoot, scriptPath })) {
    return null;
  }

  sendSignal(pid);
  if (!await waitForExit(pid)) {
    throw new Error(`Previous ${routeName} dev server (PID ${pid}) did not stop within 5 seconds`);
  }
  return pid;
}
