// Copies the panel (surfaces/web/page: panel.css, panel.js, avatars/) into media/panel/, so the
// .vsix carries it: one panel for the page `dotagents start` serves and for this view (ADR 0012).
// Run by `npm run package`; from the repository, the extension reads ../web/page directly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(here, "..", "web", "page");
const out = path.join(here, "media", "panel");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "avatars"), { recursive: true });
for (const f of ["panel.css", "panel.js"]) fs.copyFileSync(path.join(page, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(page, "avatars"))) fs.copyFileSync(path.join(page, "avatars", f), path.join(out, "avatars", f));
console.log(`panel copied to ${path.relative(process.cwd(), out)}`);
