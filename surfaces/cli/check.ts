import { finish, header } from "../../core/output.ts";
import { state } from "../../core/state.ts";
import { assertWorkspace, verifyWorkspace } from "../../core/workspace.ts";
import { type Command, workspaceArg } from "./shared.ts";

export const check: Command = {
  name: "check",
  usage: "[path]",
  summary: "run the checklist, change nothing",
  group: "Workspace",
  run(ctx) {
    const ws = workspaceArg(ctx);
    assertWorkspace(ctx.repo, ws);
    header("check", ws);
    state.base = ws;
    verifyWorkspace(ctx.repo, ws);
    finish(state.problems ? "" : "Everything follows the standards.");
  },
};
