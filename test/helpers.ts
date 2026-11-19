import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { collect, setRenderer, type Event } from "../core/output/output.ts";
import { resetState } from "../core/state.ts";
import type { Skill } from "../core/workspace/skills.ts";
import type { Installer } from "../core/workspace/thirdparty.ts";

// The commands the tests run leave Node's compile cache off, so none writes outside its temporary
// folders; test/startup.test.ts turns it back on where it checks the cache itself.
process.env.NODE_DISABLE_COMPILE_CACHE = "1";

// The real repository: templates and the skills dotagents brings come from it.
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The tests read the example configuration, never the one installed next to the clone.
process.env.DOTAGENTS_CONFIG = path.join(REPO, "templates", "config");

// Nor to the real state folder (the logs, for one): a folder of their own, gone at the end.
const testState = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-state-"));
process.env.DOTAGENTS_STATE_DIR = testState;
process.on("exit", () => fs.rmSync(testState, { recursive: true, force: true }));

// Points the configuration elsewhere for one test (undefined: a clone's own config/), and back after.
export function withConfig(t: TestContext, value: string | undefined) {
  const saved = process.env.DOTAGENTS_CONFIG;
  const set = (v: string | undefined) => (v === undefined ? delete process.env.DOTAGENTS_CONFIG : (process.env.DOTAGENTS_CONFIG = v));
  set(value);
  t.after(() => set(saved));
}

export function tempWorkspace(t: TestContext, name = "ws") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = path.join(root, name);
  fs.mkdirSync(ws);
  return ws;
}

// Fresh counters before each scenario, and nothing printed. Returns the events the run emits.
export function quiet(overrides: Parameters<typeof resetState>[0] = {}) {
  resetState(overrides);
  const events: Event[] = [];
  setRenderer(collect(events));
  return events;
}

// A third-party skill that never touches the network.
export const fakeThirdParty: Skill = { name: "fake-skill", kind: "third-party", source: "me/fake-skills", description: "A fake skill.", requires: [] };

// Stands in for `npx skills add`: writes the skill folder and its lock entry, like the real one.
export const fakeInstaller: Installer = async (ws, skill) => {
  const dir = path.join(ws, ".agents", "skills", skill.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\nBody.\n`);
  const lockFile = path.join(ws, "skills-lock.json");
  const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, "utf8")) : { version: 1, skills: {} };
  lock.skills[skill.name] = { source: skill.source };
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
  return { ok: true, detail: `from ${skill.source}` };
};
