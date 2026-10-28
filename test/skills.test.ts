// The skills module, through its interface: listSkills, resolveSkills, skillsIn.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { applySkills, listSkills, resolveSkills, skillsIn } from "../lib/skills.ts";
import { catalogFile, parseSkill } from "../lib/thirdparty.ts";
import { REPO, fakeInstaller, fakeThirdParty, quiet, tempWorkspace } from "./helpers.ts";

test("own skills and registered third-party skills come from one list", () => {
  const all = listSkills(REPO);
  const toCards = all.find((s) => s.name === "to-cards");
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
