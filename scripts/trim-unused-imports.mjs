#!/usr/bin/env node
/**
 * Remove unused named/default/namespace bindings from existing import declarations.
 * Does not rewrite import paths or merge imports into vendor-deps bags.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Split app modules only — lib/markdown use imports referenced from JSDoc. */
const targetRoots = [path.join(repoRoot, "src/app")];

const dryRun = process.argv.includes("--dry-run");

async function walkJs(dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walkJs(abs)));
    else if (ent.name.endsWith(".js")) out.push(abs);
  }
  return out;
}

function usedIdents(code) {
  const set = new Set();
  for (const m of code.matchAll(/@type\s+\{[^}]*\btypeof\s+(\w+)/g)) {
    set.add(m[1]);
  }
  const cleaned = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
  const re = /\b([A-Za-z_$][\w$]*)\b/g;
  let m;
  while ((m = re.exec(cleaned))) set.add(m[1]);
  return set;
}

/**
 * @param {string} text
 * @returns {{ imports: string, body: string }}
 */
function splitImports(text) {
  const lines = text.split("\n");
  let i = 0;
  /** @type {string[]} */
  const importLines = [];
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" && importLines.length === 0) {
      i++;
      continue;
    }
    if (trimmed.startsWith("import ")) {
      importLines.push(line);
      while (!importLines[importLines.length - 1].includes(";") && i + 1 < lines.length) {
        i++;
        importLines.push(lines[i]);
      }
      i++;
      continue;
    }
    if (trimmed === "" && importLines.length > 0) {
      importLines.push(line);
      i++;
      continue;
    }
    break;
  }
  return {
    imports: importLines.join("\n"),
    body: lines.slice(i).join("\n"),
  };
}

/**
 * @param {string} importBlock
 * @param {Set<string>} used
 * @returns {{ text: string, changed: boolean }}
 */
function trimImportBlock(importBlock, used) {
  if (!importBlock.trim()) return { text: importBlock, changed: false };

  /** @type {string[]} */
  const out = [];
  let changed = false;
  const stmts = importBlock.split(/(?<=;)\n/);
  for (let raw of stmts) {
    const stmt = raw.trim();
    if (!stmt) continue;

    const sideEffect = /^import\s+["']([^"']+)["']\s*;?$/.exec(stmt);
    if (sideEffect) {
      out.push(raw.endsWith("\n") ? raw.trimEnd() : stmt);
      continue;
    }

    const ns = /^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']\s*;?$/.exec(
      stmt.replace(/\s+/g, " "),
    );
    if (ns) {
      if (used.has(ns[1])) out.push(stmt);
      else changed = true;
      continue;
    }

    const def = /^import\s+(\w+)\s+from\s+["']([^"']+)["']\s*;?$/.exec(
      stmt.replace(/\s+/g, " "),
    );
    if (def) {
      if (used.has(def[1])) out.push(stmt);
      else changed = true;
      continue;
    }

    const namedMatch = stmt.match(
      /^import\s+\{([\s\S]*)\}\s+from\s+["']([^"']+)["']\s*;?\s*$/,
    );
    if (!namedMatch) {
      out.push(stmt);
      continue;
    }

    const specSource = namedMatch[1];
    const specs = specSource
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    /** @type {string[]} */
    const kept = [];
    for (const spec of specs) {
      const parts = spec.split(/\s+as\s+/);
      const local = (parts[1] || parts[0]).trim();
      if (used.has(local)) kept.push(spec);
      else changed = true;
    }
    if (kept.length === 0) continue;
    const mod = namedMatch[2];
    if (kept.length === 1 && !kept[0].includes("\n")) {
      out.push(`import { ${kept[0]} } from "${mod}";`);
    } else {
      out.push(`import {\n  ${kept.join(",\n  ")}\n} from "${mod}";`);
    }
  }

  const text = out.join("\n");
  return { text, changed };
}

async function trimFile(absPath) {
  const original = await fs.readFile(absPath, "utf8");
  const { imports, body } = splitImports(original);
  if (!imports.trim()) return false;

  const used = usedIdents(body);
  const { text: trimmedImports, changed } = trimImportBlock(imports, used);
  if (!changed) return false;

  const trimmed = trimmedImports.trim()
    ? `${trimmedImports.trimEnd()}\n\n${body.replace(/^\n+/, "")}`
    : body.replace(/^\n+/, "");
  const normalized = trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  if (!dryRun) await fs.writeFile(absPath, normalized, "utf8");
  return true;
}

async function main() {
  let touched = 0;
  for (const root of targetRoots) {
    for (const file of await walkJs(root)) {
      if (await trimFile(file)) {
        touched++;
        console.log(path.relative(repoRoot, file));
      }
    }
  }
  console.log(`${dryRun ? "Would trim" : "Trimmed"} ${touched} file(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
