// `login`: signing a profile in again, when its login runs out (every few weeks). What every
// provider shares is here: finding the profile, the check that the account signed in is the
// profile's, and keeping the new login in its vault. How the sign-in runs differs, so it is the
// provider's own (core/accounts/providers.ts): Claude through this side's slot, putting the previous account
// back after; Codex in a temporary folder of its own, never ~/.codex. --all is Claude's for now.

import { saveToVault, putInSlot, switchHere } from "./switch.ts";
import { type Profile, loadProfiles, sideName } from "../machine-state.ts";
import { report, section } from "../output.ts";
import { type Login, type Provider, type SignInContext, type SignInOptions, providerFor, providers } from "./providers.ts";

export type LoginOptions = SignInOptions & { name?: string; all?: boolean };

// The check that a login just signed in is the profile's account: not another profile's, and not
// another account than the one already saved. Throws, after onMismatch, when it isn't.
function accept(provider: Provider, p: Profile, fresh: Login, who: string, onMismatch?: (owner: Profile | null) => void) {
  const known = provider.saved(p);
  const owner = provider.ownerOf(fresh.id);
  if ((known && known.id !== fresh.id) || (owner && owner.name !== p.name)) {
    onMismatch?.(owner);
    throw new Error(`Signed in as ${who}, not ${p.name}'s account; run it again and choose that account in the browser`);
  }
}

export async function loginProfile({ name, all = false, now = new Date(), ...options }: LoginOptions) {
  const profile = !all && name ? loadProfiles().find((p) => p.name === name) : undefined;
  // --all belongs to the provider that can tell which logins run out; else the first one.
  const provider = profile ? providerFor(profile) : all ? (providers().find((p) => p.dueLogins) ?? providers()[0]) : providers()[0];
  if (!all && !name) throw new Error("Usage: dotagents login <profile>, or dotagents login --all");
  if (name && !provider.profiles().some((p) => p.name === name)) throw new Error(`There is no ${provider.labels.profile} named ${name}`);
  const due = all ? (provider.dueLogins?.(now) ?? []) : provider.profiles().filter((p) => p.name === name);
  if (!due.length) {
    section("Logins");
    return report("ok", sideName(), "every login lasts more than a week");
  }
  const ctx: SignInContext = {
    accept: (p, fresh, who, onMismatch) => accept(provider, p, fresh, who, onMismatch),
    save: (n, login) => saveToVault(provider, n, login),
    put: (n, login) => putInSlot(provider, n, login, { codex: options.codex }),
    switchHere: (n) => switchHere(provider, n, undefined),
  };
  await provider.signIn(due, { now, ...options }, ctx);
}
