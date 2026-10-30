// dotagents serve: the local server the visual app reads from. It answers only on 127.0.0.1, to its
// own Host, only GETs, and the API only with the token it printed.

import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { startServer } from "../surfaces/web/server.ts";

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };

function get(port: number, path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

// The first event of the stream, then the connection closed.
function firstEvent(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      let data = "";
      res.on("data", (d) => {
        data += d;
        const end = data.indexOf("\n\n", data.indexOf("data:"));
        if (data.includes("data:") && end > 0) {
          req.destroy();
          resolve(data);
        }
      });
    });
    req.on("error", (err) => (err.message.includes("aborted") || err.message.includes("socket hang up") ? null : reject(err)));
  });
}

test("the API answers only with the token, and the page and the API only to the server's own Host", async (t) => {
  let n = 0;
  const server = await startServer({ port: 0, read: () => ({ version: 1, profiles: [{ name: "work", pct: ++n }] }), token: "secret" });
  t.after(() => server.close());
  const { port } = server;
  assert.equal((await get(port, "/api/usage")).status, 401);
  const ok = await get(port, "/api/usage", { "x-dotagents-token": "secret" });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).profiles[0].name, "work");
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal((await get(port, "/api/usage", { host: "evil.example", "x-dotagents-token": "secret" })).status, 403);
  assert.equal((await get(port, "/", { host: "evil.example" })).status, 403);
  const page = await get(port, "/");
  assert.equal(page.status, 200);
  assert.match(String(page.headers["content-security-policy"]), /default-src 'none'/);
  assert.equal((await get(port, "/api/usage", { "x-dotagents-token": "secret" }, "POST")).status, 405);
  assert.equal((await get(port, "/../package.json")).status, 404);
});

test("the event stream sends the usage at once, with the token in the query (EventSource sends no headers)", async (t) => {
  const server = await startServer({ port: 0, read: () => ({ version: 1, profiles: [] }), token: "secret", pollMs: 50 });
  t.after(() => server.close());
  assert.equal((await get(server.port, "/api/events")).status, 401);
  const event = await firstEvent(server.port, "/api/events?token=secret");
  assert.match(event, /event: usage\ndata: \{"version":1,"profiles":\[\]\}/);
});
