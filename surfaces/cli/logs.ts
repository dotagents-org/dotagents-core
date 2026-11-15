// `logs`: where the logs of both sides of the machine are, and the last lines of each (docs/logs.md).

import fs from "node:fs";
import path from "node:path";
import { UsageError } from "../../core/common.ts";
import { type LogName, logsDir, peerLogsDir } from "../../core/log.ts";
import { loadMachine } from "../../core/machine-state.ts";
import { brand, displayPath, tone } from "../../core/output.ts";
import { sideName } from "../../core/switch.ts";
import type { Command } from "./shared.ts";

const { bold, muted } = tone;
const NAMES: LogName[] = ["core", "sidebar", "host"];
const LINES = 50;

export const logs: Command = {
  name: "logs",
  usage: "[--side <side>]",
  summary: "where the logs of both sides are, and the last lines of each",
  more: ["core.log, sidebar.log and host.log, in <state>/logs/;", "--side wsl or windows: only that side"],
  group: "Machine",
  run({ args }) {
    let peer;
    try {
      peer = loadMachine().peer;
    } catch {
      peer = undefined;
    }
    const sides = [{ name: sideName(), dir: logsDir() }, ...(peer ? [{ name: peer.name, dir: peerLogsDir(peer.home) }] : [])];
    const want = args.side?.toLowerCase();
    const shown = want ? sides.filter((s) => s.name.toLowerCase() === want) : sides;
    if (want && !shown.length) throw new UsageError(`--side takes ${sides.map((s) => s.name.toLowerCase()).join(" or ")}, not ${args.side}`);
    console.log(`${brand()}  ${bold("logs")}`);
    for (const side of shown) {
      console.log(`\n${bold(side.name)}  ${displayPath(side.dir)}`);
      for (const name of NAMES) {
        let text;
        try {
          text = fs.readFileSync(path.join(side.dir, `${name}.log`), "utf8");
        } catch {
          console.log(`  ${name}.log  ${muted("none yet")}`);
          continue;
        }
        const lines = text.trimEnd().split("\n").slice(-LINES);
        console.log(`\n  ${bold(`${name}.log`)}  ${muted(`last ${lines.length} lines`)}`);
        for (const l of lines) console.log(`  ${l}`);
      }
    }
  },
};
