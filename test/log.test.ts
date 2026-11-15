import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { format, log, logChange, logFile, mask } from "../core/log.ts";
import "./helpers.ts";

// A state folder of its own for one test.
function withState(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-logs-"));
  const saved = process.env.DOTAGENTS_STATE_DIR;
  process.env.DOTAGENTS_STATE_DIR = dir;
  t.after(() => {
    saved === undefined ? delete process.env.DOTAGENTS_STATE_DIR : (process.env.DOTAGENTS_STATE_DIR = saved);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const SECRETS = [
  "sk-ant-oat01-AbCdEf_123-xyz",
  "sk-ant-ort01-QRSTUV987",
  "eyJhbGciOiJSUzI1NiJ9.payload.sig",
  "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA",
];

test("a token is masked however it is written, and what is around it stays", () => {
  const [oauth, refresh, jwt, header] = SECRETS;
  const cases = [
    `login ${oauth} failed`,
    `{"accessToken":"${oauth}","refreshToken":"${refresh}","expiresAt":1}`,
    `accessToken = ${jwt}`,
    `refreshToken: '${refresh}'`,
    `x-dotagents-token: ${header}`,
    `{"x-dotagents-token": "${header}"}`,
    `Authorization: Bearer ${jwt}`,
    `bearer ${header}`,
  ];
  for (const text of cases) {
    const masked = mask(text);
    for (const secret of SECRETS) assert.ok(!masked.includes(secret), `${secret} survived in: ${masked}`);
    assert.match(masked, /\[redacted\]/);
  }
  assert.equal(mask(`{"expiresAt":1,"scopes":["a"]}`), `{"expiresAt":1,"scopes":["a"]}`);
  assert.equal(mask("exit 1: dotagents: no such profile"), "exit 1: dotagents: no such profile");
});

test("no token reaches the file, from a message, an error or a command's output", (t) => {
  withState(t);
  log("core", "error", "peer switch", `wsl.exe exited 1\n{"accessToken":"${SECRETS[0]}"}\nBearer ${SECRETS[2]}`);
  log("core", "error", "start", new Error(`refused ${SECRETS[1]} for x-dotagents-token: ${SECRETS[3]}`));
  log("host", "info", "spawn", `claude --token ${SECRETS[0]}`);
  const text = fs.readFileSync(logFile("core"), "utf8") + fs.readFileSync(logFile("host"), "utf8");
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} is in the log`);
  assert.match(text, /peer switch: wsl\.exe exited 1/);
});

test("a line is the time, the level, the source and the message; the rest goes under it, indented", () => {
  const line = format("error", "start", "it failed\ndetail one\n  detail two", new Date("2026-11-13T15:53:52.881Z"));
  assert.equal(line, "2026-11-13T15:53:52.881Z error start: it failed\n  detail one\n  detail two\n");
  const err = format("error", "cli", new Error("boom"), new Date("2026-11-13T15:53:52.881Z"));
  assert.match(err, /^2026-11-13T15:53:52\.881Z error cli: Error: boom\n {2}at /);
});

test("a file past 1 MB becomes .1, replacing the one before, and starts again", (t) => {
  withState(t);
  const file = logFile("core");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "a".repeat(1024 * 1024 + 1));
  log("core", "info", "start", "first after");
  assert.equal(fs.readFileSync(`${file}.1`, "utf8").length, 1024 * 1024 + 1);
  assert.match(fs.readFileSync(file, "utf8"), /^\d{4}-.* info start: first after\n$/);
  // a second time replaces the .1
  fs.appendFileSync(file, "b".repeat(1024 * 1024));
  log("core", "info", "start", "second after");
  assert.match(fs.readFileSync(`${file}.1`, "utf8"), /^\d{4}-.* info start: first after\nb+$/);
  assert.match(fs.readFileSync(file, "utf8"), /second after\n$/);
});

test("the file is private to the user", { skip: process.platform === "win32" }, (t) => {
  withState(t);
  log("core", "info", "start", "hello");
  assert.equal(fs.statSync(logFile("core")).mode & 0o777, 0o600);
});

test("a failure that repeats is written once, until it changes or works again", (t) => {
  withState(t);
  logChange("core", "error", "peer sessions", "no answer");
  logChange("core", "error", "peer sessions", "no answer");
  logChange("core", "error", "peer sessions", "exit 127");
  logChange("core", "error", "peer sessions", null); // it works now
  logChange("core", "error", "peer sessions", null);
  logChange("core", "error", "peer sessions", "no answer");
  const lines = fs.readFileSync(logFile("core"), "utf8").trimEnd().split("\n");
  assert.deepEqual(lines.map((l) => l.replace(/^\S+ /, "")), ["error peer sessions: no answer", "error peer sessions: exit 127", "error peer sessions: no answer"]);
});

test("writing a log never throws, even where it can't be written", (t) => {
  const dir = withState(t);
  const blocker = path.join(dir, "not-a-folder");
  fs.writeFileSync(blocker, "x");
  process.env.DOTAGENTS_STATE_DIR = blocker; // logs/ can't be made inside a file
  assert.doesNotThrow(() => log("core", "error", "start", "nowhere to go"));
});
