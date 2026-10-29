// The color level every surface draws with, decided in one place from the environment.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES, backgroundOf, badge, colorLevel, contrast, hexColor, painter, readableOn } from "../core/theme.ts";

test("a terminal gets colors, as deep as it says it supports", () => {
  assert.equal(colorLevel({}, true), 1);
  assert.equal(colorLevel({ TERM: "xterm-256color" }, true), 2);
  assert.equal(colorLevel({ COLORTERM: "truecolor" }, true), 3);
  assert.equal(colorLevel({ WT_SESSION: "x" }, true), 3);
  assert.equal(colorLevel({ TERM_PROGRAM: "vscode" }, true), 3);
});

test("piped output, NO_COLOR and a dumb terminal get no colors", () => {
  assert.equal(colorLevel({}, false), 0);
  assert.equal(colorLevel({ NO_COLOR: "1", COLORTERM: "truecolor" }, true), 0);
  assert.equal(colorLevel({ TERM: "dumb" }, true), 0);
});

test("FORCE_COLOR sets the level, with or without a terminal, over NO_COLOR", () => {
  assert.equal(colorLevel({ FORCE_COLOR: "0" }, true), 0, "0 turns colors off, even in a terminal");
  assert.equal(colorLevel({ FORCE_COLOR: "false" }, true), 0);
  assert.equal(colorLevel({ FORCE_COLOR: "1" }, false), 1);
  assert.equal(colorLevel({ FORCE_COLOR: "true" }, false), 1);
  assert.equal(colorLevel({ FORCE_COLOR: "2" }, false), 2);
  assert.equal(colorLevel({ FORCE_COLOR: "3" }, false), 3);
  assert.equal(colorLevel({ FORCE_COLOR: "3", NO_COLOR: "1" }, false), 3);
});

test("a #RRGGBB color is 24-bit at the top level, the nearest xterm color at 256, the nearest basic one at 16", () => {
  assert.equal(hexColor("#D77655", 3)("x"), "\x1b[38;2;215;118;85mx\x1b[39m");
  assert.equal(hexColor("#D77655", 2)("x"), "\x1b[38;5;173mx\x1b[39m", "the xterm levels are 0 95 135 175 215 255, not a linear scale");
  assert.equal(hexColor("#808080", 2)("x"), "\x1b[38;5;244mx\x1b[39m", "grays come from the gray ramp");
  assert.match(hexColor("#D77655", 1)("x"), /^\x1b\[(3[0-7]|9[0-7])mx\x1b\[39m$/);
  assert.equal(hexColor("#D77655", 0)("x"), "x");
});

test("the background is dark unless DOTAGENTS_THEME or COLORFGBG says light", () => {
  assert.equal(backgroundOf({}), "dark");
  assert.equal(backgroundOf({ DOTAGENTS_THEME: "light" }), "light");
  assert.equal(backgroundOf({ COLORFGBG: "0;15" }), "light");
  assert.equal(backgroundOf({ COLORFGBG: "15;0" }), "dark");
  assert.equal(backgroundOf({ DOTAGENTS_THEME: "dark", COLORFGBG: "0;15" }), "dark");
});

test("every role is readable on its background (4.5:1), except the decorative track", () => {
  for (const [name, role] of Object.entries(ROLES)) {
    if (name === "track") continue;
    assert.ok(contrast(role.light, "#ffffff") >= 4.5, `${name} on white: ${contrast(role.light, "#ffffff")}`);
    assert.ok(contrast(role.dark, "#000000") >= 4.5, `${name} on black: ${contrast(role.dark, "#000000")}`);
  }
});

test("a profile color too faint for text gets a variant of the same hue that passes 4.5:1", () => {
  assert.equal(readableOn("#D77655", "dark"), "#D77655", "already readable on black");
  const light = readableOn("#D77655", "light");
  assert.notEqual(light, "#D77655");
  assert.ok(contrast(light, "#ffffff") >= 4.5);
  const dark = readableOn("#376B80", "dark");
  assert.ok(contrast(dark, "#000000") >= 4.5);
  for (const hex of ["#ffff00", "#000080", "#777777"]) for (const bg of ["light", "dark"] as const) assert.ok(contrast(readableOn(hex, bg), bg === "light" ? "#ffffff" : "#000000") >= 4.5, `${hex} on ${bg}`);
});

test("roles paint in the background's hex, in basic colors at 16, plainly without colors", () => {
  assert.equal(painter(3, "dark").role("ok")("x"), "\x1b[38;2;1;202;84mx\x1b[39m");
  assert.equal(painter(3, "light").role("ok")("x"), "\x1b[38;2;16;125;50mx\x1b[39m");
  assert.equal(painter(1, "dark").role("ok")("x"), "\x1b[32mx\x1b[39m");
  assert.equal(painter(1, "dark").role("text")("x"), "x");
  assert.equal(painter(0, "dark").role("high")("x"), "x");
  assert.equal(painter(0, "dark").bold("x"), "x");
});

test("the badge is the name in reverse video, plain without colors", () => {
  assert.equal(badge(3), "\x1b[7m dotagents \x1b[27m");
  assert.equal(badge(0), "dotagents");
});
