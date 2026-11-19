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
  // The plan as the product names it, from the provider's ids, with the seat when the provider
  // tells it: "Team Standard" for Claude, "Business" for ChatGPT (the API still says team, its
  // name until 2025). Null without a plan.
  plan: (plan: string | null | undefined, seat?: string | null) => string | null;
};

// An id the table doesn't know shows as itself, capitalized: "max_5x" is "Max 5x".
const named = (names: Record<string, string>, id: string) => names[id] ?? id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export const LABELS: Record<ProviderId, Labels> = {
  claude: {
    account: "Claude",
    tool: "Claude Code",
    company: "Anthropic",
    profile: "Claude profile",
    noLogin: (name) => `no saved login: run dotagents login ${name}`,
    // seatTier: team_standard, team_premium; the plan's own name goes before it once
    plan: (plan, seat) => {
      if (!plan) return null;
      const name = named({ team: "Team", pro: "Pro", max: "Max", enterprise: "Enterprise" }, plan);
      const tier = seat ? named({}, seat.startsWith(`${plan}_`) ? seat.slice(plan.length + 1) : seat) : "";
      return tier ? `${name} ${tier}` : name;
    },
  },
  codex: {
    account: "ChatGPT",
    tool: "Codex",
    company: "OpenAI",
    profile: "ChatGPT profile",
    noLogin: (name) => `no saved login: run dotagents login ${name}`,
    // OpenAI tells no seat type
    plan: (plan) => (plan ? named({ team: "Business", business: "Business", plus: "Plus", pro: "Pro", enterprise: "Enterprise", free: "Free" }, plan) : null),
  },
};
