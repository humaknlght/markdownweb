import { hooks } from "../hooks.js";

export function normalizeMermaidSource(text) {
  const body = String(text ?? "").replace(/\n$/, "");
  if (!/^\s*gantt\b/im.test(body)) return body;
  return body
    .split("\n")
    .map((line) => line.replace(/(\S)[ \t]+:/, "$1:").replace(/[ \t]+$/g, ""))
    .join("\n");
}

hooks.normalizeMermaidSource = normalizeMermaidSource;
