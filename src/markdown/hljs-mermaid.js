/**
 * highlight.js grammar for Mermaid diagram source (editor fence highlighting).
 * Kept local because @highlightjs/cdn-assets does not ship a mermaid language.
 * Loaded on demand from app.js when a `mermaid` fence is present.
 *
 * Structure follows the per-diagram approach used by
 * https://github.com/bpruitt-goddard/vscode-mermaid-syntax-highlight
 * so brace/paren/bracket shapes are not treated as strings globally (that
 * broke ER, class, C4, and similar diagrams).
 *
 * @param {import("highlight.js").HLJSApi} hljs
 */
export default function hljsMermaid(hljs) {
  // Never-matching end so a diagram mode consumes the rest of the fence.
  const REST = /$^/;

  const COMMENT = hljs.COMMENT(/%%(?!\{)/, /$/);

  const DIRECTIVE = {
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
  };

  const FRONTMATTER = {
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
  };

  const QUOTED = {
    className: "string",
    begin: /"/,
    end: /"/,
    illegal: /\n/,
  };

  const EDGE_LABEL = {
    className: "string",
    begin: /\|(?![|}])/,
    end: /\|/,
    illegal: /\n/,
  };

  /** Identifier — no hyphens, so `Alice->>Bob` arrows stay intact. */
  const IDENT = {
    className: "variable",
    begin: /[A-Za-z_][\w]*/,
  };

  /** @param {string} words space-separated keywords */
  function keywords(words) {
    return {
      className: "keyword",
      begin: new RegExp(`\\b(?:${words.trim().split(/\s+/).join("|")})\\b`),
    };
  }

  /**
   * Keyword at line start; optional remainder of the line as a string
   * (titles, section names, axis labels, …).
   * Uses highlight.js multi-match scopes so indentation is not swallowed
   * into the string span.
   * @param {string} words
   * @param {{ restAsString?: boolean }} [opts]
   */
  function lineKeyword(words, { restAsString = false } = {}) {
    const alt = words.trim().split(/\s+/).join("|");
    if (!restAsString) {
      return {
        className: "keyword",
        begin: new RegExp(`^\\s*(?:${alt})\\b`, "m"),
      };
    }
    return {
      match: [
        /^\s*/m,
        new RegExp(`(?:${alt})\\b`),
        /\s+/,
        /.+$/,
      ],
      scope: {
        2: "keyword",
        4: "string",
      },
    };
  }

  const FLOW_ARROWS = {
    className: "built_in",
    variants: [
      { begin: /<-->/ },
      { begin: /x--x/ },
      { begin: /o--o/ },
      { begin: /==+>/ },
      { begin: /~~+/ },
      { begin: /--+>/ },
      { begin: /==+/ },
      { begin: /-\.+->?/ },
      { begin: /--+/ },
    ],
  };

  const SEQ_ARROWS = {
    className: "built_in",
    variants: [
      { begin: /-->>/ },
      { begin: /->>/ },
      { begin: /--\)/ },
      { begin: /-\)/ },
      { begin: /->/ },
      { begin: /--x/ },
      { begin: /-x/ },
    ],
  };

  const ER_ARROWS = {
    className: "built_in",
    variants: [
      { begin: /\|\|--o\{/ },
      { begin: /\|\|--\|\{/ },
      { begin: /\|\|--\|\|/ },
      { begin: /\|\|--o\|/ },
      { begin: /\}o--o\{/ },
      { begin: /\}o--\|\{/ },
      { begin: /\}o--\|\|/ },
      { begin: /\}o--o\|/ },
      { begin: /\}\|--o\{/ },
      { begin: /\}\|--\|\{/ },
      { begin: /\}\|--\|\|/ },
      { begin: /\}\|--o\|/ },
      { begin: /\|o--o\{/ },
      { begin: /\|o--\|\{/ },
      { begin: /\|o--\|\|/ },
      { begin: /\|o--o\|/ },
      { begin: /\|\|\.\.o\{/ },
      { begin: /\|\|\.\.\|\{/ },
      { begin: /\|\|\.\.\|\|/ },
      { begin: /\|\|\.\.o\|/ },
      { begin: /\}o\.\.o\{/ },
      { begin: /\}o\.\.\|\{/ },
      { begin: /\}o\.\.\|\|/ },
      { begin: /\}o\.\.o\|/ },
      { begin: /\}\|\.\.o\{/ },
      { begin: /\}\|\.\.\|\{/ },
      { begin: /\}\|\.\.\|\|/ },
      { begin: /\}\|\.\.o\|/ },
      { begin: /\|o\.\.o\{/ },
      { begin: /\|o\.\.\|\{/ },
      { begin: /\|o\.\.\|\|/ },
      { begin: /\|o\.\.o\|/ },
    ],
  };

  const CLASS_ARROWS = {
    className: "built_in",
    variants: [
      { begin: /<\|--/ },
      { begin: /--\|>/ },
      { begin: /<\|\.\./ },
      { begin: /\.\.\|>/ },
      { begin: /<--/ },
      // `-->` plus HTML comment-end quirk `--!>` (CodeQL js/bad-tag-filter).
      { begin: /--!?>/ },
      { begin: /<\.\./ },
      { begin: /\.\.>/ },
      { begin: /--\*/ },
      { begin: /\*--/ },
      { begin: /--o/ },
      { begin: /o--/ },
      { begin: /--/ },
      { begin: /\.\./ },
    ],
  };

  /**
   * Flowchart / graph node label shapes after an id.
   * Uses a closed multi-match (not begin/returnBegin without end) so the mode
   * cannot stay open and reclassify later keywords as variables.
   */
  const NODE_SHAPE = {
    match: [
      /[A-Za-z_][\w-]*/,
      /\s*/,
      /(?:\[\/[^\]\n]*\/\]|\[\([^\]\n]*\)\]|\[\[[^\]\n]*\]\]|\[\*[^\]]*?\*\]|\[[^\]\n]*\]|\(\[[^\]\n]*\]\)|\(\([^)\n]*\)\)|\([^)\n]*\)|\{\{[^}\n]*\}\}|\{[^}\n]*\}|>[^\]\n]*\])/,
    ],
    scope: {
      1: "variable",
      3: "string",
    },
  };

  const COLON_STRING = {
    className: "string",
    begin: /:\s*/,
    end: /$/,
    excludeBegin: true,
    relevance: 0,
  };

  /**
   * @param {RegExp} begin
   * @param {object[]} contains
   */
  function diagram(begin, contains) {
    return {
      begin,
      end: REST,
      returnBegin: true,
      relevance: 10,
      contains: [
        { className: "keyword", begin },
        COMMENT,
        DIRECTIVE,
        QUOTED,
        ...contains,
      ],
    };
  }

  const FLOWCHART = diagram(/^\s*(?:flowchart|graph)\b/, [
    // Keywords before NODE_SHAPE / IDENT so `subgraph` is not treated as a node id.
    keywords(
      "subgraph end direction LR RL TB BT TD classDef class click style linkStyle"
    ),
    EDGE_LABEL,
    FLOW_ARROWS,
    NODE_SHAPE,
    IDENT,
  ]);

  const SEQUENCE = diagram(/^\s*sequenceDiagram\b/, [
    {
      begin: /^\s*(?:participant|actor)\b/m,
      returnBegin: true,
      end: /$/,
      contains: [
        { className: "keyword", begin: /(?:participant|actor)\b/ },
        { className: "keyword", begin: /\bas\b/ },
        QUOTED,
        IDENT,
      ],
    },
    {
      begin: /^\s*Note\b/m,
      returnBegin: true,
      end: /$/,
      contains: [
        { className: "keyword", begin: /Note\b/ },
        { className: "keyword", begin: /\b(?:left of|right of|over)\b/ },
        COLON_STRING,
        IDENT,
      ],
    },
    keywords(
      "loop alt else opt par and critical break rect activate deactivate autonumber box end"
    ),
    SEQ_ARROWS,
    COLON_STRING,
    IDENT,
  ]);

  const CLASS_DIAGRAM = diagram(/^\s*classDiagram(?:-v2)?\b/, [
    {
      begin: /^\s*(?:class|namespace)\b/m,
      returnBegin: true,
      end: /\{|$/,
      contains: [
        { className: "keyword", begin: /(?:class|namespace)\b/ },
        { className: "title class_", begin: /`[^`]+`|[A-Za-z_][\w.]*/ },
      ],
    },
    keywords("note for direction"),
    CLASS_ARROWS,
    { className: "keyword", begin: /<<\s*[\w-]+\s*>>/ },
    { className: "keyword", begin: /[+\-~#](?=[\w[(])/ },
    {
      className: "type",
      begin: /\b(?:String|int|bool|boolean|float|double|void|List|Map|Set)\b/,
    },
    IDENT,
  ]);

  const STATE = diagram(/^\s*stateDiagram(?:-v2)?\b/, [
    {
      begin: /^\s*state\b/m,
      returnBegin: true,
      end: /$/,
      contains: [
        { className: "keyword", begin: /\bstate\b/ },
        { className: "keyword", begin: /\bas\b/ },
        { className: "keyword", begin: /<<(?:fork|join|choice)>>/ },
        QUOTED,
        IDENT,
        { className: "keyword", begin: /\{/ },
      ],
    },
    keywords("direction LR RL TB BT note left right of end"),
    { className: "keyword", begin: /\[\*\]/ },
    FLOW_ARROWS,
    COLON_STRING,
    IDENT,
  ]);

  const ER = diagram(/^\s*erDiagram\b/, [
    ER_ARROWS,
    {
      begin: /\{/,
      end: /\}/,
      contains: [
        COMMENT,
        QUOTED,
        { className: "keyword", begin: /\b(?:PK|FK|UK)\b/ },
        {
          className: "type",
          begin:
            /\b(?:int|integer|bigint|float|double|decimal|string|varchar|text|bool|boolean|date|datetime|timestamp|blob|json)\b/i,
        },
        IDENT,
      ],
    },
    COLON_STRING,
    IDENT,
  ]);

  const GANTT = diagram(/^\s*gantt\b/, [
    lineKeyword("title section", { restAsString: true }),
    lineKeyword(
      "dateFormat axisFormat excludes includes todayMarker tickInterval",
      { restAsString: true }
    ),
    keywords("crit done active after milestone"),
    {
      begin: /:\s*/,
      end: /$/,
      excludeBegin: true,
      contains: [
        keywords("crit done active after milestone"),
        {
          className: "number",
          begin: /\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:[.:]\d+)?[dwmyh]?\b/,
        },
        { className: "string", begin: /[A-Za-z_][\w-]*/ },
      ],
    },
  ]);

  const PIE = diagram(/^\s*pie\b/, [
    keywords("showData"),
    {
      match: [/\btitle\b/, /\s+/, /.+/],
      scope: {
        1: "keyword",
        3: "string",
      },
    },
    {
      begin: /^\s*"/m,
      end: /$/,
      returnBegin: true,
      contains: [
        QUOTED,
        { className: "keyword", begin: /:/ },
        { className: "number", begin: /\b\d+(?:\.\d+)?\b/ },
      ],
    },
    { className: "number", begin: /\b\d+(?:\.\d+)?\b/ },
  ]);

  const GIT = diagram(/^\s*gitGraph\b/, [
    {
      begin: /^\s*(?:commit|branch|checkout|merge|cherry-pick)\b/m,
      returnBegin: true,
      end: /$/,
      contains: [
        {
          className: "keyword",
          begin: /(?:commit|branch|checkout|merge|cherry-pick)\b/,
        },
        { className: "keyword", begin: /\b(?:id|type|tag|order)\b/ },
        {
          className: "built_in",
          begin: /\b(?:NORMAL|REVERSE|HIGHLIGHT)\b/,
        },
        QUOTED,
        { className: "number", begin: /\b\d+\b/ },
        IDENT,
      ],
    },
  ]);

  const JOURNEY = diagram(/^\s*journey\b/, [
    lineKeyword("title section", { restAsString: true }),
    {
      begin: /:\s*\d+\s*:/,
      returnBegin: true,
      end: /$/,
      contains: [
        { className: "keyword", begin: /:/ },
        { className: "number", begin: /\b\d+\b/ },
        { className: "variable", begin: /[^,#\n]+/ },
      ],
    },
  ]);

  const MINDMAP = diagram(/^\s*mindmap\b/, [
    { className: "keyword", begin: /::(?::|icon\b)?/ },
    NODE_SHAPE,
  ]);

  const QUADRANT = diagram(/^\s*quadrantChart\b/, [
    lineKeyword(
      "title x-axis y-axis quadrant-1 quadrant-2 quadrant-3 quadrant-4",
      { restAsString: true }
    ),
    { className: "number", begin: /\b\d+(?:\.\d+)?\b/ },
  ]);

  const TIMELINE = diagram(/^\s*timeline\b/, [
    lineKeyword("title section", { restAsString: true }),
  ]);

  const REQUIREMENT = diagram(/^\s*requirementDiagram\b/, [
    keywords(
      "requirement functionalRequirement interfaceRequirement performanceRequirement physicalRequirement designConstraint element id text risk verifymethod type docRef contains copies derives satisfies verifies refines traces"
    ),
  ]);

  const C4 = diagram(
    /^\s*(?:C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/,
    [
      lineKeyword(
        "title UpdateElementStyle UpdateRelStyle AddElementTag UpdateLayoutConfig SHOW_LEGEND HIDE_STEREOTYPE LAYOUT_TOP_DOWN LAYOUT_LEFT_RIGHT LAYOUT_LANDSCAPE LAYOUT_WITH_LEGEND"
      ),
      {
        className: "keyword",
        begin:
          /\b(?:Person_Ext|Person|SystemDb_Ext|SystemQueue_Ext|System_Ext|SystemDb|SystemQueue|System|ContainerDb_Ext|ContainerQueue_Ext|Container_Ext|ContainerDb|ContainerQueue|Container|ComponentDb_Ext|ComponentQueue_Ext|Component_Ext|ComponentDb|ComponentQueue|Component|Boundary|Enterprise_Boundary|System_Boundary|Container_Boundary|Deployment_Node|Node_L|Node_R|Node|Rel_U|Rel_D|Rel_L|Rel_R|Rel_Up|Rel_Down|Rel_Left|Rel_Right|BiRel|Rel)\b/,
      },
      IDENT,
    ]
  );

  const ARCHITECTURE = diagram(/^\s*architecture(?:-beta)?\b/, [
    keywords("group service junction db cloud disk queue"),
    FLOW_ARROWS,
  ]);

  const SANKEY = diagram(/^\s*sankey-beta\b/, [
    { className: "number", begin: /\b\d+(?:\.\d+)?\b/ },
  ]);

  const XYCHART = diagram(/^\s*xychart(?:-beta)?\b/, [
    lineKeyword("title x-axis y-axis line bar", { restAsString: true }),
    { className: "number", begin: /\b-?\d+(?:\.\d+)?\b/ },
  ]);

  const BLOCK = diagram(/^\s*block(?:-beta)?\b/, [
    keywords("columns space"),
    FLOW_ARROWS,
    NODE_SHAPE,
  ]);

  const KANBAN = diagram(/^\s*kanban\b/, []);

  const PACKET = diagram(/^\s*packet(?:-beta)?\b/, [
    { className: "number", begin: /\b\d+\b/ },
  ]);

  return {
    name: "Mermaid",
    aliases: ["mermaid"],
    // Mermaid diagram/keywords are case-sensitive; insensitive matching made
    // ordinary title words (e.g. "Section", "Gantt") look like keywords.
    case_insensitive: false,
    contains: [
      COMMENT,
      DIRECTIVE,
      FRONTMATTER,
      FLOWCHART,
      SEQUENCE,
      CLASS_DIAGRAM,
      STATE,
      ER,
      GANTT,
      PIE,
      GIT,
      JOURNEY,
      MINDMAP,
      QUADRANT,
      TIMELINE,
      REQUIREMENT,
      C4,
      ARCHITECTURE,
      SANKEY,
      XYCHART,
      BLOCK,
      KANBAN,
      PACKET,
      QUOTED,
    ],
  };
}
