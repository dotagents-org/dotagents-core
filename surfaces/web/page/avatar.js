// The avatars, live (identity, "Avatares"): the pose comes from open-bot-avatar's avatarFrame
// (vendor/open-bot-avatar.js) every animation frame, 60 a second, so blinking, breathing and
// looking move smoothly; the eyes of each state and the status dot are dotagents', drawn on the
// same canvas. One requestAnimationFrame loop paints every avatar on the page; one taken off the
// page leaves it. Exposes window.dotagentsAvatar.mount(canvas, { who, color, state, size }).
"use strict";

(() => {
  const BRAND = "#171717";
  // The bodies: the brand's rounded square, and each account's shape (any other account gets the
  // brand's shape in its own color).
  const SQUARE = "M33 12H67C78.6 12 88 21.4 88 33V67C88 78.6 78.6 88 67 88H33C21.4 88 12 78.6 12 67V33C12 21.4 21.4 12 33 12Z";
  const DEFS = {
    dotagents: { version: 1, id: "dotagents", name: "dotagents", body: { path: SQUARE }, eyes: { x: 50, y: 48, spacing: 24, scale: 1.3 } },
    turing: { version: 1, id: "turing", name: "turing", body: { path: "M30 14H70C80 14 86 20 86 30V70C86 80 80 86 70 86H30C20 86 14 80 14 70V30C14 20 20 14 30 14Z" }, eyes: { x: 50, y: 47, spacing: 26, scale: 1.4 } },
    lovelace: { version: 1, id: "lovelace", name: "lovelace", body: { path: "M50 12A38 38 0 1 1 49.99 12Z" }, eyes: { x: 50, y: 47, spacing: 24, scale: 1.3 } },
  };
  const defFor = (who) => DEFS[who] || { ...DEFS.dotagents, id: "account", name: who };

  // The eyes' ink: the brand's are light; an account's, whichever contrasts more with its body.
  function inkFor(who, color) {
    if (who === "dotagents") return "#ededed";
    const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return (lum + 0.05) / 0.0513 > 1.05 / (lum + 0.05) ? "#151515" : "#f5f5f5";
  }

  // The status dot, in the corner: red needs you (a ring around it when it comes back by itself),
  // amber asks for attention (a ring: a session waits for you), green all good, blue asleep;
  // working has none, its dots below say it.
  const RED = "#ee1d36", AMBER = "#f58a00", GREEN = "#00b84d", BLUE = "#2f7bf5";
  const DOTS = { error: [RED, false], limit: [RED, true], waiting: [AMBER, true], warn: [AMBER, false], ok: [GREEN, false], asleep: [BLUE, false] };

  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  // The region of the viewBox the canvas shows: the body (12..88) with room for the motion, the
  // dot (84, 84) and the working dots (y 95).
  const VIEW = { x: -6, y: -6, size: 112 };

  const avatars = new Set();
  const sections = new Map();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let running = false;

  function mount(canvas, { who, color, state, size = 52 }) {
    const a = { canvas, ctx: canvas.getContext("2d"), def: defFor(who), who, color: who === "dotagents" ? BRAND : color, state, size, open: 0, offset: Math.random() * 10 };
    a.ink = inkFor(who, a.color);
    canvas.width = canvas.height = Math.round(size * (devicePixelRatio || 1));
    canvas.style.width = canvas.style.height = `${size}px`;
    avatars.add(a);
    paint(a, performance.now() / 1000);
    if (!running && !reduced.matches) {
      running = true;
      requestAnimationFrame(loop);
    }
  }

  function loop(ms) {
    for (const a of avatars) {
      if (!a.canvas.isConnected) avatars.delete(a);
      else if (!document.hidden) paint(a, ms / 1000);
    }
    if (avatars.size && !reduced.matches) requestAnimationFrame(loop);
    else running = false;
  }

  function eyeGlyph(ctx, a, mark) {
    const s = a.state;
    // The eye's center, and how open it is now (a blink squeezes the pill): the round eyes close too.
    const pill = mark.shape === "pill";
    const cx = pill ? mark.x + mark.width / 2 : 50, cy = pill ? mark.y + mark.height / 2 : 48;
    if (pill) a.open = Math.max(a.open, mark.height);
    const lid = pill && a.open ? mark.height / a.open : 1;
    ctx.fillStyle = ctx.strokeStyle = a.ink;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    const left = mark.left;
    if (s === "error") {
      ctx.beginPath(); ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5); ctx.stroke();
    } else if (s === "limit") {
      ctx.beginPath(); ctx.moveTo(cx + (left ? -4 : 4), cy - 7); ctx.lineTo(cx + (left ? 5 : -5), cy); ctx.lineTo(cx + (left ? -4 : 4), cy + 7); ctx.stroke();
    } else if (s === "asleep") {
      ctx.beginPath(); ctx.roundRect(cx - 6, cy - 2.2, 12, 4.4, 2.2); ctx.fill();
    } else if (a.who === "dotagents" || s === "waiting") {
      // The brand's round `..`, and the round eyes of waiting; both blink.
      const r = s === "waiting" ? 7.5 : 7;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, Math.max(0.6, r * lid), 0, 0, Math.PI * 2); ctx.fill();
    } else if (pill) {
      ctx.beginPath(); ctx.roundRect(mark.x, mark.y, mark.width, mark.height, mark.radius); ctx.fill();
    } else {
      ctx.lineWidth = mark.strokeWidth; ctx.stroke(new Path2D(mark.d));
    }
    if (s === "warn") {
      // Worried brows, inner end up.
      const top = (a.who === "dotagents" ? cy - 7 : pill ? mark.y : cy - 6) - 4;
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      if (left) { ctx.moveTo(cx - 6, top + 1); ctx.lineTo(cx + 5, top - 4); } else { ctx.moveTo(cx + 6, top + 1); ctx.lineTo(cx - 5, top - 4); }
      ctx.stroke();
    }
  }

  function paint(a, seconds) {
    const t = seconds + a.offset;
    const s = a.state;
    const frame = OpenBotAvatar.avatarFrame(a.def, {
      color: a.color,
      eyeColor: a.ink,
      motion: s === "working" ? "thinking" : "idle",
      time: t,
      gaze: s === "waiting" ? { x: 0, y: 0.2 } : undefined,
      depth: s === "asleep" ? 4 : undefined,
      reducedMotion: reduced.matches,
    });
    for (const p of frame.paths) if (!sections.has(p.id)) sections.set(p.id, { path: new Path2D(p.d), rule: p.evenOdd ? "evenodd" : "nonzero" });
    if (sections.size > 4096) sections.clear();
    const ctx = a.ctx;
    const k = a.canvas.width / VIEW.size;
    const view = [k, 0, 0, k, -VIEW.x * k, -VIEW.y * k];
    // working hops twice a loop of 3 s and squashes a little where it lands.
    let root = frame.root;
    if (s === "working") {
      const hop = Math.abs(Math.sin((t / 3) * Math.PI * 2));
      const sy = hop < 0.15 ? 0.93 : 1, sx = hop < 0.15 ? 1.05 : 1;
      root = mul([sx, 0, 0, sy, 50 - 50 * sx, 92 - 92 * sy - 6 * hop], root);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
    let eye = 0;
    for (const shape of frame.shapes) {
      const m = mul(view, mul(root, shape.matrix));
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      if (shape.kind === "slice") {
        const sec = sections.get(shape.path);
        ctx.fillStyle = a.color;
        ctx.fill(sec.path, sec.rule);
      } else eyeGlyph(ctx, a, { ...shape.mark, left: eye++ === 0 });
    }
    ctx.setTransform(view[0], 0, 0, view[3], view[4], view[5]);
    if (s === "working") {
      const lit = Math.floor((t / 3) * 6) % 3;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i === lit ? 1 : 0.3;
        ctx.fillStyle = a.who === "dotagents" ? "#8f8f8f" : a.color;
        ctx.beginPath(); ctx.arc(38 + i * 12, 95, 4.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const dot = DOTS[s];
    if (dot) {
      const [color, ring] = dot;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(84, 84, ring ? 12 : 11.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      if (ring) {
        ctx.strokeStyle = color; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(84, 84, 9.5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(84, 84, 5.2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(84, 84, 10, 0, Math.PI * 2); ctx.fill();
        if (s === "asleep") {
          ctx.fillStyle = "#ffffff";
          ctx.fill(new Path2D("M87.5 78.8A5.6 5.6 0 1 0 89.2 87.2A4.4 4.4 0 0 1 87.5 78.8Z"));
        }
      }
    }
  }

  window.dotagentsAvatar = { mount };
})();
