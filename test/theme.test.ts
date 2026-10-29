// The color level every surface draws with, decided in one place from the environment.

import assert from "node:assert/strict";
import { test } from "node:test";
import { colorLevel, hexColor } from "../core/theme.ts";

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

test("a #RRGGBB color is 24-bit at the top level, the closest 256 color below it, nothing without colors", () => {
  assert.equal(hexColor("#D77655", 3)("x"), "\x1b[38;2;215;118;85mx\x1b[39m");
  assert.equal(hexColor("#D77655", 2)("x"), "\x1b[38;5;174mx\x1b[39m");
  assert.equal(hexColor("#D77655", 1)("x"), "\x1b[38;5;174mx\x1b[39m");
  assert.equal(hexColor("#D77655", 0)("x"), "x");
});
