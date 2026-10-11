import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import hljsMermaid from "../../src/hljs-mermaid.js";

/** @type {import("highlight.js").HLJSApi} */
let hljs;

before(async () => {
  ({ default: hljs } = await import("highlight.js"));
  hljs.registerLanguage("mermaid", hljsMermaid);
});

function highlight(code) {
  return hljs.highlight(code, { language: "mermaid" }).value;
}

/** Strip tags but keep class names as ‹class›…‹/› markers. */
function marked(html) {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/<span class="([^"]+)">/g, "‹$1›")
    .replace(/<\/span>/g, "‹/›");
}

describe("hljs-mermaid grammar", () => {
  it("registers as Mermaid without case-insensitive matching", () => {
    const grammar = hljsMermaid(hljs);
    assert.equal(grammar.name, "Mermaid");
    assert.deepEqual(grammar.aliases, ["mermaid"]);
    assert.equal(grammar.case_insensitive, false);
  });

  it("highlights flowchart nodes, edges, and subgraphs", () => {
    const out = marked(highlight(`flowchart LR
  A[Start] --> B{OK?}
  B -->|Yes| C[Done]
  subgraph id [My Sub]
    D --> E
  end`));
    assert.match(out, /‹hljs-keyword›flowchart‹\/›/);
    assert.match(out, /‹hljs-string›\[Start\]‹\/›/);
    assert.match(out, /‹hljs-built_in›-->‹\/›/);
    assert.match(out, /‹hljs-string›\|Yes\|‹\/›/);
    assert.match(out, /‹hljs-keyword›subgraph‹\/›/);
    assert.match(out, /‹hljs-string›\[My Sub\]‹\/›/);
    assert.match(out, /‹hljs-keyword›end‹\/›/);
  });

  it("does not swallow ER attribute blocks as one string", () => {
    const out = marked(highlight(`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER {
    int orderId PK
    string name
  }`));
    assert.match(out, /‹hljs-built_in›\|\|--o\{‹\/›/);
    assert.match(out, /‹hljs-type›int‹\/›/);
    assert.match(out, /‹hljs-keyword›PK‹\/›/);
    assert.match(out, /‹hljs-type›string‹\/›/);
    // Regression: old grammar wrapped from `||--o{` through `}` as a string.
    assert.doesNotMatch(out, /‹hljs-string›\|\|/);
    assert.doesNotMatch(out, /‹hljs-string›\{[^‹]*orderId/);
  });

  it("highlights class members without stringifying the class body", () => {
    const out = marked(highlight(`classDiagram
  class Animal {
    +String name
    +eat()
  }
  Animal <|-- Duck`));
    assert.match(out, /‹hljs-keyword›class‹\/›/);
    assert.match(out, /‹hljs-title class_›Animal‹\/›/);
    assert.match(out, /‹hljs-type›String‹\/›/);
    assert.match(out, /‹hljs-built_in›<\|--‹\/›/);
    assert.doesNotMatch(out, /‹hljs-string›\{[^‹]*String name/);
  });

  it("highlights sequence arrows and Note directions", () => {
    const out = marked(highlight(`sequenceDiagram
  participant Alice
  Note right of Alice: Hello
  Alice->>Bob: Hi
  alt ok
    Bob-->>Alice: OK
  end`));
    assert.match(out, /‹hljs-keyword›participant‹\/›/);
    assert.match(out, /‹hljs-keyword›right of‹\/›/);
    assert.match(out, /‹hljs-built_in›->>‹\/›/);
    assert.match(out, /‹hljs-built_in›-->>‹\/›/);
    assert.match(out, /‹hljs-keyword›alt‹\/›/);
  });

  it("highlights C4 calls without treating parentheses as strings", () => {
    const out = marked(highlight(`C4Context
  Person(customer, "Customer", "A user")
  Rel(customer, sys, "Uses")`));
    assert.match(out, /‹hljs-keyword›Person‹\/›/);
    assert.match(out, /‹hljs-string›"Customer"‹\/›/);
    assert.match(out, /‹hljs-keyword›Rel‹\/›/);
    assert.doesNotMatch(out, /‹hljs-string›\(customer/);
  });

  it("highlights gitGraph commands", () => {
    const out = marked(highlight(`gitGraph
  commit
  branch develop
  checkout develop
  merge main`));
    assert.match(out, /‹hljs-keyword›commit‹\/›/);
    assert.match(out, /‹hljs-keyword›branch‹\/›/);
    assert.match(out, /‹hljs-keyword›checkout‹\/›/);
    assert.match(out, /‹hljs-keyword›merge‹\/›/);
  });

  it("does not keyword-highlight ordinary gantt title words", () => {
    const out = marked(highlight(`gantt
  title A Gantt Diagram
  section Section One
  Task :a1, 2014-01-01, 30d`));
    assert.match(out, /‹hljs-keyword›title‹\/›/);
    assert.match(out, /‹hljs-string›A Gantt Diagram‹\/›/);
    assert.match(out, /‹hljs-keyword›section‹\/›/);
    // "Gantt" / "Section" in titles must not become keywords (case_insensitive bug).
    assert.doesNotMatch(out, /‹hljs-keyword›Gantt‹\/›/);
    assert.doesNotMatch(out, /‹hljs-keyword›Section‹\/›/);
    assert.match(out, /‹hljs-number›2014-01-01‹\/›/);
  });

  it("highlights state diagram terminators and stereotypes", () => {
    const out = marked(highlight(`stateDiagram-v2
  [*] --> Still
  state fork_state <<fork>>
  Still --> [*]`));
    assert.match(out, /‹hljs-keyword›\[\*\]‹\/›/);
    assert.match(out, /‹hljs-keyword›state‹\/›/);
    assert.match(out, /‹hljs-keyword›<<fork>>‹\/›/);
  });
});
