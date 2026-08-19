const DEFAULT_TIMEOUT_MS = 5_000;

function failureReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error?.cause?.code;
  return code ? `${message} (${code})` : message;
}

async function checkSite(site, { fetchImplementation, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(site.link, {
      headers: { accept: "text/html,application/xhtml+xml" },
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });

    // A GET verifies the same route a visitor uses. Stop after the headers so
    // checking a large page does not make the build download the whole body.
    if (response.body) {
      await response.body.cancel().catch(() => {});
    }

    if (response.ok) return null;

    const status = [response.status, response.statusText].filter(Boolean).join(" ");
    return { ...site, reason: `HTTP ${status}` };
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timed out after ${timeoutMs}ms`
      : failureReason(error);
    return { ...site, reason };
  } finally {
    clearTimeout(timeout);
  }
}

export async function findNonLiveSites(
  sites,
  {
    fetchImplementation = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  const results = await Promise.all(
    sites.map((site) => checkSite(site, { fetchImplementation, timeoutMs })),
  );
  return results.filter((result) => result !== null);
}

export function shouldColorWarnings({ isTTY, environment = process.env }) {
  if (Object.hasOwn(environment, "NO_COLOR")) return false;
  if (Object.hasOwn(environment, "FORCE_COLOR")) return environment.FORCE_COLOR !== "0";
  return Boolean(isTTY);
}

export function formatLivenessWarning(nonLiveSites, { color = false } = {}) {
  const count = nonLiveSites.length;
  const noun = count === 1 ? "LINKED SITE" : "LINKED SITES";
  const border = "!".repeat(78);
  const failures = nonLiveSites.map(
    ({ title, link, reason }) => `!!!  - ${title}: ${link} (${reason})`,
  );

  const warning = [
    border,
    `!!!  WARNING: ${count} ${noun} DID NOT PASS THE LIVENESS CHECK`,
    "!!!  The generated page still links to the destination(s) below.",
    "!!!  Fix or remove dead links before publishing.",
    ...failures,
    border,
  ].join("\n");

  return color ? `\u001b[1;31m${warning}\u001b[0m` : warning;
}
