// `login`: signing a profile in again, when its login runs out (every few weeks). What every
// provider shares is here: finding the profile, the check that the account signed in is the
// profile's, and keeping the new login in its vault. How the sign-in runs differs, so it is the
// provider's own (core/accounts/providers.ts): Claude through this side's slot, putting the previous account
// back after; Codex in a temporary folder of its own, never ~/.codex. --all takes each provider's due ones:
// Claude's that run out within a week or were refused, ChatGPT's with no copy saved or refused.

import { saveToVault, putInSlot, switchHere } from "./switch.ts";
import { type Profile, loadProfiles, sideName } from "../machine/machine-state.ts";
import { report, section } from "../output/output.ts";
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
  if (!all && !name) throw new Error("Usage: dotagents login <profile>, or dotagents login --all");
  const profile = !all && name ? loadProfiles().find((p) => p.name === name) : undefined;
  if (name && !all && !profile) throw new Error(`There is no profile named ${name}`);
  // --all: each provider's due logins, Claude's first, each signed in its own way
  const work = all
    ? providers().flatMap((provider) => {
        const due = provider.dueLogins?.(now) ?? [];
        return due.length ? [{ provider, due }] : [];
      })
    : [{ provider: providerFor(profile!), due: providerFor(profile!).profiles().filter((p) => p.name === name) }];
  if (!work.length) {
    section("Logins");
    return report("ok", sideName(), "every login lasts more than a week, and none was refused");
  }
  // One provider's failure (an unknown account in its slot, say) doesn't stop the others': it is told, and
  // thrown at the end so the exit code says it
  const failures: Error[] = [];
  for (const { provider, due } of work) {
    const ctx: SignInContext = {
      accept: (p, fresh, who, onMismatch) => accept(provider, p, fresh, who, onMismatch),
      save: (n, login) => saveToVault(provider, n, login),
      put: (n, login) => putInSlot(provider, n, login, { codex: options.codex }),
      switchHere: (n) => switchHere(provider, n, undefined),
    };
    try {
      await provider.signIn(due, { now, ...options }, ctx);
    } catch (err) {
      if (!all || work.length === 1) throw err;
      report("failed", provider.labels.account, (err as Error).message);
      failures.push(err as Error);
    }
  }
  if (failures.length) throw new Error(`${failures.length} provider${failures.length === 1 ? "" : "s"} could not sign in: ${failures.map((f) => f.message).join("; ")}`);
}
