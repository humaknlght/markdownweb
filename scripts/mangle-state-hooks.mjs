/**
 * Production esbuild plugin to keep the split app's eager bundle near the
 * pre-split monolith size:
 *
 * 1. Rewrite `hooks.fn` call sites to direct ESM imports so minifier can
 *    collapse cross-module calls to single-character bindings.
 * 2. Mangle shared `state.*` property names (object keys + member access).
 * 3. Drop `export` on bindings that only existed for the hooks bag.
 *
 * Dev (`npm run dev`) serves unmangled modules for readable debugging.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const RESERVED = new Set([
  "as",
  "do",
  "if",
  "in",
  "is",
  "of",
  "on",
  "or",
  "to",
  "var",
  "let",
  "new",
  "try",
  "for",
  "int",
  "naN",
  "NaN",
  "get",
  "set",
  "void",
  "with",
  "enum",
  "true",
  "byte",
  "char",
  "else",
  "case",
  "eval",
  "null",
  "this",
  "long",
  "void",
  "goto",
  "await",
  "break",
  "catch",
  "class",
  "const",
  "false",
  "super",
  "throw",
  "while",
  "yield",
  "delete",
  "export",
  "import",
  "return",
  "switch",
  "static",
  "public",
  "typeof",
  "finally",
  "extends",
  "default",
  "continue",
  "function",
  "debugger",
  "arguments",
  "undefined",
  "async",
  "from",
  "of",
]);

function shortName(index) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let n = index;
  let out = "";
  do {
    out = alphabet[n % alphabet.length] + out;
    n = Math.floor(n / alphabet.length) - 1;
  } while (n >= 0);
  if (RESERVED.has(out)) return shortName(index + 50);
  return out;
}

async function walkJs(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkJs(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

/**
 * Collect property names accessed as hooks.X / state.X across app modules,
 * plus top-level keys on the shared state object.
 * @param {string} appDir
 */
