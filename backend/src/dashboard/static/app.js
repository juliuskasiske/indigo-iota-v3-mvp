// Brain graph dashboard.
//
// Flow:
//   1. On load, fetch /api/graph and show the dashboard.
//   2. Open SSE on /api/stream from the start. Events delivered:
//        node_added   - cy.add(...) + schedule a re-layout
//        edge_added   - cy.add(...) + schedule a re-layout
//   3. Enrich button -> POST /api/enrich. The graph fills in live over SSE.

const TYPE_COLORS = {
  person:  "#6366f1",
  company: "#10b981",
  project: "#f59e0b",
};

// Brand defaults for the legacy dev dashboard's graph styling.
const BRAND = "#105677";
const FONT_FAMILY = "Inter";

let cy = null;
let pinnedNodeId = null;
let sseSource = null;
let relayoutTimeout = null;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

start();

async function start() {
  // Always open the SSE stream — it's the channel for live updates during enrich.
  openSSE();

  await loadDashboard();

  // Seed the token counter from /api/usage — the SSE stream takes over
  // from there and pushes updates after every LLM call.
  const stats = await fetchJSONSafe("/api/usage");
  if (stats) updateTokenCounter(stats);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function showDashboard() {
  document.getElementById("dashboard").hidden = false;
}

async function loadDashboard() {
  showDashboard();
  initEmptyCytoscape();
  const data = await fetchJSONSafe("/api/graph");
  if (data && Array.isArray(data.nodes)) {
    data.nodes.forEach((n) => onNodeAdded(n, /* layoutNow */ false));
    data.edges.forEach((e) => onEdgeAdded(e, /* layoutNow */ false));
    if (cy) cy.layout(layoutOptions()).run();
  }
  attachDashboardChrome();
}

function attachDashboardChrome() {
  const enrich = document.getElementById("enrich");
  if (enrich && !enrich.dataset.bound) {
    enrich.addEventListener("click", onEnrichClick);
    enrich.dataset.bound = "1";
  }
  const relayout = document.getElementById("relayout");
  if (relayout && !relayout.dataset.bound) {
    relayout.addEventListener("click", () => {
      if (cy) cy.layout(layoutOptions()).run();
    });
    relayout.dataset.bound = "1";
  }
  document.querySelectorAll(".filter-pill").forEach((pill) => {
    if (pill.dataset.bound) return;
    pill.addEventListener("click", () => {
      const pressed = pill.getAttribute("aria-pressed") === "true";
      pill.setAttribute("aria-pressed", String(!pressed));
      applyFilters();
    });
    pill.dataset.bound = "1";
  });
  attachTabs();
  attachAskForm();
}

// ---------------------------------------------------------------------------
// Tabs (Knowledge Graph / Search)
// ---------------------------------------------------------------------------

let activeTab = "kg";

function attachTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tab.dataset.bound) return;
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    tab.dataset.bound = "1";
  });
}

function switchTab(name) {
  if (name === activeTab) return;
  activeTab = name;

  document.querySelectorAll(".tab").forEach((t) => {
    t.setAttribute("aria-pressed", String(t.dataset.tab === name));
  });
  document.querySelectorAll(".tab-view").forEach((v) => {
    v.hidden = v.dataset.tab !== name;
  });

  // Filters + relayout are KG-only. Hide them on Search.
  const onKg = name === "kg";
  const filters = document.getElementById("filters");
  const relayout = document.getElementById("relayout");
  if (filters) filters.hidden = !onKg;
  if (relayout) relayout.hidden = !onKg;

  if (name === "search") {
    const input = document.getElementById("ask-input");
    if (input) input.focus();
  } else if (cy) {
    // Cytoscape was inside a hidden tab; re-measure and re-fit.
    cy.resize();
    cy.fit(undefined, 40);
  }
}

// ---------------------------------------------------------------------------
// Ask form (Search tab): POST /api/ask, render answer + cited sources
// ---------------------------------------------------------------------------

let lastSources = [];

function attachAskForm() {
  const form = document.getElementById("ask-form");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  form.addEventListener("submit", onAskSubmit);
  attachQuestionHistory();
}

// ---------------------------------------------------------------------------
// Question history (Search-tab sidebar): list past Q&As, replay on click
// ---------------------------------------------------------------------------

