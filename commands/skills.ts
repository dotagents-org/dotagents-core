// `skills` lists the own and third-party skills; `skills add` and `skills remove` edit the
// third-party catalog.

import path from "node:path";
import * as p from "@clack/prompts";
import { displayPath, fancy, finish, header, interactive, line, rail, report, section, style } from "../lib/output.ts";
import { listSkills } from "../lib/skills.ts";
import { state } from "../lib/state.ts";
import { SAFE_NAME, SAFE_SOURCE, catalogFile, discoverSkills, loadCatalog, saveCatalog } from "../lib/thirdparty.ts";
import { type Command, fitHint, wrap } from "./shared.ts";

const { bold, dim, cyan, green, gray } = style;

export const skills: Command = {
  name: "skills",
  usage: "",
  summary: "list your skills and the registered third-party ones",
  group: "Skills",
  run({ repo, positional }) {
    const sub = positional[0];
    if (sub) throw new Error(`Unknown subcommand 'skills ${sub}'. Use: dotagents skills [add <source> | remove <name>]`);
    const all = listSkills(repo);
    const own = all.filter((s) => s.kind === "own");
    const thirdParty = all.filter((s) => s.kind === "third-party");
    if (!fancy) {
      own.forEach((s) => console.log(`${s.name.padEnd(20)} ${s.description}`));
      thirdParty.forEach((s) => console.log(`${s.name.padEnd(20)} ${s.description}  (third-party: ${s.source})`));
      return;
    }
    const width = Math.max(...all.map((s) => s.name.length)) + 2;
    const columns = Math.max(60, process.stdout.columns || 100);
    const row = (name: string, text: string, color: (text: string) => string) => {
      const lines = wrap(text, columns - width - 6);
      line(`${color(name.padEnd(width))}${dim(lines[0] ?? "")}`);
      for (const rest of lines.slice(1)) line(`${" ".repeat(width)}${dim(rest)}`);
    };
    console.log(`${rail.start()}  ${bold(`${own.length} skills`)} ${dim(`in ${displayPath(path.join(repo, "skills"))}`)}`);
    line();
    for (const s of own) row(s.name, s.description, green);
    line();
    console.log(`${style.cyan("◇")}  ${bold(`${thirdParty.length} third-party`)} ${dim("registered in skills/third-party-skills.json, installed with npx skills")}`);
    if (!thirdParty.length) line(dim("None yet. Register one with: dotagents skills add <owner/repo>"));
    for (const s of thirdParty) {
      row(s.name, s.description, cyan);
      line(`${" ".repeat(width)}${gray(`from ${s.source}`)}`);
    }
    line();
    console.log(`${rail.end()}  ${dim("Use in a workspace:")} dotagents init ${dim("<path>")} --skills ${dim("<name>")}
`);
  },
};

export const skillsAdd: Command = {
  name: "skills add",
  usage: "<source>",
  summary: "register third-party skills (owner/repo, git URL or path)",
  more: ["--skills a,b picks some when the source has several,", "--all takes every skill in the source;", "init and new offer them; installed with npx skills add"],
  group: "Skills",
  async run({ repo, args, positional }) {
    const source = positional[0];
    if (!source) throw new Error("Usage: dotagents skills add <source> [--skills a,b]   (source: owner/repo, a git URL or a path)");
    if (!SAFE_SOURCE.test(source)) throw new Error(`'${source}' has characters that aren't allowed in a source`);
    header("skills add", source);
    section("Source");
    const found = await discoverSkills(source);
    if (!found.length) throw new Error(`No SKILL.md found in ${source}`);

    let chosen = found;
    if (args.all) {
      chosen = found;
    } else if (args.skills) {
      const wanted = args.skills;
      const missing = wanted.filter((n) => !found.some((s) => s.name === n));
      if (missing.length) throw new Error(`${source} has no skill named ${missing.join(", ")}. It has: ${found.map((s) => s.name).join(", ")}`);
      chosen = found.filter((s) => wanted.includes(s.name));
    } else if (found.length > 1) {
      if (!interactive || args.yes) {
        throw new Error(`${source} has ${found.length} skills (${found.map((s) => s.name).join(", ")}). Pick with --skills a,b, or take them all with --all`);
      }
      const picked = await p.multiselect({
        message: `Which skills from ${bold(source)} should be registered?`,
        options: found.map((s) => ({ value: s.name, label: s.name, hint: fitHint(s.description, s.name) })),
        required: true,
      });
      if (p.isCancel(picked)) {
        p.cancel("Nothing was registered.");
        process.exit(0);
      }
      chosen = found.filter((s) => picked.includes(s.name));
    }

    const catalog = loadCatalog(repo);
    const own = listSkills(repo).filter((s) => s.kind === "own").map((s) => s.name);
    const file = catalogFile(repo);
    section("Catalog");
    for (const skill of chosen) {
      if (!SAFE_NAME.test(skill.name)) {
        report("skipped", file, `${skill.name}: not a valid skill name`);
        continue;
      }
      if (own.includes(skill.name)) {
        report("skipped", file, `${skill.name}: same name as one of your skills in skills/`);
        continue;
      }
      const existing = catalog.find((s) => s.name === skill.name);
      if (existing && existing.source === source && existing.description === skill.description) {
        report("ok", file, `${skill.name} from ${source}`);
        continue;
      }
      if (existing && existing.source !== source) {
        report("skipped", file, `${skill.name} is already registered from ${existing.source}; remove it first`);
        continue;
      }
      report(state.dryRun ? (existing ? "would update" : "would create") : existing ? "updated" : "created", file, `${skill.name} from ${source}`);
      if (!state.dryRun) {
        const entry = { name: skill.name, source, description: skill.description };
        if (existing) Object.assign(existing, entry);
        else catalog.push(entry);
      }
    }
    if (!state.dryRun) saveCatalog(repo, catalog);
    finish("Commit skills/third-party-skills.json to have them on your other machines. Use one: dotagents init <path> --skills <name>");
  },
};

export const skillsRemove: Command = {
  name: "skills remove",
  usage: "<name>",
  summary: "unregister a third-party skill",
  group: "Skills",
  run({ repo, positional }) {
    const name = positional[0];
    if (!name) throw new Error("Usage: dotagents skills remove <name>");
    const catalog = loadCatalog(repo);
    const file = catalogFile(repo);
    header("skills remove", name);
    section("Catalog");
    if (!catalog.some((s) => s.name === name)) {
      report("skipped", file, `${name} is not registered`);
      return finish();
    }
    report(state.dryRun ? "would update" : "updated", file, `removed ${name} (workspaces that installed it keep it)`);
    if (!state.dryRun) saveCatalog(repo, catalog.filter((s) => s.name !== name));
    finish();
  },
};
