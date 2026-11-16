// Where a Codex profile's login is, and whose it is: the slot, <CODEX_HOME>/auth.json, and the
// vault's copy, <state>/vault/<profile>/auth.json. The file is read only to tell whose login it is,
// and never printed.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Login } from "../providers.ts";
import { type Profile, loadProfiles, providerOf } from "../machine-state.ts";
import { vaultDir } from "../vault.ts";
import { codexHome } from "./codex-config.ts";

export const slotFile = () => path.join(codexHome(), "auth.json");
export const vaultFile = (name: string) => path.join(vaultDir(name), "auth.json");

// A login: the file as Codex wrote it, and who it is. id: the person (chatgpt_user_id); the
// workspace's account_id is the same for every seat in it, so it can't tell two seats apart.
// grant: one completed sign-in (login_owner_id), which renewals keep. plan: the ChatGPT plan type
// ("team"). Read from the id_token, nothing else of it.
export function readLogin(file: string): Login | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const tokens = JSON.parse(text)?.tokens;
    const payload = JSON.parse(Buffer.from(String(tokens?.id_token).split(".")[1] ?? "", "base64url").toString("utf8"));
    const auth = payload?.["https://api.openai.com/auth"];
    const user = auth?.chatgpt_user_id;
    if (typeof user !== "string" || !user) return null;
    const refreshed = Date.parse(JSON.parse(text)?.last_refresh);
    return {
      text,
      file,
      id: user,
      grant: typeof tokens.login_owner_id === "string" ? tokens.login_owner_id : null,
      refreshed: Number.isNaN(refreshed) ? null : refreshed,
      email: typeof payload.email === "string" ? payload.email : "",
      plan: typeof auth.chatgpt_plan_type === "string" && auth.chatgpt_plan_type ? auth.chatgpt_plan_type : null,
    };
  } catch {
    return null;
  }
}

// The mark of a login's refresh token, as loginMark in core/providers/claude-store.ts does for Claude's: tells a
// login apart without keeping any of it.
export function codexLoginMark(text: string): string | null {
  try {
    const token = JSON.parse(text)?.tokens?.refresh_token;
    return typeof token === "string" && token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : null;
  } catch {
    return null;
  }
}

export const codexProfiles = () => loadProfiles().filter((p) => providerOf(p) === "codex");
export const slotLogin = () => readLogin(slotFile());
export const vaultLogin = (name: string) => readLogin(vaultFile(name));
export const ownerOf = (user: string) => codexProfiles().find((p) => vaultLogin(p.name)?.id === user) ?? null;

// The Codex profile whose account is in this side's slot, or null.
export function codexSlotProfile(): Profile | null {
  const slot = slotLogin();
  return slot ? ownerOf(slot.id) : null;
}

// The account of a profile's saved login, or null.
export function codexAccount(p: Profile) {
  const saved = vaultLogin(p.name);
  return saved ? { user: saved.id, email: saved.email, plan: saved.plan } : null;
}