let activeQuestionId = null;

function attachQuestionHistory() {
  const btn = document.getElementById("new-question-btn");
  if (btn && !btn.dataset.bound) {
    btn.addEventListener("click", onNewQuestionClick);
    btn.dataset.bound = "1";
  }
  loadQuestionHistory();
}

async function loadQuestionHistory() {
  const data = await fetchJSONSafe("/api/questions");
  const questions = data && Array.isArray(data.questions) ? data.questions : [];
  renderQuestionList(questions);
}

function renderQuestionList(questions) {
  const list = document.getElementById("question-list");
  if (!list) return;
  if (!questions.length) {
    list.innerHTML = `<div class="question-empty">No questions yet.</div>`;
    return;
  }
  list.innerHTML = questions
    .map((q) => `
      <div class="question-item ${q.id === activeQuestionId ? "active" : ""}"
           data-question-id="${q.id}"
           title="${escapeHtml(q.question)}">
        <div class="question-item-text">${escapeHtml(q.question)}</div>
        <div class="question-item-meta">${escapeHtml(relativeTime(q.created_at))}</div>
      </div>
    `)
    .join("");
  list.querySelectorAll(".question-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = parseInt(el.dataset.questionId, 10);
      loadQuestion(id);
    });
  });
}

async function loadQuestion(questionId) {
  try {
    const res = await fetch(`/api/questions/${questionId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const q = await res.json();
    activeQuestionId = q.id;

    // Render into the existing answer + sources panes (no LLM call).
    document.getElementById("ask-hint").hidden = true;
    document.getElementById("ask-results").hidden = false;
    document.getElementById("answer-question").textContent = q.question;
    const answerBody = document.getElementById("answer-body");
    answerBody.innerHTML = renderAnswerText(q.answer || "");
    renderSources(q.sources || []);
    answerBody.querySelectorAll(".citation").forEach((el) => {
      el.addEventListener("click", () => {
        highlightSourceCard(parseInt(el.dataset.n, 10));
      });
    });

    // Clear the input — past questions are read-only here.
    const input = document.getElementById("ask-input");
    if (input) input.value = "";

    // Re-render the sidebar so the active highlight moves.
    loadQuestionHistory();
  } catch (err) {
    console.warn("[question] load failed", err);
  }
}

function onNewQuestionClick() {
  activeQuestionId = null;
  const input = document.getElementById("ask-input");
  if (input) {
    input.value = "";
    input.focus();
  }
  document.getElementById("ask-results").hidden = true;
  document.getElementById("ask-hint").hidden = false;
  loadQuestionHistory();
}

function relativeTime(isoStr) {
  if (!isoStr) return "";
  const t = new Date(isoStr);
  const sec = Math.floor((Date.now() - t.getTime()) / 1000);
  if (sec < 5)      return "just now";
  if (sec < 60)     return `${sec}s ago`;
  if (sec < 3600)   return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400)  return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return t.toLocaleDateString();
}

async function onAskSubmit(evt) {
  evt.preventDefault();
  const input = document.getElementById("ask-input");
  const submit = document.getElementById("ask-submit");
  const question = (input.value || "").trim();
  if (!question) return;

  const results = document.getElementById("ask-results");
  const answerBody = document.getElementById("answer-body");
  const answerQ = document.getElementById("answer-question");
  const askHint = document.getElementById("ask-hint");

  if (askHint) askHint.hidden = true;
  results.hidden = false;
  answerQ.textContent = question;
  showAnswerLoading();
  submit.disabled = true;
  submit.classList.add("is-loading");
  const original = submit.textContent;
  submit.textContent = "Asking";

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `HTTP ${res.status}`);
    }
    renderAnswer(await res.json());
  } catch (err) {
    answerBody.textContent = `Failed: ${err.message}`;
  } finally {
    submit.disabled = false;
    submit.classList.remove("is-loading");
    submit.textContent = original;
  }
}

function renderAnswer(data) {
  const sources = data.sources || [];
  lastSources = sources;
  // /api/ask returns question_id for the newly-saved row; mark it active
  // so the sidebar highlights it after we refresh the list.
  if (data.question_id) activeQuestionId = data.question_id;
  const answerBody = document.getElementById("answer-body");
  answerBody.innerHTML = renderAnswerText(data.answer || "");
  renderSources(sources);
  // Make [N] citations clickable -> highlight the corresponding card.
  answerBody.querySelectorAll(".citation").forEach((el) => {
    el.addEventListener("click", () => {
      const n = parseInt(el.dataset.n, 10);
      highlightSourceCard(n);
    });
  });
  // Refresh sidebar: the new question appears + becomes active.
  loadQuestionHistory();
}

function renderAnswerText(text) {
  // Markdown -> HTML via marked, then post-process [N] into clickable
  // citation spans. Fallback to plain-escape + citation-spans if marked
  // didn't load (CDN miss / offline).
  let html;
  if (typeof window.marked !== "undefined" && typeof window.marked.parse === "function") {
    html = window.marked.parse(text, { gfm: true, breaks: false });
  } else {
    // Cheap fallback: escape + preserve line breaks.
    html = "<p>" + escapeHtml(text).replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
  }
  return html.replace(
    /\[(\d+)\]/g,
    (_, n) => `<span class="citation" data-n="${n}">[${n}]</span>`
  );
}

// ---------------------------------------------------------------------------
// Loading state: pulsing "thinking" indicator + shimmer skeleton lines
// in the answer pane, plus skeleton cards in the sources pane.
// ---------------------------------------------------------------------------

function showAnswerLoading() {
  const answerBody = document.getElementById("answer-body");
  answerBody.innerHTML = `
    <div class="answer-thinking">
      <span class="answer-thinking-pulse"></span>
      <span class="answer-thinking-text">Synthesizing answer…</span>
    </div>
    <div class="answer-skeleton">
      <div class="skeleton-line w-95"></div>
      <div class="skeleton-line w-88"></div>
      <div class="skeleton-line w-92"></div>
      <div class="skeleton-line w-76"></div>
      <div class="skeleton-line w-65"></div>
    </div>
  `;
  const sourcesList = document.getElementById("sources-list");
  sourcesList.innerHTML = `
    <div class="source-skeleton-card">
      <div class="skeleton-line tall w-50"></div>
      <div class="skeleton-line w-95"></div>
      <div class="skeleton-line w-76"></div>
    </div>
    <div class="source-skeleton-card">
      <div class="skeleton-line tall w-65"></div>
      <div class="skeleton-line w-88"></div>
      <div class="skeleton-line w-50"></div>
    </div>
    <div class="source-skeleton-card">
      <div class="skeleton-line tall w-50"></div>
      <div class="skeleton-line w-92"></div>
      <div class="skeleton-line w-65"></div>
    </div>
  `;
}

function renderSources(sources) {
  const list = document.getElementById("sources-list");
  if (!sources.length) {
    list.innerHTML = `<div class="sources-empty">No sources matched.</div>`;
    return;
  }
  list.innerHTML = sources
    .map((s, i) => {
      const entity = s.entity || {};
      const number = i + 1;
      const methodClass = s.method === "vector"
        ? "source-method-vector"
        : "source-method-graph";
      const methodLabel = s.method === "vector"
        ? `vector · ${(s.score || 0).toFixed(2)}`
        : `graph · ${s.predicate || "neighbor"}`;
      const meta = [s.section, s.date].filter(Boolean).join(" · ");
      return `
        <div class="source-card" data-n="${number}" data-node-id="${s.node_id || ""}">
          <div class="source-card-header">
            <span class="source-number">[${number}]</span>
            <span class="source-method ${methodClass}">${escapeHtml(methodLabel)}</span>
            ${entity.type ? `<span class="type-badge ${escapeHtml(entity.type)}">${escapeHtml(entity.type)}</span>` : ""}
            <span class="source-entity-name">${escapeHtml(entity.name || "(unknown)")}</span>
            <span class="source-meta">${escapeHtml(meta)}</span>
          </div>
          <div class="source-text">${escapeHtml(s.text || "")}</div>
        </div>
      `;
    })
    .join("");
  list.querySelectorAll(".source-card").forEach((el) => {
    el.addEventListener("click", () => {
      const nid = el.dataset.nodeId;
      if (nid) jumpToNodeInKG(nid);
    });
  });
}

function highlightSourceCard(n) {
  document.querySelectorAll(".source-card").forEach((c) => {
    c.classList.toggle("highlighted", c.dataset.n === String(n));
  });
  const target = document.querySelector(`.source-card[data-n="${n}"]`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function jumpToNodeInKG(nodeId) {
  switchTab("kg");
  // Wait a tick: switchTab triggers cy.resize/fit and the hidden→shown
  // layout change. Pinning + animating before that settles can mis-zoom.
  setTimeout(() => {
    if (!cy) return;
    const node = cy.getElementById(String(nodeId));
    if (!node.length) return;
    pinnedNodeId = node.id();
    clearFocus();
    focusOn(node, true);
    showDetails(node.data());
    cy.animate(
      { center: { eles: node }, zoom: 1.4 },
      { duration: 420, easing: "ease-in-out" }
    );
  }, 100);
}

// ---------------------------------------------------------------------------
// Enrich button
// ---------------------------------------------------------------------------

async function onEnrichClick() {
  const btn = document.getElementById("enrich");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("is-loading");
  const originalText = btn.textContent;
  btn.textContent = "Enriching";
  try {
    const res = await fetch("/api/enrich", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
  } catch (err) {
    console.error("[enrich] failed", err);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    btn.textContent = originalText;
  }
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

function openSSE() {
  if (sseSource) return;
  sseSource = new EventSource("/api/stream");
  sseSource.addEventListener("node_added", (evt) => {
    try {
      onNodeAdded(JSON.parse(evt.data));
    } catch (e) {
      console.warn("[sse] bad node_added payload", e);
    }
  });
  sseSource.addEventListener("edge_added", (evt) => {
    try {
      onEdgeAdded(JSON.parse(evt.data));
    } catch (e) {
      console.warn("[sse] bad edge_added payload", e);
    }
  });
  sseSource.addEventListener("node_removed", (evt) => {
    try {
      onNodeRemoved(JSON.parse(evt.data));
    } catch (e) {
      console.warn("[sse] bad node_removed payload", e);
    }
  });
  sseSource.addEventListener("edge_removed", (evt) => {
    try {
      onEdgeRemoved(JSON.parse(evt.data));
    } catch (e) {
      console.warn("[sse] bad edge_removed payload", e);
    }
  });
  sseSource.addEventListener("usage_updated", (evt) => {
    try {
      updateTokenCounter(JSON.parse(evt.data));
    } catch (e) {
      console.warn("[sse] bad usage_updated payload", e);
    }
  });
  sseSource.addEventListener("email_started", (evt) => {
    try {
      showEmailProgress(JSON.parse(evt.data));
    } catch (e) {
      console.warn("[sse] bad email_started payload", e);
    }
  });
  sseSource.addEventListener("email_completed", () => {
    hideEmailProgress();
  });
  sseSource.onerror = (err) => {
    // EventSource auto-retries; just log.
    console.warn("[sse] error (will auto-retry)", err);
  };
}

function onNodeAdded(node, layoutNow = true) {
  if (!cy) initEmptyCytoscape();
  if (cy.getElementById(String(node.id)).length) return;
  cy.add({
    data: {
      id: String(node.id),
      label: node.name,
      type: node.type,
      page_path: node.page_path,
    },
  });
  if (layoutNow) scheduleRelayout();
}

function onEdgeAdded(edge, layoutNow = true) {
  if (!cy) initEmptyCytoscape();
  const id = `e${edge.id}`;
  if (cy.getElementById(id).length) return;
  if (!cy.getElementById(String(edge.source)).length) return;
  if (!cy.getElementById(String(edge.target)).length) return;
  cy.add({
    data: {
      id,
      source: String(edge.source),
      target: String(edge.target),
      label: edge.predicate,
    },
  });
  if (layoutNow) scheduleRelayout();
}

function onNodeRemoved(data) {
  if (!cy) return;
  const el = cy.getElementById(String(data.id));
  if (el.length) {
    el.remove();
    scheduleRelayout();
  }
}

function onEdgeRemoved(data) {
  if (!cy) return;
  const el = cy.getElementById(`e${data.id}`);
  if (el.length) {
    el.remove();
    scheduleRelayout();
  }
}

function scheduleRelayout() {
  if (relayoutTimeout) clearTimeout(relayoutTimeout);
  relayoutTimeout = setTimeout(() => {
    if (cy) cy.layout(layoutOptions()).run();
  }, 280);
}

// ---------------------------------------------------------------------------
// Cytoscape
// ---------------------------------------------------------------------------

function initEmptyCytoscape() {
  if (cy) return;
  if (window.cytoscapeFcose) {
    cytoscape.use(window.cytoscapeFcose);
  } else {
    console.warn("cytoscape-fcose not loaded; falling back to cose.");
  }
  cy = cytoscape({
    container: document.getElementById("graph"),
    elements: [],
    minZoom: 0.3,
    maxZoom: 2.5,
    wheelSensitivity: 0.2,
    style: cytoscapeStyle(),
    layout: layoutOptions(),
  });
  attachCytoscapeHandlers();
}

function attachCytoscapeHandlers() {
  cy.on("mouseover", "node", (evt) => {
    if (pinnedNodeId) return;
    focusOn(evt.target);
  });
  cy.on("mouseout", "node", () => {
    if (pinnedNodeId) return;
    clearFocus();
  });
  cy.on("tap", "node", (evt) => {
    const node = evt.target;
    pinnedNodeId = node.id();
    clearFocus();
    focusOn(node, true);
    showDetails(node.data());
  });
  cy.on("tap", (evt) => {
    if (evt.target === cy) {
      pinnedNodeId = null;
      clearFocus();
      showEmptyDetails();
    }
  });
}

function cytoscapeStyle() {
  return [
    {
      selector: "node",
      style: {
        "background-color": (ele) =>
          TYPE_COLORS[ele.data("type")] || "#94a3b8",
        "background-opacity": 1,
        label: "data(label)",
        color: "#111827",
        "font-family": `${FONT_FAMILY}, sans-serif`,
        "font-size": 13,
        "font-weight": 500,
        "text-valign": "bottom",
        "text-margin-y": 10,
        "text-background-color": "#f9fafb",
        "text-background-opacity": 0.85,
        "text-background-padding": 3,
        "text-background-shape": "roundrectangle",
        width: 44,
        height: 44,
        "border-width": 3,
        "border-color": "#ffffff",
        "transition-property":
          "opacity, background-color, border-color, border-width, width, height",
        "transition-duration": "180ms",
        "transition-timing-function": "ease-out",
      },
    },
    { selector: "node.faded", style: { opacity: 0.18 } },
    { selector: "node.highlighted", style: { width: 50, height: 50 } },
    {
      selector: "node.pinned",
      style: { "border-color": BRAND, "border-width": 4 },
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#d1d5db",
        "line-color": "#d1d5db",
        width: 1.5,
        label: "",
        "transition-property":
          "line-color, target-arrow-color, opacity, width",
        "transition-duration": "180ms",
        "transition-timing-function": "ease-out",
      },
    },
    { selector: "edge.faded", style: { opacity: 0.08 } },
    {
      selector: "edge.highlighted",
      style: {
        "line-color": BRAND,
        "target-arrow-color": BRAND,
        width: 2,
        label: "data(label)",
        "font-family": `${FONT_FAMILY}, sans-serif`,
        "font-size": 10.5,
        "font-weight": 500,
        color: BRAND,
        "text-rotation": "autorotate",
        "text-background-color": "#f9fafb",
        "text-background-opacity": 1,
        "text-background-padding": 3,
        "text-background-shape": "roundrectangle",
      },
    },
  ];
}

function layoutOptions() {
  if (window.cytoscapeFcose) {
    return {
      name: "fcose",
      quality: "proof",
      animate: true,
      animationDuration: 600,
      animationEasing: "ease-out",
      nodeRepulsion: 6500,
      idealEdgeLength: 140,
      edgeElasticity: 0.45,
      gravity: 0.25,
      gravityRangeCompound: 1.5,
      nodeSeparation: 90,
      packComponents: true,
      randomize: false,
      fit: true,
      padding: 60,
    };
  }
  return {
    name: "cose",
    animate: true,
    animationDuration: 600,
    nodeRepulsion: 8000,
    idealEdgeLength: 130,
    edgeElasticity: 100,
    gravity: 80,
    numIter: 1500,
    randomize: false,
    fit: true,
    padding: 60,
  };
}

function focusOn(node, pinned = false) {
  const neighborhood = node.closedNeighborhood();
  cy.elements().difference(neighborhood).addClass("faded");
  neighborhood.addClass("highlighted");
  if (pinned) node.addClass("pinned");
}

function clearFocus() {
  cy.elements().removeClass("faded highlighted pinned");
}

// ---------------------------------------------------------------------------
// Details panel
// ---------------------------------------------------------------------------

async function showDetails(node) {
  const details = document.getElementById("details");

  if (!node.page_path) {
    details.innerHTML = `
      <h2>${escapeHtml(node.label)}</h2>
      <span class="type-badge ${escapeHtml(node.type)}">${escapeHtml(node.type)}</span>
      <p class="hint" style="margin-top:24px;text-align:left">
        No brain page yet — this node was created as a reference
        from another entity's frontmatter.
      </p>
    `;
    return;
  }

  try {
    const res = await fetch(
      `/api/page?path=${encodeURIComponent(node.page_path)}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderDetails(await res.json());
  } catch (err) {
    details.innerHTML =
      `<p class="hint">Failed to load brain page: ${escapeHtml(err.message)}</p>`;
  }
}

function renderDetails(page) {
  const fm = page.frontmatter || {};
  const skip = new Set(["name", "type"]);
  const fmEntries = Object.entries(fm).filter(([k]) => !skip.has(k));

  const html = [
    `<h2>${escapeHtml(fm.name || "(no name)")}</h2>`,
    `<span class="type-badge ${escapeHtml(fm.type || "")}">${escapeHtml(fm.type || "")}</span>`,
  ];

  if (page.description) {
    html.push(`<p class="description">${escapeHtml(page.description)}</p>`);
  }

  if (fmEntries.length) {
    html.push("<h3>Frontmatter</h3>");
    html.push("<dl class=\"frontmatter\">");
    for (const [k, v] of fmEntries) {
      html.push(
        `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(formatValue(v))}</dd>`
      );
    }
    html.push("</dl>");
  }

  if (Array.isArray(page.timeline) && page.timeline.length) {
    html.push("<h3>Timeline</h3>");
    html.push("<div class=\"timeline\">");
    for (const e of page.timeline) {
      html.push(`
        <div class="timeline-entry">
          <div class="date">${escapeHtml(e.date || "")}</div>
          <div>${escapeHtml(e.entry || "")}</div>
        </div>
      `);
    }
    html.push("</div>");
  }

  document.getElementById("details").innerHTML = html.join("");
}

function showEmptyDetails() {
  document.getElementById("details").innerHTML =
    `<p class="hint">Click a node to see its brain page.</p>`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function applyFilters() {
  if (!cy) return;
  const visible = new Set();
  document.querySelectorAll(".filter-pill").forEach((pill) => {
    if (pill.getAttribute("aria-pressed") === "true") {
      visible.add(pill.dataset.type);
    }
  });
  cy.nodes().forEach((n) => {
    n.style("display", visible.has(n.data("type")) ? "element" : "none");
  });
  cy.edges().forEach((e) => {
    const okSrc = visible.has(e.source().data("type"));
    const okTgt = visible.has(e.target().data("type"));
    e.style("display", okSrc && okTgt ? "element" : "none");
  });
}

async function fetchJSONSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token counter + email-progress card (live signals from /api/stream)
// ---------------------------------------------------------------------------

function updateTokenCounter(stats) {
  const el = document.getElementById("token-counter-value");
  if (!el || !stats) return;
  const total = stats.total_tokens || 0;
  el.textContent = total.toLocaleString();
}

function showEmailProgress(email) {
  const card = document.getElementById("email-progress");
  if (!card) return;
  document.getElementById("email-from").textContent = email.from_name || "";
  document.getElementById("email-date").textContent =
    (email.date || "").slice(0, 10);
  document.getElementById("email-subject").textContent = email.subject || "";
  document.getElementById("email-snippet").textContent = email.snippet || "";
  card.hidden = false;
  // Force a paint before adding .visible so the CSS transition animates
  // instead of jumping straight to the end state.
  requestAnimationFrame(() => card.classList.add("visible"));
}

function hideEmailProgress() {
  const card = document.getElementById("email-progress");
  if (!card) return;
  card.classList.remove("visible");
  // Wait for the fade-out transition (300ms) before hiding so the card
  // doesn't pop out abruptly.
  setTimeout(() => {
    if (!card.classList.contains("visible")) card.hidden = true;
  }, 350);
}
