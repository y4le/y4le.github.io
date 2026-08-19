import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { stopOwnedTailnetDevServer } from './dev-process.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '8000', 10);
const useTailscale = process.argv.includes('--tailscale');
const routeName = 'y4le-site';
const routePath = '/y4le';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const contentTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`));
      }
    });
  });
}

function sendText(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
  } catch {
    sendText(response, 400, 'Bad request\n');
    return;
  }

  if (pathname === routePath) {
    response.writeHead(308, { Location: `${routePath}/` });
    response.end();
    return;
  }

  // Tailscale may preserve the mounted path when proxying. Serving both forms
  // keeps the same server useful directly at / and through /y4le/.
  if (pathname.startsWith(`${routePath}/`)) {
    pathname = pathname.slice(routePath.length);
  }

  if (pathname.split('/').some((segment) => segment.startsWith('.'))) {
    sendText(response, 404, 'Not found\n');
    return;
  }

  const requestedPath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const filePath = resolve(repoRoot, `.${requestedPath}`);
  if (filePath !== repoRoot && !filePath.startsWith(`${repoRoot}${sep}`)) {
    sendText(response, 404, 'Not found\n');
    return;
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) {
      sendText(response, 404, 'Not found\n');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
      'Content-Length': file.size,
      'Cache-Control': 'no-store',
    });
    if (request.method === 'HEAD') {
      response.end();
    } else {
      createReadStream(filePath).pipe(response);
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      sendText(response, 404, 'Not found\n');
    } else {
      console.error(error);
      sendText(response, 500, 'Internal server error\n');
    }
  }
});

if (useTailscale) {
  const stoppedPid = await stopOwnedTailnetDevServer({
    routeName,
    repoRoot,
    routePath,
    scriptPath,
  });
  if (stoppedPid !== null) {
    console.log(`Stopped previous ${routeName} dev server (PID ${stoppedPid}); restarting.`);
  }
}

server.listen(port, host);
await once(server, 'listening');
console.log(`Local: http://${host}:${port}/`);

let exposed = false;
if (useTailscale) {
  try {
    await run('tailnet-dev-host', [
      'expose',
      '--name', routeName,
      '--repo', repoRoot,
      '--path', routePath,
      '--port', String(port),
    ]);
    exposed = true;
  } catch (error) {
    server.close();
    throw error;
  }
}

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;

  try {
    if (exposed) {
      await run('tailnet-dev-host', [
        'unexpose',
        '--name', routeName,
        '--repo', repoRoot,
        '--path', routePath,
      ]);
    }
  } catch (error) {
    console.error(error.message);
  } finally {
    server.close();
    await once(server, 'close');
    process.exitCode = signal === 'SIGINT' ? 130 : 0;
  }
}

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));
