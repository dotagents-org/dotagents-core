// The skills module, through its interface: listSkills, resolveSkills (with the skills they call), skillsIn,
// and the calls between skills (findRequires) that verifySkills checks.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { addedByCalls, applySkills, listSkills, resolveSkills, skillsIn, verifySkills } from "../core/skills.ts";
import { catalogFile, findRequires, parseSkill } from "../core/thirdparty.ts";
import { REPO, fakeInstaller, fakeThirdParty, quiet, tempWorkspace } from "./helpers.ts";

// Each test here builds a clone of its own, with config/ inside.
delete process.env.DOTAGENTS_CONFIG;

test("own skills and registered third-party skills come from one list", () => {
  const all = listSkills(REPO);
  const toCards = all.find((s) => s.name === "to-cards")!;
  assert.equal(toCards.kind, "own");
  assert.ok(toCards.description.startsWith("Turns loose text"));
  const catalog = JSON.parse(fs.readFileSync(catalogFile(REPO), "utf8")).skills;
  for (const entry of catalog) assert.equal(all.find((s) => s.name === entry.name)?.kind, "third-party");
});

test("names resolve to skills of either kind", () => {
  const [own, third] = resolveSkills(REPO, ["to-cards", "humanizer"]);
  assert.equal(own.kind, "own");
  assert.equal(third.kind, "third-party");
  assert.equal(third.source, "blader/humanizer");
});

test("an unknown name fails and lists what exists", () => {
  assert.throws(() => resolveSkills(REPO, ["not-a-skill"]), /Unknown skill: not-a-skill\. Available: .*to-cards/);
});

test("skillsIn reports linked own skills and installed third-party ones", async (t) => {
  const ws = tempWorkspace(t);
  quiet();
  await applySkills(ws, [...resolveSkills(REPO, ["to-cards"]), fakeThirdParty], { installer: fakeInstaller });
  // fake-skill isn't in the catalog, so only the known skill counts.
  assert.deepEqual(skillsIn(REPO, ws), ["to-cards"]);
});

test("the author's description is read whole, also from a block scalar", () => {
  const text = "---\nname: x\ndescription: |\n  First line.\n  Second line.\nlicense: MIT\n---\nBody";
  assert.deepEqual(parseSkill(text), { name: "x", description: "First line. Second line." });
  assert.equal(parseSkill("---\r\nname: y\r\ndescription: One line.\r\n---\r\n").description, "One line.");
});

// A skill folder with the given SKILL.md body (and extra files).
function writeSkill(dir: string, name: string, body: string, extra: Record<string, string> = {}) {
  const folder = path.join(dir, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "SKILL.md"), `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`);
  for (const [file, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), text);
  }
  return folder;
}

// A repository of its own: config/skills/ with the given own skills and a catalog.
function tempRepo(t: Parameters<typeof tempWorkspace>[0], own: Record<string, string>, catalog: object[] = []) {
  const repo = tempWorkspace(t, "repo");
  for (const [name, body] of Object.entries(own)) writeSkill(path.join(repo, "config", "skills"), name, body);
  fs.mkdirSync(path.join(repo, "config", "skills"), { recursive: true });
  fs.writeFileSync(catalogFile(repo), JSON.stringify({ skills: catalog }));
  return repo;
}

test("a skill calls another through the Skill tool or a link into its folder", (t) => {
  const root = tempWorkspace(t);
  const folder = writeSkill(root, "router", [
    'Call the Skill tool twice, for "grilling" and "domain-modeling".',
    "Tell the user to run `/codebase-design`.", // for the user, not a call
    "| [pixijs-assets](../pixijs-assets/SKILL.md) | Loading |",
    "See the `tdd` skill, and \"humanizer\" in quotes on a plain line.", // mentions, not calls
    'Call the Skill tool with "not-registered".', // unknown name
    'Call the Skill tool with "router".', // itself
  ].join("\n"), { "references/more.md": "Then call the Skill tool with \"to-cards\"." });
  writeSkill(folder, "nested", 'Call the Skill tool with "humanizer".'); // another skill inside it
  const known = ["grilling", "domain-modeling", "codebase-design", "pixijs-assets", "tdd", "humanizer", "to-cards", "router"];
  assert.deepEqual(findRequires(folder, known, "router"), ["domain-modeling", "grilling", "pixijs-assets", "to-cards"]);
});

