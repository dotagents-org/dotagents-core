// A stand-in for `codex app-server`, speaking its JSON-RPC over stdio. What it answers to
// account/rateLimits/read is FAKE_MODE; every start and every request is logged to FAKE_LOG.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const { FAKE_MODE: mode = "good", FAKE_LOG: log, CODEX_HOME: home } = process.env;
const note = (entry) => fs.appendFileSync(log, `${JSON.stringify(entry)}\n`);
const authFile = path.join(home, "auth.json");
const auth = () => JSON.parse(fs.readFileSync(authFile, "utf8"));
note({ start: true, pid: process.pid, home, config: fs.existsSync(path.join(home, "config.toml")), apiKeyEnv: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) });

const window = (usedPercent, windowDurationMins, resetsAt) => ({ usedPercent, windowDurationMins, resetsAt });
const snapshot = (primary, secondary) => ({ limitId: "codex", primary, secondary, planType: "team", credits: null, spendControlReached: false, rateLimitReachedType: null });
const NOW_S = Number(process.env.FAKE_NOW_S);
const good = snapshot(window(42, 300, NOW_S + 3600), window(17, 10080, NOW_S + 86400));

const answers = {
  good: () => ({ result: { rateLimits: good, rateLimitsByLimitId: { codex: good } } }),
  // Only the older field.
  legacy: () => ({ result: { rateLimits: good } }),
  // Windows in the opposite order.
  swapped: () => ({ result: { rateLimits: snapshot(window(17, 10080, NOW_S + 86400), window(42, 300, NOW_S + 3600)) } }),
  // Nothing used: Codex still gives each window a reset a whole window away, and one used window.
  idle: () => ({ result: { rateLimits: snapshot(window(0, 300, NOW_S + 300 * 60 - 2), window(0, 10080, NOW_S + 10080 * 60)) } }),
  idlesession: () => ({ result: { rateLimits: snapshot(window(0, 300, NOW_S + 3600), window(17, 10080, NOW_S + 86400)) } }),
  unknown: () => ({ result: { rateLimits: snapshot(window(5, 60, NOW_S + 60), null) } }),
  empty: () => ({ result: { rateLimits: snapshot(null, null) } }),
  missing: () => ({ error: { code: -32601, message: "Method not found" } }),
  refused: () => ({ error: { code: -32600, message: "failed to fetch codex rate limits: 401 Unauthorized: refresh_token_reused" } }),
  leak: () => ({ error: { code: -32600, message: `401 Unauthorized, token ${auth().tokens.refresh_token} was rejected` } }),
  // Codex renewed the login (a new refresh token for the same user), then OpenAI refused it.
  renewed: () => {
    const a = auth();
    a.tokens.refresh_token = `${a.tokens.refresh_token}-renewed`;
    fs.writeFileSync(authFile, JSON.stringify(a));
    return { error: { code: -32600, message: "401 Unauthorized" } };
  },
  // The file ends up holding another person's login.
  swapuser: () => {
    const a = auth();
    a.tokens.id_token = process.env.FAKE_OTHER_ID_TOKEN;
    fs.writeFileSync(authFile, JSON.stringify(a));
    return { error: { code: -32600, message: "boom" } };
  },
};

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  note({ method: m.method, params: m.params });
  if (m.method === "initialize") return process.stdout.write(`${JSON.stringify({ id: m.id, result: { userAgent: "fake", codexHome: home } })}\n`);
  if (m.method !== "account/rateLimits/read" || mode === "hang") return;
  process.stdout.write(`${JSON.stringify({ id: m.id, ...answers[mode]() })}\n`);
});
