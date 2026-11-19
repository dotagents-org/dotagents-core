import assert from "node:assert/strict";
import { test } from "node:test";
import { agentVersion, nodeOk, pathOnlyEnv, peerToolCheck, peerVersionLine } from "../../core/machine/peer.ts";
import { providers } from "../../core/accounts/providers.ts";
import "../helpers.ts";

test("Node 24 or newer runs dotagents", () => {
  for (const v of ["v24.0.0", "24.20.1", "v26.1.0", "v30.1.2"]) assert.ok(nodeOk(v), v);
  for (const v of ["v23.11.1", "v22.20.0", "v20.11.0", "v18.0.0"]) assert.ok(!nodeOk(v), v);
});

test("the other side's answer says what to do, in words for someone who doesn't know the tool", () => {
  assert.deepEqual(peerToolCheck("WSL", { status: 0, stdout: "v24.20.0\n0.0.0\n" }), { passed: true, detail: "Node v24.20.0, dotagents 0.0.0" });
  const old = peerToolCheck("WSL", { status: 1, stdout: "v22.11.0\n", stderr: "SyntaxError" });
  assert.equal(old.passed, false);
  assert.match(old.detail, /WSL runs Node v22\.11\.0, and dotagents needs 24 or newer; in WSL: nvm install 24/);
  assert.match(peerToolCheck("Windows", { status: 1, stdout: "", stderr: "not recognized" }).detail, /no Node answers on Windows; on Windows: install Node 24/);
  assert.match(peerToolCheck("WSL", { status: 127, stdout: "v24.20.0\n", stderr: "dotagents: command not found" }).detail, /dotagents doesn't run on WSL/);
  assert.equal(peerToolCheck("WSL", { status: null, error: new Error("spawn wsl.exe ENOENT") }).passed, false);
});

test("an agent's version is the line in its shape, past what the shell printed first, and none when it isn't there", () => {
  const claude = providers().find((p) => p.id === "claude")!.cli.version;
  const codex = providers().find((p) => p.id === "codex")!.cli.version;
  assert.equal(agentVersion({ status: 0, stdout: "2.1.327 (Claude Code)\n" }, claude), "2.1.327 (Claude Code)");
  assert.equal(agentVersion({ status: 0, stdout: "Now using node v24.20.0 (npm v11.6.2)\r\ncodex-cli 0.170.0\r\n" }, codex), "codex-cli 0.170.0");
  assert.equal(agentVersion({ status: 0, stdout: "Now using node v24.20.0 (npm v11.6.2)\n" }, claude), null);
  assert.equal(agentVersion({ status: 1, stdout: "" }, codex), null);
  assert.equal(agentVersion({ status: null, error: new Error("spawn claude ENOENT") }, claude), null);
});

test("an agent is asked for its version from the PATH's absolute folders only, never the current folder", () => {
  // From WSL, Windows: cmd without AutoRun, no current folder, no relative PATH entry
  assert.match(peerVersionLine("codex", "linux"), /^\$env:PATH = .*-match .*\$env:NoDefaultCurrentDirectoryInExePath = 1; cmd \/d \/c codex --version$/);
  // From Windows, WSL: the PATH's relative entries dropped
  assert.match(peerVersionLine("codex", "win32"), /^IFS=:; for d in \$PATH; do case \$d in \/\*\) .*exec "\$d\/codex" --version;; esac; done; exit 127$/);
  const win = pathOnlyEnv({ Path: String.raw`C:\Tools;.;bin;\\server\share;\rooted;D:/bin` }, "win32");
  assert.equal(win.Path, String.raw`C:\Tools;\\server\share;D:/bin`);
  assert.equal(win.NoDefaultCurrentDirectoryInExePath, "1");
  assert.equal(pathOnlyEnv({ PATH: "/usr/bin:.:bin::/opt/x" }, "linux").PATH, "/usr/bin:/opt/x");
});