test("own skills read their calls from the folder, third-party ones from the catalog", (t) => {
  const repo = tempRepo(t, { a: 'Call the Skill tool with "b".', b: "Nothing." }, [
    { name: "c", source: "me/c", description: "C.", requires: ["a"] },
    { name: "d", source: "me/d", description: "D." },
  ]);
  const byName = Object.fromEntries(listSkills(repo).map((s) => [s.name, s.requires]));
  assert.deepEqual(byName, { a: ["b"], b: [], c: ["a"], d: [] });
});

test("chosen skills bring the ones they call, and those bring theirs", (t) => {
  const repo = tempRepo(t, { a: 'Call the Skill tool with "b".', b: 'Call the Skill tool with "x".', x: 'Call the Skill tool with "a".', y: "" }, [
    { name: "c", source: "me/c", description: "C.", requires: ["b", "gone"] }, // gone: no longer registered
  ]);
  const resolved = resolveSkills(repo, ["c", "y"]);
  // The names asked for first, then the calls, each once, through the a → b → x → a cycle.
  assert.deepEqual(resolved.map((s) => s.name), ["c", "y", "b", "x", "a"]);
  assert.deepEqual(addedByCalls(resolved, ["c", "y"]), [
    { name: "b", calledBy: ["c", "a"] },
    { name: "x", calledBy: ["b"] },
    { name: "a", calledBy: ["x"] },
  ]);
  assert.deepEqual(resolveSkills(repo, ["y"]).map((s) => s.name), ["y"]);
});

test("check warns about a skill that calls one missing from the workspace", async (t) => {
  const repo = tempRepo(t, { a: 'Call the Skill tool with "b".', b: "Nothing." });
  const ws = tempWorkspace(t);
  quiet();
  // Only a, as a workspace made before b was called (init would bring b along).
  await applySkills(ws, listSkills(repo).filter((s) => s.name === "a"));
  let events = quiet();
  verifySkills(repo, ws);
  const warnings = events.filter((e) => e.kind === "warning");
  assert.equal(warnings.length, 1);
  assert.match(JSON.stringify(warnings[0]), /\.agents\/skills\/a calls b, which isn't in this workspace.*--skills b/);

  await applySkills(ws, resolveSkills(repo, ["b"]));
  events = quiet();
  verifySkills(repo, ws);
  assert.deepEqual(events.filter((e) => e.kind === "warning"), []);
});

test("DOTAGENTS_CONFIG points the configuration at a folder of your own", (t) => {
  const mine = tempWorkspace(t, "my-config");
  writeSkill(path.join(mine, "skills"), "mine-only", "Only in my folder.");
  fs.writeFileSync(path.join(mine, "skills", "third-party-skills.json"), JSON.stringify({ skills: [] }));
  process.env.DOTAGENTS_CONFIG = mine;
  t.after(() => delete process.env.DOTAGENTS_CONFIG);
  // The skills dotagents brings come along; one of yours with the same name takes its place.
  assert.deepEqual(listSkills(REPO).map((s) => s.name), ["mine-only", "move-sessions", "session-archive"]);
  assert.equal(listSkills(REPO).find((s) => s.name === "session-archive")?.source, path.join(REPO, "skills", "session-archive"));
  writeSkill(path.join(mine, "skills"), "session-archive", "My own take.");
  assert.equal(listSkills(REPO).find((s) => s.name === "session-archive")?.source, path.join(mine, "skills", "session-archive"));
  assert.equal(catalogFile(REPO), path.join(mine, "skills", "third-party-skills.json"));
});
