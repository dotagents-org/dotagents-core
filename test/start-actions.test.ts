import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli = fileURLToPath(new URL("../cli.ts", import.meta.url));

test("start actions reject missing profiles and sides and preserve provider desktop policy", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-start-actions-"));
  const state = path.join(root, "state");
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, "profiles.json"), JSON.stringify({ version: 2, profiles: [
    { name: "claude", configDir: path.join(root, "claude-profile"), color: "#D77655", default: true },
    { name: "chatgpt", provider: "codex", configDir: path.join(root, "codex-profile"), color: "#376B80" },
  ] }));
  fs.writeFileSync(path.join(state, "machine.json"), JSON.stringify({ version: 1, peer: { name: "Windows", home: path.join(root, "peer"), nativeHome: "C:\\Users\\test" } }));
  const child = spawn(process.execPath, [cli, "start", "--port", "0"], { env: { ...process.env, HOME: root, USERPROFILE: root, DOTAGENTS_STATE_DIR: state }, stdio: "ignore" });
  t.after(() => { child.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  let address: { port: number; token: string } | undefined;
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(path.join(state, "start.json"))) { address = JSON.parse(fs.readFileSync(path.join(state, "start.json"), "utf8")); break; }
    if (child.exitCode !== null) throw new Error(`start exited ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(address, "start.json was written");
  const ask = async (action: string, body: object) => {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/${action}`, { method: "POST", headers: { "x-dotagents-token": address.token, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as { ok: boolean; detail: string } };
  };
  assert.deepEqual(await ask("switch", { profile: "missing" }), { status: 404, body: { apiVersion: 2, ok: false, detail: "no such profile" } });
  assert.deepEqual(await ask("switch", { profile: "claude", side: "nowhere" }), { status: 404, body: { apiVersion: 2, ok: false, detail: "no such side" } });
  assert.equal((await ask("switch", { profile: "claude" })).status, 409);
  assert.equal((await ask("switch", { profile: "claude", side: "Windows" })).status, 502);
  assert.deepEqual(await ask("desktop", { profile: "missing" }), { status: 404, body: { apiVersion: 2, ok: false, detail: "no such profile" } });
  assert.equal((await ask("desktop", { profile: "chatgpt" })).status, 409);
});
