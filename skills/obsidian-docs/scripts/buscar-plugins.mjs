#!/usr/bin/env node
// Busca plugins (ou temas, com --temas) na lista oficial da comunidade do Obsidian.
// Uso: node buscar-plugins.mjs <termo ou regex> [--temas] [--limite=20]

const args = process.argv.slice(2);
const temas = args.includes("--temas");
const limite = Number(args.find((a) => a.startsWith("--limite="))?.split("=")[1] ?? 20);
const termo = args.filter((a) => !a.startsWith("--")).join(" ");

if (!termo) {
  console.error("Uso: node buscar-plugins.mjs <termo ou regex> [--temas] [--limite=20]");
  process.exit(1);
}

const arquivo = temas ? "community-css-themes.json" : "community-plugins.json";
const url = `https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/${arquivo}`;

const resp = await fetch(url);
if (!resp.ok) {
  console.error(`Falha ao baixar ${url}: HTTP ${resp.status}`);
  process.exit(1);
}

const re = new RegExp(termo, "i");
const itens = await resp.json();
const achados = itens.filter((p) =>
  re.test([p.id, p.name, p.description, p.author].filter(Boolean).join(" "))
);

for (const p of achados.slice(0, limite)) {
  if (temas) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    console.log(`${p.name}\t${p.author}\thttps://community.obsidian.md/themes/${slug}\thttps://github.com/${p.repo}`);
  } else {
    console.log(`${p.id}\t${p.name}\t${p.description}\thttps://community.obsidian.md/plugins/${p.id}`);
  }
}
console.error(`${achados.length} resultado(s)${achados.length > limite ? `, mostrando ${limite}` : ""}.`);