export async function collectStateHooksProps(appDir) {
  const files = await walkJs(appDir);
  const props = new Set();
  for (const file of files) {
    const src = await readFile(file, "utf8");
    for (const match of src.matchAll(/\b(?:hooks|state)\.([A-Za-z_$][\w$]*)/g)) {
      props.add(match[1]);
    }
  }
  const stateFile = path.join(appDir, "state.js");
  const stateSrc = await readFile(stateFile, "utf8");
  const stateBlock = stateSrc.match(/export const state = \{([\s\S]*?)\n\};/);
  if (stateBlock) {
    for (const match of stateBlock[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) {
      props.add(match[1]);
    }
  }
  // False positive from import paths like "./hooks.js" → hooks.js group
  props.delete("js");
  return props;
}

/**
 * @param {Iterable<string>} props
 * @returns {Map<string, string>}
 */
export function buildPropMangleMap(props) {
  const propSet = props instanceof Set ? props : new Set(props);
  const sorted = [...propSet].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const map = new Map();
  const used = new Set();
  let i = 0;
  for (const prop of sorted) {
    let name;
    do {
      name = shortName(i++);
    } while (RESERVED.has(name) || used.has(name) || (propSet.has(name) && name !== prop));
    used.add(name);
    map.set(prop, name);
  }
  return map;
}

/**
 * String/comment-aware rewrite of hooks.X / state.X and top-level state keys.
 * @param {string} src
 * @param {Map<string, string>} map
 * @param {{ mangleStateObjectKeys?: boolean }} [opts]
 */
export function mangleStateHooksSource(src, map, opts = {}) {
  if (!map.size) return src;
  const sorted = [...map.keys()].sort((a, b) => b.length - a.length);
  const propAlt = sorted.map(escapeRegExp).join("|");
  const memberRe = new RegExp(`\\b(hooks|state)\\.(${propAlt})\\b`, "g");

  let out = rewriteCode(src, (chunk) =>
    chunk
      .replace(memberRe, (_, root, prop) => `${root}.${map.get(prop)}`)
      // Shorten the shared bags themselves (hooks.a → h.a, state.b → s.b).
      .replace(/\bhooks\b/g, "h")
      .replace(/\bstate\b/g, "s")
  );

  if (opts.mangleStateObjectKeys) {
    const keyRe = new RegExp(`^([ \\t]*)(${propAlt})(\\s*:)`, "gm");
    out = out.replace(/export const s = \{[\s\S]*?\n\};/, (block) =>
      block.replace(keyRe, (full, indent, prop, colon) => {
        const short = map.get(prop);
        return short ? `${indent}${short}${colon}` : full;
      })
    );
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply `transform` only to code regions (not strings/comments/templates' static parts).
 * Template `${}` expressions are transformed.
 * @param {string} src
 * @param {(code: string) => string} transform
 */
function rewriteCode(src, transform) {
  let i = 0;
  let codeStart = 0;
  let out = "";

  function emitCodeUpTo(end) {
    if (codeStart < end) out += transform(src.slice(codeStart, end));
    codeStart = end;
    i = end;
  }

  function emitRawSlice(from, to) {
    out += src.slice(from, to);
    codeStart = to;
    i = to;
  }

  function skipString(q) {
    const start = i;
    i++;
    while (i < src.length) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === q) {
        i++;
        break;
      }
      i++;
    }
    emitRawSlice(start, i);
  }

  function skipLineComment() {
    const start = i;
    i += 2;
    while (i < src.length && src[i] !== "\n") i++;
    emitRawSlice(start, i);
  }

  function skipBlockComment() {
    const start = i;
    i += 2;
    while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
    i = Math.min(i + 2, src.length);
    emitRawSlice(start, i);
  }

  function skipRegex() {
    const start = i;
    i++;
    while (i < src.length) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === "[") {
        i++;
        while (i < src.length && src[i] !== "]") {
          if (src[i] === "\\") {
            i += 2;
            continue;
          }
          i++;
        }
        i++;
        continue;
      }
      if (src[i] === "/") {
        i++;
        break;
      }
      i++;
    }
    while (i < src.length && /[gimsuy]/.test(src[i])) i++;
    emitRawSlice(start, i);
  }

  function skipTemplate() {
    // Emit static parts raw; transform ${} expressions.
    emitCodeUpTo(i);
    out += "`";
    i++;
    let staticStart = i;
    while (i < src.length) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === "$" && src[i + 1] === "{") {
        out += src.slice(staticStart, i);
        out += "${";
        i += 2;
        const exprStart = i;
        let depth = 1;
        while (i < src.length && depth > 0) {
          const c = src[i];
          const n = src[i + 1];
          if (c === "/" && n === "/") {
            while (i < src.length && src[i] !== "\n") i++;
            continue;
          }
          if (c === "/" && n === "*") {
            i += 2;
            while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
            i += 2;
            continue;
          }
          if (c === "'" || c === '"') {
            const q = c;
            i++;
            while (i < src.length) {
              if (src[i] === "\\") {
                i += 2;
                continue;
              }
              if (src[i] === q) {
                i++;
                break;
              }
              i++;
            }
            continue;
          }
          if (c === "`") {
            // Nested template — copy raw through matching close
            i++;
            while (i < src.length) {
              if (src[i] === "\\") {
                i += 2;
                continue;
              }
              if (src[i] === "$" && src[i + 1] === "{") {
                i += 2;
                let d = 1;
                while (i < src.length && d > 0) {
                  if (src[i] === "{") d++;
                  else if (src[i] === "}") d--;
                  i++;
                }
                continue;
              }
              if (src[i] === "`") {
                i++;
                break;
              }
              i++;
            }
            continue;
          }
          if (c === "{") {
            depth++;
            i++;
            continue;
          }
          if (c === "}") {
            depth--;
            i++;
            continue;
          }
          i++;
        }
        out += transform(src.slice(exprStart, i - 1));
        out += "}";
        staticStart = i;
        continue;
      }
      if (src[i] === "`") {
        out += src.slice(staticStart, i);
        out += "`";
        i++;
        codeStart = i;
        return;
      }
      i++;
    }
    out += src.slice(staticStart, i);
    codeStart = i;
  }

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      emitCodeUpTo(i);
      skipLineComment();
      continue;
    }
    if (c === "/" && n === "*") {
      emitCodeUpTo(i);
      skipBlockComment();
      continue;
    }
    if (c === "'" || c === '"') {
      emitCodeUpTo(i);
      skipString(c);
      continue;
    }
    if (c === "`") {
      skipTemplate();
      continue;
    }
    if (c === "/") {
      // Use pending source (not `out`) — code regions are flushed lazily.
      const prevCode = src.slice(codeStart, i).replace(/\s+$/, "");
      const prevCh = prevCode.slice(-1);
      if (
        !prevCh ||
        /[=(:,!&|?{};~+\-*%^<>\[]/.test(prevCh) ||
        /\b(?:return|case|throw|in|of|typeof|delete|void|new)$/.test(prevCode.slice(-8))
      ) {
        emitCodeUpTo(i);
        skipRegex();
        continue;
      }
    }
    i++;
  }
  emitCodeUpTo(src.length);
  return out;
}

/**
 * Names imported as bindings from other app modules (must keep `export`).
 * @param {string} appDir
 */
export async function collectImportedExportNames(appDir) {
  const files = await walkJs(appDir);
  const imported = new Set();
  for (const file of files) {
    const src = await readFile(file, "utf8");
    for (const match of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g)) {
      for (const part of match[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) imported.add(name);
      }
    }
  }
  return imported;
}

/**
 * Drop `export` on functions/consts that nothing imports by name so the bundler
 * can minify their identifiers (call sites go through mangled `hooks.*`).
 * @param {string} src
 * @param {Set<string>} keepExport
 */
