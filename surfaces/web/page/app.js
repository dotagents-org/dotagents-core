// A first page for the local server: the usage of every profile, live. Temporary: the visual app's
// page, in the identity, replaces it once its stack is chosen.
"use strict";

const token = new URLSearchParams(location.hash.slice(1)).get("token") || sessionStorage.getItem("dotagents-token");
if (token) sessionStorage.setItem("dotagents-token", token);
history.replaceState(null, "", location.pathname);

const app = document.getElementById("app");
const level = (pct) => (pct >= 90 ? "high" : pct >= 70 ? "warn" : "ok");
const label = (w) => (w.kind === "session" ? "5h" : w.kind === "week" ? "7d" : w.model || "model");
const span = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function render(data) {
  const now = Date.now();
  app.replaceChildren(
    el("h1", {}, el("img", { src: "face.svg", alt: "", width: "28", height: "28" }), " dotagents"),
    ...data.profiles.map((p) => {
      const head = el("h2", { style: `color:${p.color}` }, p.name);
      if (p.default) head.append(el("span", { class: "muted" }, " default"));
      if (p.fetchedAt) head.append(el("span", { class: "muted" }, ` ${span(now - Date.parse(p.fetchedAt))} ago${p.from ? ` on ${p.from}` : ""}`));
      const rows = p.windows.map((w) =>
        el(
          "div",
          { class: `row ${p.state === "stale" ? "stale" : level(w.pct)}` },
          el("span", { class: "label" }, label(w)),
          el("span", { class: "bar" }, el("span", { class: "used", style: `width:${w.pct}%` })),
          el("b", {}, `${w.pct}%`),
          el("span", { class: "muted" }, w.reset || !w.resetsAt ? "reset" : `resets ${span(Date.parse(w.resetsAt) - now)}`)
        )
      );
      return el("section", {}, head, ...(rows.length ? rows : [el("p", { class: "muted" }, p.state.replace(/-/g, " "))]));
    })
  );
}

if (!token) app.textContent = "Open the address dotagents serve printed: it carries the token.";
else {
  const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener("usage", (e) => render(JSON.parse(e.data)));
}
