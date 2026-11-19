// What each provider is called, and the words that name it in messages. A leaf: no module of the
// providers imports it back, so the places that only print (the usage view, the commands) use it
// without reaching an adapter. The table of names is the plan's (2026-11-16): the account is
// Claude or ChatGPT, the tool Claude Code or Codex, the company Anthropic or OpenAI.

import type { ProviderId } from "../machine/machine-state.ts";

export type Labels = {
  // The account, in group headings and lists.
  account: string;
  // The tool that holds the account's login in a slot.
  tool: string;
  // Who refuses a login and answers for the usage.
  company: string;
  // How a profile is called in "There is no ... named x".
  profile: string;
  // What a profile with no saved login says in the usage view.
  noLogin: (name: string) => string;
};

export const LABELS: Record<ProviderId, Labels> = {
  claude: {
    account: "Claude",
    tool: "Claude Code",
    company: "Anthropic",
    profile: "Claude profile",
    noLogin: (name) => `no saved login: run dotagents login ${name}`,
  },
  codex: {
    account: "ChatGPT",
    tool: "Codex",
    company: "OpenAI",
    profile: "ChatGPT profile",
    noLogin: (name) => `no saved login: run dotagents login ${name}`,
  },
};