export function stripUnreferencedExports(src, keepExport) {
  return src
    .replace(
      /^export (async function|function) (\w+)/gm,
      (full, kind, name) => (keepExport.has(name) ? full : `${kind} ${name}`)
    )
    .replace(
      /^export (const|let) (\w+)(\s*=)/gm,
      (full, kind, name, eq) => (keepExport.has(name) ? full : `${kind} ${name}${eq}`)
    );
}

/**
 * Map hooks.NAME = localName registrations to their defining files.
 * @param {string} appDir
 * @returns {Promise<Map<string, { file: string, localName: string }>>}
 */
export async function collectHooksRegistry(appDir) {
  const files = await walkJs(appDir);
  /** @type {Map<string, { file: string, localName: string }>} */
  const registry = new Map();
  for (const file of files) {
    const src = await readFile(file, "utf8");
    for (const match of src.matchAll(
      /^hooks\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/gm
    )) {
      registry.set(match[1], { file, localName: match[2] });
    }
  }
  return registry;
}

/**
 * Rewrite hooks.X call sites to direct bindings + imports; drop hooks.X = X.
 * Leaves state.* mangling to a later pass. Returns names that must stay exported.
 * @param {string} file
 * @param {string} src
 * @param {Map<string, { file: string, localName: string }>} registry
 * @param {string} appDir
 */
export function rewriteHooksToDirectImports(file, src, registry, appDir) {
  const needed = new Map(); // localName -> defining file
  for (const [hookName, def] of registry) {
    const re = new RegExp(`\\bhooks\\.${hookName}\\b`);
    if (!re.test(src)) continue;
    needed.set(hookName, def);
  }

  let out = src;
  // Remove registration lines in the defining file.
  out = out.replace(
    /^hooks\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;\s*\n?/gm,
    (full, hookName, localName) => {
      const def = registry.get(hookName);
      if (def && def.file === file && def.localName === localName) return "";
      return full;
    }
  );

  /** @type {Map<string, string>} hookName -> binding to use in this file */
  const bindingFor = new Map();
  const importFrom = new Map(); // defining file -> Set of localNames

  for (const [hookName, def] of needed) {
    if (def.file === file) {
      bindingFor.set(hookName, def.localName);
      continue;
    }
    bindingFor.set(hookName, def.localName);
    if (!importFrom.has(def.file)) importFrom.set(def.file, new Set());
    importFrom.get(def.file).add(def.localName);
  }

  // Replace hooks.NAME with the local binding (same-file or imported).
  for (const [hookName, binding] of bindingFor) {
    const re = new RegExp(`\\bhooks\\.${hookName}\\b`, "g");
    out = rewriteCode(out, (chunk) => chunk.replace(re, binding));
  }

  if (importFrom.size) {
    const importLines = [];
    for (const [defFile, names] of importFrom) {
      let rel = path.relative(path.dirname(file), defFile).replace(/\\/g, "/");
      if (!rel.startsWith(".")) rel = `./${rel}`;
      const list = [...names].sort().join(", ");
      importLines.push(`import { ${list} } from "${rel}";`);
    }
    // Insert after existing import block.
    const importBlock = out.match(/^(?:import\s+[^;]+;\s*\n)*/);
    const idx = importBlock ? importBlock[0].length : 0;
    out = out.slice(0, idx) + importLines.join("\n") + (importLines.length ? "\n" : "") + out.slice(idx);
  }

  return out;
}

/**
 * @param {string} appDir absolute path to src/app
 */
export async function createStateHooksManglePlugin(appDir) {
  const registry = await collectHooksRegistry(appDir);
  const stateProps = new Set();
  // State props only (hooks are de-virtualized below).
  for (const file of await walkJs(appDir)) {
    const src = await readFile(file, "utf8");
    for (const match of src.matchAll(/\bstate\.([A-Za-z_$][\w$]*)/g)) {
      stateProps.add(match[1]);
    }
  }
  const stateFile = path.join(appDir, "state.js");
  const stateSrc = await readFile(stateFile, "utf8");
  const stateBlock = stateSrc.match(/export const state = \{([\s\S]*?)\n\};/);
  if (stateBlock) {
    for (const match of stateBlock[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) {
      stateProps.add(match[1]);
    }
  }
  const map = buildPropMangleMap(stateProps);

  const keepExport = await collectImportedExportNames(appDir);
  keepExport.add("state");
  keepExport.add("hooks");
  // Everything reached via former hooks.* must stay exportable for injected imports.
  for (const { localName } of registry.values()) keepExport.add(localName);

  const appDirResolved = path.resolve(appDir);

  return {
    name: "mangle-state-hooks",
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, async (args) => {
        const file = path.resolve(args.path);
        if (!file.startsWith(appDirResolved + path.sep) && file !== appDirResolved) {
          return null;
        }
        let src = await readFile(file, "utf8");
        src = rewriteHooksToDirectImports(file, src, registry, appDirResolved);
        src = stripUnreferencedExports(src, keepExport);
        const isState = path.basename(file) === "state.js";
        const contents = mangleStateHooksSource(src, map, {
          mangleStateObjectKeys: isState,
        });
        return { contents, loader: "js" };
      });
    },
  };
}
