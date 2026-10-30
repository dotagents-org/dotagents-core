// The dashboard's local server (dotagents start): the page and its files, and the API it reads, built on what
// core/ gives (the usage snapshot). Only on 127.0.0.1, only to its own Host (a page elsewhere can't
// reach it through DNS rebinding), only GETs, and the API only with the token printed at start.
// Live: /api/events sends the data again whenever it changes.

import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "page");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const KEEPALIVE_MS = 15_000;

export type ServerOptions = {
  // The API's data, read again on every request and every poll.
  read: () => unknown;
  // 0 picks a free port; a taken port tries the next ten.
  port?: number;
  token?: string;
  pollMs?: number;
};

export type RunningServer = { port: number; token: string; url: string; close: () => Promise<void> };

const sameToken = (given: string | null, token: string) => {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function startServer({ read, port = 7337, token = randomBytes(24).toString("base64url"), pollMs = 2000 }: ServerOptions): Promise<RunningServer> {
  const streams = new Set<http.ServerResponse>();
  let actual = 0;

  const server = http.createServer((req, res) => {
    const security = {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    };
    const send = (status: number, body = "", type = "text/plain; charset=utf-8") => {
      res.writeHead(status, { ...security, "content-type": type });
      res.end(body);
    };
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${actual}` && host !== `localhost:${actual}`) return send(403, "forbidden host");
    if (req.method !== "GET") return send(405, "read only");
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (url.pathname.startsWith("/api/")) {
      if (!sameToken(req.headers["x-dotagents-token"]?.toString() ?? url.searchParams.get("token"), token)) return send(401, "token needed");
      if (url.pathname === "/api/usage") return send(200, JSON.stringify(read()), "application/json; charset=utf-8");
      if (url.pathname === "/api/events") {
        res.writeHead(200, { ...security, "content-type": "text/event-stream", connection: "keep-alive" });
        res.write("retry: 3000\n\n");
        let last = "";
        // Sent again only when something but the time it was read changed.
        const push = () => {
          const value = read();
          const data = JSON.stringify(value);
          const same = JSON.stringify({ ...(value as object), generatedAt: undefined });
          if (same === last) return;
          last = same;
          res.write(`event: usage\ndata: ${data}\n\n`);
        };
        push();
        const poll = setInterval(push, pollMs);
        const keepalive = setInterval(() => res.write(": keepalive\n\n"), KEEPALIVE_MS);
        streams.add(res);
        req.on("close", () => {
          clearInterval(poll);
          clearInterval(keepalive);
          streams.delete(res);
        });
        return;
      }
      return send(404, "not found");
    }

    // The page's own files, by name only: nothing outside page/.
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[\w-]+\.(html|js|css|svg)$/.test(name)) return send(404, "not found");
    const file = path.join(PAGE_DIR, name);
    if (!fs.existsSync(file)) return send(404, "not found");
    send(200, fs.readFileSync(file, "utf8"), TYPES[path.extname(name)]);
  });

  // A taken port tries the next ten; 0 lets the system pick.
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port === 0 ? 0 : port + attempt, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === 0 || attempt >= 10) throw err;
    }
  }
  actual = (server.address() as { port: number }).port;
  return {
    port: actual,
    token,
    url: `http://127.0.0.1:${actual}/#token=${token}`,
    close: () =>
      new Promise((resolve) => {
        for (const res of streams) res.end();
        server.close(() => resolve());
      }),
  };
}
