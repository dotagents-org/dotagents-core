#!/usr/bin/env node
// Searches plugins (or themes, with --themes) in Obsidian's official community list.
// Usage: node search-plugins.mjs <term or regex> [--themes] [--limit=20]

const args = process.argv.slice(2);
const themes = args.includes("--themes");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 20);
const term = args.filter((a) => !a.startsWith("--")).join(" ");

if (!term) {
  console.error("Usage: node search-plugins.mjs <term or regex> [--themes] [--limit=20]");
  process.exit(1);
}

const file = themes ? "community-css-themes.json" : "community-plugins.json";
const url = `https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/${file}`;

const resp = await fetch(url);
if (!resp.ok) {
  console.error(`Failed to download ${url}: HTTP ${resp.status}`);
  process.exit(1);
}

const re = new RegExp(term, "i");
const items = await resp.json();
const matches = items.filter((p) =>
  re.test([p.id, p.name, p.description, p.author].filter(Boolean).join(" "))
);

for (const p of matches.slice(0, limit)) {
  if (themes) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    console.log(`${p.name}\t${p.author}\thttps://community.obsidian.md/themes/${slug}\thttps://github.com/${p.repo}`);
  } else {
    console.log(`${p.id}\t${p.name}\t${p.description}\thttps://community.obsidian.md/plugins/${p.id}`);
  }
}
console.error(`${matches.length} result(s)${matches.length > limit ? `, showing ${limit}` : ""}.`);
