/**
 * highlight.js grammar for Mermaid diagram source (editor fence highlighting).
 * Kept local because @highlightjs/cdn-assets does not ship a mermaid language.
 *
 * @param {import("highlight.js").HLJSApi} hljs
 */
export default function hljsMermaid(hljs) {
  const DIAGRAM =
    "flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|" +
    "erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|" +
    "sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|" +
    "C4Context|C4Container|C4Component|C4Dynamic|C4Deployment";

  const KEYWORD =
    "participant|actor|boundary|control|entity|database|collections|queue|" +
    "Note|note|loop|alt|else|opt|par|and|critical|break|rect|activate|deactivate|" +
    "title|section|dateFormat|axisFormat|excludes|includes|todayMarker|" +
    "classDef|class|click|style|linkStyle|subgraph|end|direction|" +
    "state|fork|join|choice|link|callback|type|As|" +
    "autonumber|box|over|left|right|of|LR|RL|TB|BT|TD";

  return {
    name: "Mermaid",
    aliases: ["mermaid"],
    case_insensitive: true,
    contains: [
      // Line comments: %% … (but not %%{init}%% directives)
      hljs.COMMENT(/%%(?!\{)/, /$/),
      {
        className: "meta",
        begin: /%%\{/,
        end: /\}%%/,
        relevance: 10,
        contains: [
          { className: "attr", begin: /[A-Za-z][\w-]*(?=\s*:)/ },
          {
            className: "string",
            begin: /:\s*/,
            end: /(?=[,}]|\}%%)/,
            excludeBegin: true,
          },
        ],
      },
      {
        className: "meta",
        begin: /^---\s*$/,
        end: /^---\s*$/,
        relevance: 10,
        contains: [
          { className: "attr", begin: /^\s*[\w-]+(?=\s*:)/ },
          {
            className: "string",
            begin: /:\s*/,
            end: /$/,
            excludeBegin: true,
          },
        ],
      },
      {
        className: "keyword",
        begin: new RegExp(`\\b(?:${DIAGRAM})\\b`),
        relevance: 10,
      },
      {
        className: "keyword",
        begin: new RegExp(`\\b(?:${KEYWORD})\\b`),
      },
      {
        className: "built_in",
        begin:
          /-->>?|<<-->>?|-->|---|-\.-|==+>|==+|~~+|<-+>|x--x|o--o|<-->|<\|--|--\|>|\*--|o\{--|\}o--|o--|\.?-\.?->?/,
      },
      {
        className: "string",
        variants: [
          { begin: /"[^"\n]*"/ },
          { begin: /\|[^|\n]*\|/ },
          { begin: /\[[^\]]*\]/ },
          { begin: /\(\([^)]*\)\)/ },
          { begin: /\([^)]*\)/ },
          { begin: /\{\{[^}]*\}\}/ },
          { begin: /\{[^}]*\}/ },
          { begin: />[^<\n]+</ },
        ],
      },
      {
        className: "number",
        begin: /\b\d+(?:[.:]\d+)?\b/,
      },
    ],
  };
}
