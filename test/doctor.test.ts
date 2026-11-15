import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeOk, peerToolCheck } from "../core/peer.ts";
import "./helpers.ts";

test("Node 22.18 or newer runs dotagents", () => {
  for (const v of ["v22.18.0", "22.20.1", "v24.0.0", "v30.1.2"]) assert.ok(nodeOk(v), v);
  for (const v of ["v22.17.9", "v20.11.0", "v18.0.0"]) assert.ok(!nodeOk(v), v);
});

test("the other side's answer says what to do, in words for someone who doesn't know the tool", () => {
  assert.deepEqual(peerToolCheck("WSL", { status: 0, stdout: "v24.20.0\n0.1.0\n" }), { passed: true, detail: "Node v24.20.0, dotagents 0.1.0" });
  const old = peerToolCheck("WSL", { status: 1, stdout: "v22.11.0\n", stderr: "SyntaxError" });
  assert.equal(old.passed, false);
  assert.match(old.detail, /WSL runs Node v22\.11\.0, and dotagents needs 22\.18 or newer; in WSL: nvm install 24/);
  assert.match(peerToolCheck("Windows", { status: 1, stdout: "", stderr: "not recognized" }).detail, /no Node answers on Windows; on Windows: install Node 24/);
  assert.match(peerToolCheck("WSL", { status: 127, stdout: "v24.20.0\n", stderr: "dotagents: command not found" }).detail, /dotagents doesn't run on WSL/);
  assert.equal(peerToolCheck("WSL", { status: null, error: new Error("spawn wsl.exe ENOENT") }).passed, false);
});
