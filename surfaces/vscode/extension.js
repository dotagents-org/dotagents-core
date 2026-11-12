// The dotagents VS Code extension (ADR 0012): the current Claude account and its usage in the
// status bar, a click to switch, and the panel (every account) in the side bar. Everything comes
// from `dotagents start` on the side the extension runs on (in WSL for a WSL window), found
// through <state>/start.json; the extension starts one, in the background, when none runs.
// Plain JavaScript, no build; `npm run package` copies the panel in and writes the .vsix.
"use strict";

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const lib = require("./lib.js");

const POLL_MS = 10_000;
const DAY = 24 * 60 * 60 * 1000;

let server = null;
let data = null;
let startedAt = 0;

// The running server, or null; with none, starts one at most once a minute.
function findServer() {
  server = lib.readServer(lib.stateDir());
  if (server) return server;
  if (Date.now() - startedAt > 60_000) {
    startedAt = Date.now();
    const child = spawn("dotagents", ["start"], { detached: true, stdio: "ignore", shell: process.platform === "win32", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  }
  return null;
}

async function api(method, route, body) {
  const s = findServer();
  if (!s) throw new Error("starting the dotagents server");
  const res = await fetch(`http://127.0.0.1:${s.port}${route}`, {
    method,
    headers: { "x-dotagents-token": s.token, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

// --- The panel in the side bar --------------------------------------------------------------
class PanelView {
  constructor(context) {
    this.context = context;
    this.view = null;
    // The .vsix carries a copy (media/panel); from the repository, the page itself.
    const packaged = vscode.Uri.joinPath(context.extensionUri, "media", "panel");
    this.root = fs.existsSync(packaged.fsPath) ? packaged : vscode.Uri.joinPath(context.extensionUri, "..", "web", "page");
  }

  resolveWebviewView(view) {
    this.view = view;
    const webview = view.webview;
    webview.options = { enableScripts: true, localResourceRoots: [this.root] };
    const file = (name) => webview.asWebviewUri(vscode.Uri.joinPath(this.root, name));
    const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src ${webview.cspSource};`;
    webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="${file("panel.css")}"></head><body><main id="panel" class="panel" aria-live="polite"></main><script src="${file("panel.js")}"></script></body></html>`;
    webview.onDidReceiveMessage(async (m) => {
      if (m.type === "ready") this.post();
      if (m.type === "action") {
        let result;
        try {
          const { ok, json } = await api("POST", `/api/${m.action}`, { profile: m.profile });
          result = { ok, detail: json.detail || "" };
        } catch (err) {
          result = { ok: false, detail: err.message };
        }
        webview.postMessage({ type: "result", id: m.id, result });
        refresh();
      }
    });
    view.onDidChangeVisibility(() => view.visible && this.post());
  }

  post() {
    if (!this.view) return;
    const avatars = `${this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.root, "avatars"))}/`;
    if (data) this.view.webview.postMessage({ type: "usage", data, avatars });
    else this.view.webview.postMessage({ type: "down", detail: "Waiting for the dotagents server..." });
  }
}

// --- The status bar -------------------------------------------------------------------------
let item;
let panel;

async function refresh() {
  try {
    const { ok, json } = await api("GET", "/api/usage");
    if (!ok) throw new Error("no answer");
    data = json;
    const status = lib.statusFor(data);
    item.text = status.text;
    const tip = new vscode.MarkdownString(status.tooltip);
    tip.appendMarkdown("\n\n---\n\nClick to switch account");
    item.tooltip = tip;
    item.backgroundColor = status.severity === "none" ? undefined : new vscode.ThemeColor(`statusBarItem.${status.severity}Background`);
  } catch {
    data = null;
    item.text = "$(account) dotagents";
    item.tooltip = "Starting the dotagents server...";
    item.backgroundColor = undefined;
  }
  panel.post();
}

async function switchAccount() {
  if (!data) return vscode.window.showWarningMessage("dotagents: the server isn't answering yet.");
  const pick = await vscode.window.showQuickPick(lib.pickItems(data), { placeHolder: "Switch the Claude account, on both sides" });
  if (!pick || pick.profile === data.current?.profile) return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `dotagents: switching to ${pick.profile}` }, async () => {
    try {
      const { ok, json } = await api("POST", "/api/switch", { profile: pick.profile });
      if (ok) vscode.window.showInformationMessage(`dotagents: ${json.detail || `now ${pick.profile}`}. Open conversations go on in the new account when you type continue.`);
      else vscode.window.showErrorMessage(`dotagents: ${json.detail || "the switch failed"}`);
    } catch (err) {
      vscode.window.showErrorMessage(`dotagents: ${err.message}`);
    }
  });
  refresh();
}

function openInBrowser() {
  const s = findServer();
  if (!s) return vscode.window.showWarningMessage("dotagents: the server isn't answering yet.");
  // asExternalUri reaches the server from the browser even when the window is a remote one (WSL).
  vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${s.port}/`)).then((uri) => vscode.env.openExternal(vscode.Uri.parse(`${uri.toString(true).replace(/\/?$/, "/")}#token=${s.token}`)));
}

// --- Updates: not on the Marketplace, so once a day it looks for a newer GitHub release --------
const RELEASES = "https://api.github.com/repos/gabrieldulolmarques/dotagents/releases/latest";

async function checkForUpdate(context) {
  const state = context.globalState;
  if (Date.now() - state.get("lastUpdateCheck", 0) < DAY) return;
  await state.update("lastUpdateCheck", Date.now());
  const res = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) return;
  const release = await res.json();
  const latest = String(release.tag_name).replace(/^v/, "");
  const current = context.extension.packageJSON.version;
  const asset = release.assets?.find((a) => a.name.endsWith(".vsix"));
  if (!asset || !lib.newer(latest, current) || state.get("ignoredVersion") === latest) return;
  const choice = await vscode.window.showInformationMessage(`dotagents ${latest} is available (you have ${current}).`, "Install", "Release notes", "Skip this version");
  if (choice === "Release notes") vscode.env.openExternal(vscode.Uri.parse(release.html_url));
  else if (choice === "Skip this version") await state.update("ignoredVersion", latest);
  else if (choice === "Install") {
    try {
      const vsix = await fetch(asset.browser_download_url);
      if (!vsix.ok) throw new Error(`download failed (${vsix.status})`);
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      const file = vscode.Uri.joinPath(context.globalStorageUri, asset.name);
      await vscode.workspace.fs.writeFile(file, new Uint8Array(await vsix.arrayBuffer()));
      await vscode.commands.executeCommand("workbench.extensions.installExtension", file);
      const reload = await vscode.window.showInformationMessage(`dotagents ${latest} is installed. Reload the window to use it. Update the command too: dotagents update`, "Reload");
      if (reload) vscode.commands.executeCommand("workbench.action.reloadWindow");
    } catch (err) {
      const open = await vscode.window.showErrorMessage(`Could not install dotagents ${latest}: ${err.message}`, "Open release");
      if (open) vscode.env.openExternal(vscode.Uri.parse(release.html_url));
    }
  }
}

function activate(context) {
  checkForUpdate(context).catch(() => {}); // offline or rate limited: try again tomorrow
  item = vscode.window.createStatusBarItem("dotagents.account", vscode.StatusBarAlignment.Right, 100);
  item.name = "dotagents account";
  item.command = "dotagents.switch";
  item.text = "$(account) dotagents";
  item.show();
  panel = new PanelView(context);
  const timer = setInterval(refresh, POLL_MS);
  context.subscriptions.push(
    item,
    { dispose: () => clearInterval(timer) },
    vscode.window.registerWebviewViewProvider("dotagents.panel", panel),
    vscode.commands.registerCommand("dotagents.switch", switchAccount),
    vscode.commands.registerCommand("dotagents.openInBrowser", openInBrowser)
  );
  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
