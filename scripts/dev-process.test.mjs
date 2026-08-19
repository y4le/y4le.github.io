import assert from "node:assert/strict";
import test from "node:test";
import {
  findOwnedTailnetRoute,
  stopOwnedTailnetDevServer,
} from "./dev-process.mjs";

const options = {
  routeName: "y4le-site",
  repoRoot: "/home/yale/dev/y4le.github.io",
  routePath: "/y4le",
  scriptPath: "/home/yale/dev/y4le.github.io/scripts/dev.mjs",
};

const ownedRoute = {
  name: "y4le-site",
  owner_pid: 1234,
  owner_pid_alive: true,
  path: "/y4le/",
  repo: "/home/yale/dev/y4le.github.io",
  target: "http://127.0.0.1:8000",
};

test("finds only the route owned by this repo and route name", () => {
  const status = {
    routes: [
      { ...ownedRoute, name: "another-site" },
      { ...ownedRoute, repo: "/home/yale/dev/another-site" },
      ownedRoute,
    ],
  };

  assert.deepEqual(findOwnedTailnetRoute(status, options), ownedRoute);
  assert.equal(findOwnedTailnetRoute({ routes: [] }, options), null);
});

test("stops and waits for the previous verified dev server", async () => {
  const events = [];
  const pid = await stopOwnedTailnetDevServer(options, {
    loadStatus: async () => ({ routes: [ownedRoute] }),
    processMatches: async (candidate, identity) => {
      events.push(["inspect", candidate, identity]);
      return true;
    },
    sendSignal: (candidate) => events.push(["signal", candidate]),
    waitForExit: async (candidate) => {
      events.push(["wait", candidate]);
      return true;
    },
  });

  assert.equal(pid, 1234);
  assert.deepEqual(events, [
    ["inspect", 1234, {
      repoRoot: options.repoRoot,
      scriptPath: options.scriptPath,
    }],
    ["signal", 1234],
    ["wait", 1234],
  ]);
});

test("does not signal an unverified or stale owner process", async () => {
  let signals = 0;
  const stale = await stopOwnedTailnetDevServer(options, {
    loadStatus: async () => ({ routes: [{ ...ownedRoute, owner_pid_alive: false }] }),
    sendSignal: () => signals += 1,
  });
  const mismatched = await stopOwnedTailnetDevServer(options, {
    loadStatus: async () => ({ routes: [ownedRoute] }),
    processMatches: async () => false,
    sendSignal: () => signals += 1,
  });

  assert.equal(stale, null);
  assert.equal(mismatched, null);
  assert.equal(signals, 0);
});
