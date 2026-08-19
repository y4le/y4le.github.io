import assert from "node:assert/strict";
import test from "node:test";
import {
  findNonLiveSites,
  formatLivenessWarning,
  shouldColorWarnings,
} from "./link-liveness.mjs";

const SITES = [
  { title: "Live", link: "https://yalethom.as/live/" },
  { title: "Missing", link: "https://yalethom.as/missing/" },
];

test("reports non-success responses and cancels response bodies", async () => {
  const cancelled = [];
  const fetchImplementation = async (link, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "follow");
    assert.equal(options.headers.accept, "text/html,application/xhtml+xml");

    return {
      ok: link.endsWith("/live/"),
      status: link.endsWith("/live/") ? 200 : 404,
      statusText: link.endsWith("/live/") ? "OK" : "Not Found",
      body: {
        async cancel() {
          cancelled.push(link);
        },
      },
    };
  };

  const failures = await findNonLiveSites(SITES, { fetchImplementation });

  assert.deepEqual(failures, [{
    title: "Missing",
    link: "https://yalethom.as/missing/",
    reason: "HTTP 404 Not Found",
  }]);
  assert.deepEqual(cancelled.sort(), SITES.map(({ link }) => link).sort());
});

test("reports network errors and timeouts without rejecting the build", async () => {
  const networkFailure = await findNonLiveSites([SITES[0]], {
    fetchImplementation: async () => {
      throw new Error("fetch failed", { cause: { code: "ENOTFOUND" } });
    },
  });
  const timeout = await findNonLiveSites([SITES[1]], {
    fetchImplementation: async (_link, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    timeoutMs: 5,
  });

  assert.equal(networkFailure[0].reason, "fetch failed (ENOTFOUND)");
  assert.equal(timeout[0].reason, "timed out after 5ms");
});

test("formats a prominent warning with every failed destination", () => {
  const warning = formatLivenessWarning([
    { ...SITES[1], reason: "HTTP 404 Not Found" },
    { title: "Broken", link: "https://yalethom.as/broken/", reason: "fetch failed" },
  ]);

  assert.match(warning, /!{20}/);
  assert.match(warning, /WARNING: 2 LINKED SITES DID NOT PASS THE LIVENESS CHECK/);
  assert.match(warning, /Missing: https:\/\/yalethom\.as\/missing\/ \(HTTP 404 Not Found\)/);
  assert.match(warning, /Broken: https:\/\/yalethom\.as\/broken\/ \(fetch failed\)/);
  assert.match(warning, /Fix or remove dead links before publishing/);
});

test("can render the warning in bold red for an interactive terminal", () => {
  const warning = formatLivenessWarning([
    { ...SITES[1], reason: "HTTP 404 Not Found" },
  ], { color: true });

  assert.equal(warning.startsWith("\u001b[1;31m"), true);
  assert.equal(warning.endsWith("\u001b[0m"), true);
});

test("uses terminal color conventions", () => {
  assert.equal(shouldColorWarnings({ isTTY: true, environment: {} }), true);
  assert.equal(shouldColorWarnings({ isTTY: false, environment: {} }), false);
  assert.equal(shouldColorWarnings({
    isTTY: false,
    environment: { FORCE_COLOR: "1" },
  }), true);
  assert.equal(shouldColorWarnings({
    isTTY: true,
    environment: { NO_COLOR: "1" },
  }), false);
});
