// The dotagents panel (ADR 0012): draws the usage JSON of `dotagents start` (every profile, the
// account in each side's slot) and its two actions. It only draws what it is given, so the same
// file serves two places:
// - the page `dotagents start` serves: the data comes by server-sent events, with the token the
//   address carries after #, and the buttons call the API;
// - the VS Code extension's view: the extension posts the data and runs the actions.
"use strict";

(() => {
  // Styles go through the CSSOM: the page's security policy refuses style="..." attributes.
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style") Object.assign(node.style, v);
      else if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
  }

  const level = (pct) => (pct >= 90 ? "high" : pct >= 70 ? "warn" : "ok");
  const label = (w) => (w.kind === "session" ? "5h" : w.kind === "week" ? "7d" : w.model || "model");
  const span = (ms) => {
    const m = Math.floor(ms / 60000);
    if (m < 1) return "<1m";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
  };
  const hhmm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dayTime = (d) => `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${hhmm(d)}`;

  const dark = () => document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast") || (!document.body.classList.contains("vscode-light") && matchMedia("(prefers-color-scheme: dark)").matches);
  // An account's color as text: on a dark background, a third of the way to white, or a dark one
  // (#376B80) fades into it.
  function nameColor(hex) {
    if (!dark() || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    const mix = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) / 3).toString(16).padStart(2, "0");
    return `#${mix(1)}${mix(3)}${mix(5)}`;
  }

  // The avatar, live: avatar.js paints it on a canvas every animation frame.
  function avatar(name, color, state) {
    const canvas = el("canvas", { class: "av", role: "img", "aria-label": `${name}, ${state}` });
    window.dotagentsAvatar.mount(canvas, { who: name, color, state, size: 52 });
    return canvas;
  }

  function windowRow(p, w, now) {
    const tone = level(w.pct);
    const reset = w.reset || !w.resetsAt ? (w.kind === "session" ? "no window open" : "reset") : `resets ${span(Date.parse(w.resetsAt) - now)}`;
    let projection = null;
    const pr = p.state === "ok" ? w.projection : null;
    if (pr && pr.from) projection = el("span", { class: "note" }, `projection from ${hhmm(new Date(pr.from))}`);
    else if (pr && pr.runsOutAt) {
      const when = new Date(pr.runsOutAt);
      projection = el("span", { class: "note warn" }, `~${pr.atResetPct}% at reset, runs out ${w.kind === "session" ? hhmm(when) : dayTime(when)}`);
    } else if (pr) projection = el("span", { class: "note" }, `~${pr.atResetPct}% at reset`);
    return el(
      "div",
      { class: "window" },
      el("span", { class: "label" }, label(w)),
      el("span", { class: "bar" }, el("span", { class: tone, style: { width: `${Math.max(0, Math.min(100, w.pct))}%` } })),
      el("span", { class: `pct ${tone}` }, `${w.pct}%`),
      el("span", { class: "note" }, reset),
      projection
    );
  }

  // root: where to draw; data: the usage JSON; act(action, profile): runs an action, resolves to
  // { ok, detail }.
  function render(root, data, { act }) {
    const now = Date.now();
    const slots = data.slots || {};
    const sides = Object.keys(slots);
    const message = el("p", { class: "message", hidden: "" });
    const say = (text, bad) => {
      message.textContent = text;
      message.className = bad ? "message high" : "message";
      message.hidden = !text;
    };
    const cards = data.profiles.map((p) => {
      const here = sides.filter((s) => slots[s] === p.name);
      const everywhere = sides.length > 0 && here.length === sides.length;
      const busy = p.activity ? [p.activity.working && `${p.activity.working} working`, p.activity.waiting && `${p.activity.waiting} waiting on you`].filter(Boolean).join(", ") : "";
      const status = p.avatar === "error" ? p.error || `no login here, run: dotagents login ${p.name}` : busy;
      const run = (action, doing) => async (e) => {
        const buttons = e.currentTarget.parentElement.querySelectorAll("button");
        buttons.forEach((b) => (b.disabled = true));
        say(doing);
        const res = await act(action, p.name).catch((err) => ({ ok: false, detail: String(err) }));
        say(res.detail || "", !res.ok);
        buttons.forEach((b) => (b.disabled = false));
      };
      return el(
        "article",
        { class: "card" },
        el(
          "div",
          { class: "who" },
          avatar(p.name, p.color, p.avatar || "asleep"),
          el(
            "div",
            { class: "names" },
            el("div", { class: "line" }, el("span", { class: "name", style: { color: nameColor(p.color) } }, p.name), ...here.map((s) => el("span", { class: "slot" }, s))),
            status && el("span", { class: `status small ${p.avatar === "error" ? "high" : "muted"}` }, status)
          )
        ),
        ...p.windows.map((w) => windowRow(p, w, now)),
        el(
          "div",
          { class: "actions" },
          !everywhere && el("button", { class: "primary", type: "button", onclick: run("switch", `switching to ${p.name}...`) }, "Use on both sides"),
          el("button", { type: "button", onclick: run("desktop", `opening ${p.name}...`) }, "Open Desktop")
        )
      );
    });
    const age = data.generatedAt ? `live, ${span(now - Date.parse(data.generatedAt))} ago` : "";
    const where = data.peer && !data.peer.up ? `${data.peer.name} off` : sides.join(" and ");
    root.replaceChildren(
      el("div", { class: "head" }, el("span", { class: "badge" }, "dotagents"), el("span", { class: "muted" }, age)),
      el("div", { class: "cards" }, ...cards),
      message,
      el("div", { class: "foot" }, el("span", {}, where))
    );
  }

  const root = document.getElementById("panel");
  if (!root) return;

  // In VS Code: the extension posts the data and the avatars' folder, and runs the actions.
  if (typeof acquireVsCodeApi === "function") {
    const vscode = acquireVsCodeApi();
    const waiting = new Map();
    let next = 0;
    const act = (action, profile) =>
      new Promise((resolve) => {
        const id = ++next;
        waiting.set(id, resolve);
        vscode.postMessage({ type: "action", id, action, profile });
      });
    addEventListener("message", (e) => {
      const m = e.data;
      if (m.type === "usage") render(root, m.data, { act }); else if (m.type === "result" && waiting.has(m.id)) {
        waiting.get(m.id)(m.result);
        waiting.delete(m.id);
      } else if (m.type === "down") root.replaceChildren(el("p", { class: "message" }, m.detail));
    });
    vscode.postMessage({ type: "ready" });
    return;
  }

  // In the browser: the token from the address (kept for a reload, then taken off the address).
  const token = new URLSearchParams(location.hash.slice(1)).get("token") || sessionStorage.getItem("dotagents-token");
  if (token) sessionStorage.setItem("dotagents-token", token);
  history.replaceState(null, "", location.pathname);
  if (!token) {
    root.textContent = "Open the address dotagents start printed: it carries the token.";
    return;
  }
  const act = async (action, profile) => {
    const res = await fetch(`/api/${action}`, { method: "POST", headers: { "content-type": "application/json", "x-dotagents-token": token }, body: JSON.stringify({ profile }) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, detail: body.detail || (res.ok ? "" : `HTTP ${res.status}`) };
  };
  let last = null;
  const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener("usage", (e) => {
    last = JSON.parse(e.data);
    render(root, last, { act });
  });
  // The age and the resets move on between the server's updates.
  setInterval(() => last && !root.contains(document.activeElement) && render(root, last, { act }), 30_000);
})();
