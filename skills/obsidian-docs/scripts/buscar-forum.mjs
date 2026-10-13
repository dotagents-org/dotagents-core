#!/usr/bin/env node
// Busca tópicos no fórum do Obsidian (Discourse).
// Uso: node buscar-forum.mjs <termos> [--limite=10]

const args = process.argv.slice(2);
const limite = Number(args.find((a) => a.startsWith("--limite="))?.split("=")[1] ?? 10);
const termos = args.filter((a) => !a.startsWith("--")).join(" ");

if (!termos) {
  console.error("Uso: node buscar-forum.mjs <termos> [--limite=10]");
  process.exit(1);
}

const base = "https://forum.obsidian.md";
const resp = await fetch(`${base}/search.json?q=${encodeURIComponent(termos)}`, {
  headers: { Accept: "application/json" },
});
if (!resp.ok) {
  console.error(`Falha na busca: HTTP ${resp.status}`);
  process.exit(1);
}

const { topics = [] } = await resp.json();
for (const t of topics.slice(0, limite)) {
  const marcas = [t.has_accepted_answer && "resolvido", t.closed && "fechado"].filter(Boolean).join(", ");
  const data = (t.last_posted_at ?? t.created_at ?? "").slice(0, 10);
  console.log(`${t.title}${marcas ? ` [${marcas}]` : ""}\t${data}\t${base}/t/${t.slug}/${t.id}`);
}
console.error(`${topics.length} tópico(s)${topics.length > limite ? `, mostrando ${limite}` : ""}.`);
