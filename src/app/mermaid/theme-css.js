import { hooks } from "../hooks.js";

export const MERMAID_THEME_CSS = `
  .node rect,.node circle,.node polygon,.node path,.node ellipse {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .cluster rect,.cluster polygon {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }
  /* Mermaid sequence "gap" backgrounds (pastels) — restyle to theme surfaces. */
  rect.rect {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: none !important;
  }
  .edgePath .path,.flowchart-link,path.flowchart-link,.edge.thickness-normal {
    stroke: var(--mermaid-line) !important;
  }
  .edgeLabel rect,.labelBkg,.edgeLabel .labelBkg {
    fill: var(--mermaid-label-bg) !important;
  }
  /* Flowchart edge labels (Yes/No) render in foreignObject HTML — Mermaid's
     default yellow (#ffffde) is a CSS background on .labelBkg, span.edgeLabel,
     AND the inner p, not an SVG fill. Prefer background-color only: Mermaid's
     themeCSS serializer expands the background shorthand into broken longhands. */
  .labelBkg,
  span.edgeLabel,
  .edgeLabel .labelBkg,
  .edgeLabel p,
  .edgeLabel span {
    background-color: var(--mermaid-label-bg) !important;
  }
  .nodeLabel,.edgeLabel,.label,.cluster-label,.cluster span,.node .label,
  .edgeLabel foreignObject div,.nodeLabel foreignObject div,
  .edgeLabel foreignObject p,.edgeLabel foreignObject span {
    color: var(--mermaid-fg) !important;
    fill: var(--mermaid-fg) !important;
  }
  text,tspan,.nodeLabel,.edgeLabel,.label,.cluster-label,
  foreignObject,foreignObject div,foreignObject span,foreignObject p {
    font-family: var(--mermaid-font, inherit) !important;
  }
  /* Zero UA <p> margins — otherwise labels clip inside foreignObject (esp. zoom). */
  foreignObject div,foreignObject span,foreignObject p {
    margin: 0 !important;
  }
  /* Mermaid bakes fill:#333 on the SVG root; glyphs live in <tspan>, so force them. */
  .nodeLabel tspan,.edgeLabel tspan,.label tspan,.cluster-label tspan,
  .node .label tspan,text tspan {
    color: var(--mermaid-fg) !important;
    fill: var(--mermaid-fg) !important;
  }
  marker path,.marker path,defs marker path {
    fill: var(--mermaid-line) !important;
    stroke: var(--mermaid-line) !important;
  }
  /* Shape-only: do not paint text.actor with node-bg. */
  rect.actor,circle.actor,ellipse.actor,polygon.actor,
  .actor-man line,.actor-man circle,.actor-man path {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .actor-line,line.actor-line { stroke: var(--mermaid-line) !important; }
  text.actor,.messageText,.labelText,.loopText,
  text.actor tspan,.messageText tspan,.labelText tspan,.loopText tspan {
    fill: var(--mermaid-fg) !important;
  }
  .noteText,.noteText tspan {
    fill: var(--mermaid-note-fg) !important;
  }
  .messageLine0,.messageLine1,.loopLine {
    stroke: var(--mermaid-line) !important;
  }
  /* Autonumber discs have no class; recolor so they are not baked #333. */
  circle:not([class]) {
    fill: var(--mermaid-node-border) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .sequenceNumber,.sequenceNumber tspan {
    fill: var(--mermaid-bg) !important;
    stroke: none !important;
  }
  .note {
    fill: var(--mermaid-note-bg) !important;
    /* note-fg is AA vs note-bg; node-border can fail on yellow notes (github-dark). */
    stroke: var(--mermaid-note-fg) !important;
  }
  .activation0,.activation1,.activation2,.activation3,.activation4 {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .labelBox {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .statediagram-state rect,.stateGroup rect,.basic.label rect {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .statediagram-cluster rect {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }
  .transition { stroke: var(--mermaid-line) !important; }
  .classGroup rect,.classGroup line {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .classLabel .box { fill: var(--mermaid-label-bg) !important; }
  .classLabel .label,.labelText tspan,.classText,.classText tspan {
    fill: var(--mermaid-fg) !important;
  }
  .relation { stroke: var(--mermaid-line) !important; }
  .er.entityBox {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .er.attributeBoxOdd,.er.attributeBoxEven {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .er.relationshipLine { stroke: var(--mermaid-line) !important; }
  /* Requirement diagrams paint edges via CSS #333 (no stroke attr). */
  path.edge-thickness-normal,path.edge-pattern-solid,path.edge-pattern-dashed,
  path.edge-pattern-dotted,g.edgePath path,line:not([class]) {
    stroke: var(--mermaid-line) !important;
  }

  /*
   * Mermaid bakes #id { fill:#333 } and per-diagram class fills (pie, gantt,
   * gitGraph, journey, quadrant). Those rules omit !important, so themeCSS
   * !important wins — keep noteText / sequenceNumber overrides after this block.
   */
  text,text tspan,.sectionTitle,.pieTitleText,.slice,.legend text,
  .commit-label,.tag-label,.branchLabel,.branch-label,.commit-id,.commit-msg,
  .titleText,.taskText,.taskTextOutsideRight,.taskTextOutsideLeft,
  .taskText0,.taskText1,.taskText2,.taskText3,
  .taskTextOutside0,.taskTextOutside1,.taskTextOutside2,.taskTextOutside3,
  .sectionTitle0,.sectionTitle1,.sectionTitle2,.sectionTitle3,
  .activeText0,.activeText1,.activeText2,.activeText3,
  .doneText0,.doneText1,.doneText2,.doneText3,
  .critText0,.critText1,.critText2,.critText3,
  .activeCritText0,.activeCritText1,.activeCritText2,.activeCritText3,
  .doneCritText0,.doneCritText1,.doneCritText2,.doneCritText3,
  .milestoneText,.grid .tick text,.error-text,
  text.journey-section,text.task,text.legend,
  .journey-section tspan,.task tspan,.legend tspan,
  /* Mermaid uses compound !important selectors for outside labels — match them. */
  .doneText0.taskTextOutsideLeft,.doneText0.taskTextOutsideRight,
  .doneText1.taskTextOutsideLeft,.doneText1.taskTextOutsideRight,
  .doneText2.taskTextOutsideLeft,.doneText2.taskTextOutsideRight,
  .doneText3.taskTextOutsideLeft,.doneText3.taskTextOutsideRight,
  .doneCritText0.taskTextOutsideLeft,.doneCritText0.taskTextOutsideRight,
  .doneCritText1.taskTextOutsideLeft,.doneCritText1.taskTextOutsideRight,
  .doneCritText2.taskTextOutsideLeft,.doneCritText2.taskTextOutsideRight,
  .doneCritText3.taskTextOutsideLeft,.doneCritText3.taskTextOutsideRight,
  .activeText0.taskTextOutsideLeft,.activeText0.taskTextOutsideRight,
  .activeText1.taskTextOutsideLeft,.activeText1.taskTextOutsideRight,
  .activeText2.taskTextOutsideLeft,.activeText2.taskTextOutsideRight,
  .activeText3.taskTextOutsideLeft,.activeText3.taskTextOutsideRight,
  .activeCritText0.taskTextOutsideLeft,.activeCritText0.taskTextOutsideRight,
  .activeCritText1.taskTextOutsideLeft,.activeCritText1.taskTextOutsideRight,
  .activeCritText2.taskTextOutsideLeft,.activeCritText2.taskTextOutsideRight,
  .activeCritText3.taskTextOutsideLeft,.activeCritText3.taskTextOutsideRight,
  .taskText.clickable,.taskTextOutsideLeft.clickable,.taskTextOutsideRight.clickable {
    fill: var(--mermaid-fg) !important;
    color: var(--mermaid-fg) !important;
    stroke: none !important;
  }
  /* foreignObject HTML chips (journey tasks, some labels) */
  foreignObject div,foreignObject span,foreignObject p,
  foreignObject .task,foreignObject .journey-section {
    color: var(--mermaid-fg) !important;
  }
  .noteText,.noteText tspan {
    fill: var(--mermaid-note-fg) !important;
    color: var(--mermaid-note-fg) !important;
  }
  .sequenceNumber,.sequenceNumber tspan {
    fill: var(--mermaid-bg) !important;
    stroke: none !important;
  }

  /* Categorical fills: series tokens (fancy mid-pop; other themes alias node/cluster/label). */
  .pieCircle,.pieOuterCircle {
    stroke: var(--mermaid-node-border) !important;
  }
  path.pieCircle:nth-of-type(3n+1) { fill: var(--mermaid-series-1) !important; }
  path.pieCircle:nth-of-type(3n+2) { fill: var(--mermaid-series-2) !important; }
  path.pieCircle:nth-of-type(3n+3) { fill: var(--mermaid-series-3) !important; }
  g.legend:nth-of-type(3n+1) rect { fill: var(--mermaid-series-1) !important; }
  g.legend:nth-of-type(3n+2) rect { fill: var(--mermaid-series-2) !important; }
  g.legend:nth-of-type(3n+3) rect { fill: var(--mermaid-series-3) !important; }
  /* Slice % sits on series fills — use series-fg. Title/legend on diagram bg keep fg. */
  text.slice,.slice {
    fill: var(--mermaid-series-fg) !important;
    color: var(--mermaid-series-fg) !important;
  }
  .pieTitleText,.legend text {
    fill: var(--mermaid-fg) !important;
    color: var(--mermaid-fg) !important;
  }

  /* gitGraph label chips */
  .commit-label-bkg {
    fill: var(--mermaid-label-bg) !important;
    opacity: 1 !important;
  }
  .tag-label-bkg {
    fill: var(--mermaid-node-bg) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .branchLabelBkg {
    fill: var(--mermaid-cluster-bg) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }

  /* Journey section/task bars */
  rect.section-type-0,rect.task-type-0 { fill: var(--mermaid-series-1) !important; }
  rect.section-type-1,rect.task-type-1 { fill: var(--mermaid-series-2) !important; }
  rect.section-type-2,rect.task-type-2 { fill: var(--mermaid-series-3) !important; }
  rect.section-type-3,rect.task-type-3 { fill: var(--mermaid-series-4) !important; }
  rect.section-type-4,rect.task-type-4 { fill: var(--mermaid-series-1) !important; }
  rect.section-type-5,rect.task-type-5 { fill: var(--mermaid-series-2) !important; }
  rect.section-type-6,rect.task-type-6 { fill: var(--mermaid-series-3) !important; }
  rect.section-type-7,rect.task-type-7 { fill: var(--mermaid-series-4) !important; }
  text.journey-section,text.task,.journey-section tspan,.task tspan {
    fill: var(--mermaid-series-fg) !important;
    color: var(--mermaid-series-fg) !important;
  }
  foreignObject .task,foreignObject .journey-section {
    color: var(--mermaid-series-fg) !important;
  }

  /* Gantt bars — cycle series; on-bar labels use series-fg; outside labels keep fg */
  /* Section row bands use dedicated tokens (series 1≡4 on non-fancy themes). */
  rect.section {
    opacity: var(--mermaid-gantt-section-opacity) !important;
  }
  .section0 { fill: var(--mermaid-gantt-0) !important; }
  .section1 { fill: var(--mermaid-gantt-1) !important; }
  .section2 { fill: var(--mermaid-gantt-2) !important; }
  .section3 { fill: var(--mermaid-gantt-3) !important; }
  /* Weekend/exclude bands — Mermaid defaults to #eee, which kills light outside labels. */
  .exclude-range { fill: var(--mermaid-exclude) !important; }
  .grid .tick { stroke: var(--mermaid-line) !important; }
  /* Non-active bars keep series fills; stroke cycles border tokens. */
  .task0 {
    fill: var(--mermaid-series-1) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .task1,.done0,.doneCrit0 {
    fill: var(--mermaid-series-2) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .task2,.done1,.doneCrit1,.crit0,.crit1 {
    fill: var(--mermaid-series-3) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }
  .task3,.done2,.done3,.doneCrit2,.doneCrit3,.crit2,.crit3 {
    fill: var(--mermaid-series-4) !important;
    stroke: var(--mermaid-line) !important;
  }
  /* Active bars: fill matches that bar's border so the task reads solid. */
  .active0,.activeCrit0 {
    fill: var(--mermaid-node-border) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .active1,.activeCrit1 {
    fill: var(--mermaid-node-border) !important;
    stroke: var(--mermaid-node-border) !important;
  }
  .active2,.activeCrit2 {
    fill: var(--mermaid-cluster-border) !important;
    stroke: var(--mermaid-cluster-border) !important;
  }
  .active3,.activeCrit3 {
    fill: var(--mermaid-line) !important;
    stroke: var(--mermaid-line) !important;
  }
  .taskText:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .critText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .critText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .critText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .critText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneCritText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneCritText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneCritText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .doneCritText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight) {
    fill: var(--mermaid-series-fg) !important;
    color: var(--mermaid-series-fg) !important;
  }
  /* Active on-bar labels — ink chosen per border surface for AA contrast. */
  .activeText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeCritText0:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeCritText1:not(.taskTextOutsideLeft):not(.taskTextOutsideRight) {
    fill: var(--mermaid-active-on-node-fg) !important;
    color: var(--mermaid-active-on-node-fg) !important;
  }
  .activeText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeCritText2:not(.taskTextOutsideLeft):not(.taskTextOutsideRight) {
    fill: var(--mermaid-active-on-cluster-fg) !important;
    color: var(--mermaid-active-on-cluster-fg) !important;
  }
  .activeText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight),
  .activeCritText3:not(.taskTextOutsideLeft):not(.taskTextOutsideRight) {
    fill: var(--mermaid-active-on-line-fg) !important;
    color: var(--mermaid-active-on-line-fg) !important;
  }

  /* Quadrant chart panels + in-panel labels */
  .quadrants .quadrant { stroke: var(--mermaid-line) !important; }
  .quadrant:nth-child(1) rect,.quadrants > .quadrant:nth-child(1) > rect {
    fill: var(--mermaid-series-1) !important;
  }
  .quadrant:nth-child(2) rect,.quadrants > .quadrant:nth-child(2) > rect {
    fill: var(--mermaid-series-2) !important;
  }
  .quadrant:nth-child(3) rect,.quadrants > .quadrant:nth-child(3) > rect {
    fill: var(--mermaid-series-3) !important;
  }
  .quadrant:nth-child(4) rect,.quadrants > .quadrant:nth-child(4) > rect {
    fill: var(--mermaid-series-4) !important;
  }
  .quadrant text,.quadrant tspan {
    fill: var(--mermaid-series-fg) !important;
    color: var(--mermaid-series-fg) !important;
  }
  .border { stroke: var(--mermaid-line) !important; }
`;

hooks.MERMAID_THEME_CSS = MERMAID_THEME_CSS;
