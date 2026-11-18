// The layers: core/ holds the data and the actions and draws nothing; each folder under surfaces/
// uses core/ and never another surface. cli.ts, at the root, is the only place that picks one.

import assert from "node:assert/strict";
import ts from "@typescript/typescript6"; // TypeScript 7 has no stable compiler API until 7.1
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.ts";

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? sources(full) : e.name.endsWith(".ts") ? [full] : [];
  });
}

// Parse source so comments, strings and type-only imports cannot invent dependencies.
function imports(file: string, runtime = false) {
  const source = fs.readFileSync(file, "utf8");
  const text = runtime ? ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, verbatimModuleSyntax: true },
  }).outputText : source;
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specs.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return specs.filter((spec) => spec.startsWith(".")).map((spec) => path.relative(REPO, path.resolve(path.dirname(file), spec)).split(path.sep).join("/"));
}

// "surfaces/cli/usage.ts" → "cli"; null outside surfaces/.
const surfaceOf = (rel: string) => (rel.startsWith("surfaces/") ? rel.split("/")[1] : null);

test("core never imports a surface", () => {
  const wrong = sources(path.join(REPO, "core")).flatMap((f) => imports(f).filter((i) => i.startsWith("surfaces/")).map((i) => `${path.relative(REPO, f)} → ${i}`));
  assert.deepEqual(wrong, []);
});

test("a surface never imports another surface", () => {
  const wrong = sources(path.join(REPO, "surfaces")).flatMap((f) => {
    const own = surfaceOf(path.relative(REPO, f).split(path.sep).join("/"));
    return imports(f).filter((i) => surfaceOf(i) && surfaceOf(i) !== own).map((i) => `${path.relative(REPO, f)} → ${i}`);
  });
  assert.deepEqual(wrong, []);
});

// Outside core/accounts/, a provider is reached through core/accounts/providers.ts, never its own files.
// core/sessions.ts reads Claude Code's transcripts and sits under the spend, below providers.ts, so it reads
// Claude's store directly: going through providers.ts would close a cycle.
test("only core/accounts imports a provider's files", () => {
  const wrong = [path.join(REPO, "cli.ts"), ...sources(path.join(REPO, "core")), ...sources(path.join(REPO, "surfaces"))].flatMap((f) => {
    const rel = path.relative(REPO, f).split(path.sep).join("/");
    if (rel.startsWith("core/accounts/")) return [];
    return imports(f).filter((i) => i.startsWith("core/accounts/providers/") && !(rel === "core/sessions.ts" && i === "core/accounts/providers/claude-store.ts")).map((i) => `${rel} → ${i}`);
  });
  assert.deepEqual(wrong, []);
});

// Type-only imports disappear before execution and cannot form a runtime cycle.
test("core has no runtime import cycles", () => {
  const graph = new Map(sources(path.join(REPO, "core")).map((file) => {
    const specs = imports(file, true).map((rel) => path.join(REPO, rel));
    return [file, specs] as const;
  }));
  const seen = new Set<string>();
  const active: string[] = [];
  const visit = (file: string) => {
    assert.ok(!active.includes(file), `runtime cycle: ${[...active, file].map((f) => path.relative(REPO, f)).join(" → ")}`);
    if (seen.has(file)) return;
    active.push(file);
    for (const imported of graph.get(file) ?? []) if (graph.has(imported)) visit(imported);
    active.pop();
    seen.add(file);
  };
  for (const file of graph.keys()) visit(file);
});

// IDs in state validation and Claude-only features are contracts, not account dispatch.
test("account behavior is selected through provider adapters", () => {
  const wrong: string[] = [];
  for (const file of [path.join(REPO, "cli.ts"), ...sources(path.join(REPO, "core")), ...sources(path.join(REPO, "surfaces"))]) {
    const rel = path.relative(REPO, file).split(path.sep).join("/");
    if (rel.startsWith("core/accounts/providers/") || rel === "core/accounts/providers.ts" || rel === "core/machine-state.ts") continue;
    const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
        for (const [value, id] of [[node.left, node.right], [node.right, node.left]]) {
          if (!ts.isStringLiteral(id) || !["claude", "codex"].includes(id.text)) continue;
          // Profile creation validates the public provider argument before dispatching.
          if (rel === "core/accounts/profiles.ts" && ts.isIdentifier(value) && value.text === "provider") continue;
          if ((ts.isPropertyAccessExpression(value) && value.name.text === "provider") || (ts.isCallExpression(value) && value.expression.getText(ast) === "providerOf")) {
            wrong.push(`${rel}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(wrong, []);
});
