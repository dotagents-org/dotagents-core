#!/usr/bin/env node
// Searches topics on the Obsidian forum (Discourse).
// Usage: node search-forum.mjs <terms> [--limit=10]

const args = process.argv.slice(2);
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 10);
const terms = args.filter((a) => !a.startsWith("--")).join(" ");

if (!terms) {
  console.error("Usage: node search-forum.mjs <terms> [--limit=10]");
  process.exit(1);
}

const base = "https://forum.obsidian.md";
const resp = await fetch(`${base}/search.json?q=${encodeURIComponent(terms)}`, {
  headers: { Accept: "application/json" },
});
if (!resp.ok) {
  console.error(`Search failed: HTTP ${resp.status}`);
  process.exit(1);
}

const { topics = [] } = await resp.json();
for (const t of topics.slice(0, limit)) {
  const tags = [t.has_accepted_answer && "solved", t.closed && "closed"].filter(Boolean).join(", ");
  const date = (t.last_posted_at ?? t.created_at ?? "").slice(0, 10);
  console.log(`${t.title}${tags ? ` [${tags}]` : ""}\t${date}\t${base}/t/${t.slug}/${t.id}`);
}
console.error(`${topics.length} topic(s)${topics.length > limit ? `, showing ${limit}` : ""}.`);
