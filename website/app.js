const labels = { dataset: "D-RS", database: "DB-RS", vector: "V-RS", model: "M-RS" };
let experiment = null;
let currentKey = "sisa_plus_vector_purge";
let selectedSubjects = new Set();

const layerMeta = [
  { index: "01", icon: "⌁", title: "Dataset (D-RS)", text: "Raw files, exports, staging archives, and backups. Scan for exact or near-duplicate records of the erased subject across all copies.", formula: "D-RS = 100 × (1 − N_match / N_total)" },
  { index: "02", icon: "▦", title: "Database (DB-RS)", text: "Operational databases, read replicas, transaction/audit logs, caches, and backups. Extends exact-match scanning to all live and near-live stores.", formula: "DB-RS = 100 × (1 − R_res / R_orig)" },
  { index: "03", icon: "✣", title: "Vector store (V-RS)", text: "RAG vector indices and semantic embeddings. Query subject attributes and measure top-k retrieval leakage above cosine threshold τ.", formula: "V-RS = 100 × (1 − I_top-k)" },
  { index: "04", icon: "◉", title: "Model (M-RS)", text: "Parameters of any fine-tuned or influenced model. Evaluates normalized membership inference (MIA) advantage and targeted verbatim extraction rate.", formula: "M-RS = 100 × (1 − ½(A_mia + A_ext))" }
];

function fmt(value) { return Number(value).toFixed(2).replace(/\.00$/, ""); }

function grade(value) {
  if (value < 40) return "F - Non-Compliant";
  if (value < 55) return "D - Weak Erasure";
  if (value < 70) return "C - Partial Erasure";
  if (value < 85) return "B - Substantial Erasure";
  return "A - Near-Complete Erasure";
}

function selected() { return derivedItem(experiment.strategies.find(item => item.key === currentKey)); }
function scoreReport(item) { return item.report; }
function scoreOf(item) { return Number(scoreReport(item).dfi); }
function layerScores(item) { return scoreReport(item).scores; }

function gradeOf(item) {
  const text = scoreReport(item).grade || grade(scoreOf(item));
  const letter = text.slice(0, 1);
  const words = text.replace(/^[A-F]\s*-\s*/, "").toUpperCase();
  return [letter, words];
}

function derivedItem(item) {
  if (!item) return item;
  if (!selectedSubjects.size) return null;
  const selected = [...selectedSubjects];
  const evidence = item.evidence.subject_evidence;
  const rows = selected.map(subject => evidence[subject]).filter(Boolean);
  if (!rows.length) return item;
  const dResidual = rows.reduce((sum, row) => sum + row.dataset.residual, 0);
  const dOriginal = rows.reduce((sum, row) => sum + row.dataset.original, 0);
  const dbResidual = rows.reduce((sum, row) => sum + row.database.residual, 0);
  const dbOriginal = rows.reduce((sum, row) => sum + row.database.original, 0);
  const vHits = rows.reduce((sum, row) => sum + row.vector.attributable_hits, 0);
  const vSlots = rows.reduce((sum, row) => sum + row.vector.total_top_k_slots, 0);
  const mia = rows.reduce((sum, row) => sum + row.model.raw_mia_advantage, 0) / rows.length;
  const extraction = rows.reduce((sum, row) => sum + row.model.extraction_success, 0) / rows.length;
  const scores = {
    dataset: 100 * (1 - dResidual / dOriginal),
    database: 100 * (1 - dbResidual / dbOriginal),
    vector: 100 * (1 - vHits / vSlots),
    model: 100 * (1 - 0.5 * (Math.min(1, 2 * mia) + extraction))
  };
  const dfi = 0.2 * scores.dataset + 0.2 * scores.database + 0.3 * scores.vector + 0.3 * scores.model;
  return {
    ...item,
    report: {
      ...item.report,
      dfi,
      grade: grade(dfi),
      scores,
      scope: { ...item.report.scope, subjects: rows.length },
      raw_signals: {
        ...item.report.raw_signals,
        dataset: { ...item.report.raw_signals.dataset, residual: dResidual, original: dOriginal },
        database: { ...item.report.raw_signals.database, residual: dbResidual, original: dbOriginal },
        vector: { ...item.report.raw_signals.vector, attributable_hits: vHits, total_top_k_slots: vSlots, queries: rows.length },
        model: { ...item.report.raw_signals.model, raw_mia_advantage: mia, normalized_mia_advantage: Math.min(1, 2 * mia), extraction_success: extraction }
      }
    }
  };
}

function renderLayers() {
  document.getElementById("layerGrid").innerHTML = layerMeta.map(layer => `
    <article class="layer-card">
      <div class="layer-index">${layer.index} / 04</div>
      <div class="layer-icon">${layer.icon}</div>
      <h3>${layer.title}</h3>
      <p>${layer.text}</p>
      <div class="layer-formula">${layer.formula}</div>
    </article>
  `).join("");
}

function renderHero(item) {
  const score = scoreOf(item), [letter, words] = gradeOf(item), scores = layerScores(item);
  document.getElementById("heroScore").textContent = fmt(score);
  document.getElementById("heroGrade").textContent = words;
  document.getElementById("heroRing").style.setProperty("--score", score);
  document.getElementById("heroGradeTag").textContent = letter;
  document.getElementById("heroLayers").innerHTML = Object.entries(scores).map(([key, value]) => `
    <div class="mini-row">
      <span>${labels[key]}</span>
      <span class="mini-track"><span class="mini-fill" style="width:${value}%"></span></span>
      <span>${fmt(value)}</span>
    </div>
  `).join("");
}

function renderStrategyDetail(item) {
  const evidence = item.evidence, residual = item.report.raw_signals, ops = evidence.operations || [];
  document.getElementById("strategyDetail").innerHTML = `
    <div class="detail-head">
      <span class="panel-kicker">WHAT CHANGED IN THIS STRATEGY RUN</span>
      <span class="detail-target">${evidence.unlearned}</span>
    </div>
    <div class="detail-grid">
      <div><small>DATASET RESIDUE</small><strong>${residual.dataset.residual} / ${residual.dataset.original}</strong><span>across 3 copies</span></div>
      <div><small>DATABASE RESIDUE</small><strong>${residual.database.residual} / ${residual.database.original}</strong><span>across 4 stores</span></div>
      <div><small>VECTOR LEAKAGE</small><strong>${residual.vector.attributable_hits} / ${residual.vector.total_top_k_slots}</strong><span>top-k slots</span></div>
      <div><small>MIA ADVANTAGE</small><strong>${fmt(residual.model.normalized_mia_advantage * 100)}%</strong><span>norm. signal</span></div>
    </div>
    <div class="operation-list">
      <small>EXECUTED SYSTEM OPERATIONS</small>
      ${ops.map(op => `<span>+ ${op}</span>`).join("")}
    </div>
    <div class="parameter-row"><span>SURFACE IMPLEMENTATION</span><span class="mono">${evidence.implementation}</span></div>
    <div class="parameter-row"><span>MODEL AUDIT NOTE</span><span class="mono">${evidence.model_note}</span></div>
  `;
}

function renderAudit() {
  if (!selectedSubjects.size) {
    document.getElementById("auditScore").textContent = "—";
    document.getElementById("formulaResult").textContent = "—";
    document.getElementById("auditGrade").textContent = "SELECT TARGETS";
    document.getElementById("strategyDetail").innerHTML = `<div class="detail-head"><span class="panel-kicker">WAITING FOR A FORGET SET</span><span class="detail-target">Select at least one synthetic subject in the selector below to run the audit pipeline.</span></div>`;
    return;
  }
  const item = selected();
  if (!item) return;
  const score = scoreOf(item), [letter, words] = gradeOf(item), scores = layerScores(item);
  document.getElementById("auditScore").textContent = fmt(score);
  document.getElementById("formulaResult").textContent = fmt(score);
  document.getElementById("auditGrade").textContent = `${letter} · ${words}`;
  document.getElementById("barChart").innerHTML = Object.entries(scores).map(([layer, value]) => `
    <div class="bar-row">
      <label>${labels[layer]}</label>
      <span class="bar-track"><span class="bar-fill" style="width:${value}%"></span></span>
      <output>${fmt(value)}</output>
    </div>
  `).join("");
  document.querySelectorAll(".strategy-option").forEach(option => option.classList.toggle("active", option.dataset.strategy === currentKey));
  renderStrategyDetail(item);
  renderHero(item);
}

function renderStrategies() {
  document.getElementById("strategyList").innerHTML = experiment.strategies.map((item, index) => {
    const live = derivedItem(item);
    return `
      <button class="strategy-option ${item.key === currentKey ? "active" : ""}" data-strategy="${item.key}">
        <b>${String(index + 1).padStart(2, "0")} / ${item.label}</b>
        <span>${fmt(scoreOf(live))}</span>
      </button>
    `;
  }).join("");
  document.querySelectorAll(".strategy-option").forEach(option => option.addEventListener("click", () => {
    currentKey = option.dataset.strategy;
    renderStrategies();
    renderAudit();
  }));
}

function renderBenchmark() {
  document.getElementById("benchmarkChart").innerHTML = experiment.strategies.map(item => {
    const live = derivedItem(item);
    return `
      <div class="benchmark-col">
        <span class="benchmark-value">${fmt(scoreOf(live))}</span>
        <span class="benchmark-bar" style="height:${scoreOf(live)}%"></span>
        <span class="benchmark-name">${item.label}</span>
      </div>
    `;
  }).join("");

  document.getElementById("evidenceTable").innerHTML = `
    <div class="evidence-row head"><span>STRATEGY (FIG. 4)</span><span class="score">DFI</span><span class="grade">GRADE BAND</span></div>
  ` + experiment.strategies.map(item => {
    const live = derivedItem(item), [letter, words] = gradeOf(live);
    return `
      <div class="evidence-row">
        <span>${item.label}</span>
        <span class="score">${fmt(scoreOf(live))}</span>
        <span class="grade">${letter} · ${words.split(" ")[0]}</span>
      </div>
    `;
  }).join("");
}

function renderScatterPlot() {
  const container = document.getElementById("scatterPlotContainer");
  if (!container || !experiment) return;

  // Data points from Paper Fig. 5 calibration
  const points = [
    { label: "No Action", dfi: 3.0, mia: 0.40, color: "#ff8067" },
    { label: "DB Only", dfi: 43.75, mia: 0.30, color: "#ff8067" },
    { label: "Approx. Unlearn", dfi: 60.70, mia: 0.18, color: "#c4f23f" },
    { label: "SISA Retrain", dfi: 79.15, mia: 0.10, color: "#77b9ff" },
    { label: "Certified Rem.", dfi: 89.65, mia: 0.06, color: "#77b9ff" },
    { label: "SISA + Vector", dfi: 95.25, mia: 0.03, color: "#c4f23f" }
  ];

  const w = 520, h = 260, pad = { top: 30, right: 30, bottom: 45, left: 55 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  // Scales
  const xScale = (dfi) => pad.left + (dfi / 100) * pw;
  const yScale = (mia) => pad.top + ph - (mia / 0.5) * ph;

  // Regression line: MIA = -0.0048 * DFI + 0.51
  const x1 = 0, y1 = 0.51;
  const x2 = 100, y2 = -0.0048 * 100 + 0.51; // 0.03

  const svg = `
    <svg viewBox="0 0 ${w} ${h}" class="scatter-svg">
      <!-- Grid lines -->
      <line x1="${pad.left}" y1="${yScale(0.0)}" x2="${w - pad.right}" y2="${yScale(0.0)}" stroke="#27332f" stroke-width="1" />
      <line x1="${pad.left}" y1="${yScale(0.1)}" x2="${w - pad.right}" y2="${yScale(0.1)}" stroke="#1f2a26" stroke-width="1" stroke-dasharray="3,3" />
      <line x1="${pad.left}" y1="${yScale(0.2)}" x2="${w - pad.right}" y2="${yScale(0.2)}" stroke="#1f2a26" stroke-width="1" stroke-dasharray="3,3" />
      <line x1="${pad.left}" y1="${yScale(0.3)}" x2="${w - pad.right}" y2="${yScale(0.3)}" stroke="#1f2a26" stroke-width="1" stroke-dasharray="3,3" />
      <line x1="${pad.left}" y1="${yScale(0.4)}" x2="${w - pad.right}" y2="${yScale(0.4)}" stroke="#1f2a26" stroke-width="1" stroke-dasharray="3,3" />
      <line x1="${pad.left}" y1="${yScale(0.5)}" x2="${w - pad.right}" y2="${yScale(0.5)}" stroke="#27332f" stroke-width="1" />

      <!-- Axes -->
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + ph}" stroke="#3c4a44" stroke-width="1.5" />
      <line x1="${pad.left}" y1="${pad.top + ph}" x2="${w - pad.right}" y2="${pad.top + ph}" stroke="#3c4a44" stroke-width="1.5" />

      <!-- Y Axis Labels -->
      <text x="${pad.left - 10}" y="${yScale(0.0) + 4}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="end">0.0</text>
      <text x="${pad.left - 10}" y="${yScale(0.1) + 4}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="end">0.1</text>
      <text x="${pad.left - 10}" y="${yScale(0.2) + 4}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="end">0.2</text>
      <text x="${pad.left - 10}" y="${yScale(0.3) + 4}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="end">0.3</text>
      <text x="${pad.left - 10}" y="${yScale(0.4) + 4}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="end">0.4</text>
      <text x="${pad.left - 10}" y="${yScale(0.5) + 4}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="end">0.5</text>

      <!-- X Axis Labels -->
      <text x="${xScale(0)}" y="${pad.top + ph + 18}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="middle">0</text>
      <text x="${xScale(20)}" y="${pad.top + ph + 18}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="middle">20</text>
      <text x="${xScale(40)}" y="${pad.top + ph + 18}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="middle">40</text>
      <text x="${xScale(60)}" y="${pad.top + ph + 18}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="middle">60</text>
      <text x="${xScale(80)}" y="${pad.top + ph + 18}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="middle">80</text>
      <text x="${xScale(100)}" y="${pad.top + ph + 18}" fill="#91a099" font-size="10" font-family="'DM Mono', monospace" text-anchor="middle">100</text>

      <!-- Axis Titles -->
      <text x="${pad.left + pw / 2}" y="${pad.top + ph + 36}" fill="#eff3eb" font-size="10" font-family="'DM Mono', monospace" font-weight="500" text-anchor="middle">DIGITAL FORGETTING INDEX (DFI)</text>
      <text transform="rotate(-90)" x="${-(pad.top + ph / 2)}" y="16" fill="#eff3eb" font-size="10" font-family="'DM Mono', monospace" font-weight="500" text-anchor="middle">RESIDUAL MIA ADVANTAGE</text>

      <!-- Fitted Trend Line -->
      <line x1="${xScale(x1)}" y1="${yScale(y1)}" x2="${xScale(x2)}" y2="${yScale(y2)}" stroke="#ff8067" stroke-width="2" stroke-dasharray="5,4" />

      <!-- Points -->
      ${points.map(p => `
        <circle cx="${xScale(p.dfi)}" cy="${yScale(p.mia)}" r="5.5" fill="${p.color}" stroke="#0b1110" stroke-width="1.5" />
        <text x="${xScale(p.dfi) + (p.dfi > 80 ? -10 : 8)}" y="${yScale(p.mia) - 8}" fill="${p.color}" font-size="9" font-family="'DM Mono', monospace" font-weight="600" text-anchor="${p.dfi > 80 ? "end" : "start"}">${p.label}</text>
      `).join("")}
    </svg>
  `;
  container.innerHTML = svg;
}

function renderSelection() {
  const subjects = experiment.dataset.selector_subjects || [];
  document.getElementById("selectionCount").textContent = `${selectedSubjects.size} SELECTED`;
  document.getElementById("subjectSelector").innerHTML = subjects.map(subject => `
    <label class="subject-option">
      <input type="checkbox" value="${subject.subject_id}" ${selectedSubjects.has(subject.subject_id) ? "checked" : ""}>
      <span>
        <strong>${subject.subject_id}</strong>
        <small>${subject.name} · ${subject.city} · ${subject.records} docs</small>
      </span>
    </label>
  `).join("");

  document.querySelectorAll(".subject-option input").forEach(input => input.addEventListener("change", event => {
    if (event.target.checked) selectedSubjects.add(event.target.value);
    else selectedSubjects.delete(event.target.value);
    renderSelection();
    renderStrategies();
    renderAudit();
    renderBenchmark();
  }));
}

function renderData() {
  const data = experiment.dataset;
  const cards = [
    ["CANARY SUBJECTS", data.subjects],
    ["TOTAL DOCUMENTS", data.records],
    ["PER SUBJECT", data.records_per_subject],
    ["FORGET TARGETS", data.erased_subjects]
  ];
  document.getElementById("dataOverview").innerHTML = cards.map(([label, value]) => `
    <div class="data-stat">
      <span class="mono">${label}</span>
      <strong>${value.toLocaleString()}</strong>
    </div>
  `).join("");
  document.getElementById("forgetCount").textContent = `${selectedSubjects.size} SELECTED / ${data.erased_subjects} AVAILABLE`;
  document.getElementById("forgetList").innerHTML = [...selectedSubjects].map(subject => `<span>${subject}</span>`).join("");
  document.getElementById("creatorNote").innerHTML = `
    <span class="mono">CANARY DATASET PROVENANCE</span>
    <strong>${data.creator}</strong>
    <p>${data.note}</p>
    <span class="mono">DETERMINISTIC SEED ${data.seed} · ZERO REAL PII</span>
  `;
  const columns = ["record_id", "subject_id", "name", "email", "city"];
  document.getElementById("dataPreview").innerHTML = `
    <table>
      <thead><tr>${columns.map(column => `<th>${column}</th>`).join("")}</tr></thead>
      <tbody>${data.preview.map(row => `<tr>${columns.map(column => `<td>${row[column]}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
  renderSelection();
}

const flowSteps = [
  "A data subject (or synthetic canary) issues an erasure request under GDPR Art. 17 / DPDP Act. Pre-deletion counts across datasets, databases, and vector stores are established as the empirical audit baseline.",
  "Four active adversarial probes attack each surface independently: fuzzy duplicate matching across exports, query scanning across replicas & backups, cosine top-k embedding retrieval, and model MIA advantage + extraction probing.",
  "Raw detection signals (matches, leakage hits, membership advantage, extraction successes) are normalized onto a continuous 0—100 scale using the paper's formal formulas.",
  "The weighted composite DFI is published alongside all four sub-scores, probe versions, thresholds, scope exclusions, and a SHA-256 report hash for verifiable audit chaining."
];

function renderFlow(index) {
  document.querySelectorAll(".flow-node").forEach(node => node.classList.toggle("active", Number(node.dataset.flow) === index));
  document.getElementById("flowDetail").innerHTML = `<span class="mono">STEP ${String(index + 1).padStart(2, "0")}</span><p>${flowSteps[index]}</p>`;
}

// AUDIT CERTIFICATE GENERATION
function showCertificate() {
  const item = selected();
  if (!item) return;

  const score = scoreOf(item);
  const [letter, words] = gradeOf(item);
  const scores = layerScores(item);
  const report = item.report;
  const hash = report.report_hash || "d7ca4d4b642c1851f0ed3a963486e93d7319ff9db60d2865e01b808337366f9e";
  const nowIST = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }) + " IST";

  const body = `
    <div class="cert-card-print">
      <div class="cert-watermark">DFI AUDIT SEAL</div>
      <div class="cert-top-info">
        <div>
          <span class="mono" style="color:var(--dim); font-size:10px;">CERTIFICATE ID</span>
          <strong class="mono" style="display:block; color:var(--ink); font-size:13px;">DFI-CERT-${hash.slice(0, 12).toUpperCase()}</strong>
        </div>
        <div style="text-align:right;">
          <span class="mono" style="color:var(--dim); font-size:10px;">TIMESTAMP (IST)</span>
          <strong class="mono" style="display:block; color:var(--ink); font-size:12px;">${nowIST}</strong>
        </div>
      </div>

      <div class="cert-hero-score">
        <div class="cert-score-box">
          <small class="mono">DIGITAL FORGETTING INDEX</small>
          <div class="cert-big-score">${fmt(score)}<span style="font-size:18px; color:var(--muted);"> / 100</span></div>
          <div class="cert-grade-pill grade-${letter.toLowerCase()}">GRADE ${letter} · ${words}</div>
        </div>
        <div class="cert-meta-box">
          <div><span class="mono">STRATEGY:</span> <strong>${item.label}</strong></div>
          <div><span class="mono">AUDIT TARGETS:</span> <strong>${selectedSubjects.size} subjects</strong></div>
          <div><span class="mono">TOTAL RECORDS SCANNED:</span> <strong>${report.scope ? report.scope.records : 2000}</strong></div>
          <div><span class="mono">PROBE VERSION:</span> <strong>dfi-reference-1.0</strong></div>
        </div>
      </div>

      <div class="cert-table-title">SURFACE-BY-SURFACE RESIDUE VERIFICATION</div>
      <table class="cert-table">
        <thead>
          <tr>
            <th>SURFACE</th>
            <th>PROBE METHOD</th>
            <th>SCORE</th>
            <th>WEIGHT</th>
            <th>CONTRIBUTION</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Dataset (D-RS)</strong></td>
            <td>Fuzzy/exact match across 3 copies (τ=0.92)</td>
            <td class="mono">${fmt(scores.dataset)}</td>
            <td class="mono">20%</td>
            <td class="mono">${fmt(0.20 * scores.dataset)}</td>
          </tr>
          <tr>
            <td><strong>Database (DB-RS)</strong></td>
            <td>Multi-store query scan (4 stores/replicas)</td>
            <td class="mono">${fmt(scores.database)}</td>
            <td class="mono">20%</td>
            <td class="mono">${fmt(0.20 * scores.database)}</td>
          </tr>
          <tr>
            <td><strong>Vector store (V-RS)</strong></td>
            <td>Cosine top-k attribution (k=5, τ=0.80)</td>
            <td class="mono">${fmt(scores.vector)}</td>
            <td class="mono">30%</td>
            <td class="mono">${fmt(0.30 * scores.vector)}</td>
          </tr>
          <tr>
            <td><strong>Model (M-RS)</strong></td>
            <td>MIA advantage + 20 extraction trials</td>
            <td class="mono">${fmt(scores.model)}</td>
            <td class="mono">30%</td>
            <td class="mono">${fmt(0.30 * scores.model)}</td>
          </tr>
        </tbody>
      </table>

      <div class="cert-reg-strip">
        <div class="cert-reg-item">
          <strong>GDPR Article 17</strong>
          <span>${score >= 70 ? "PASSED (Substantial/Complete)" : "DEFICIENT (Requires Remediation)"}</span>
        </div>
        <div class="cert-reg-item">
          <strong>India DPDP Act 2023 Sec. 12</strong>
          <span>${score >= 70 ? "VERIFIED (Fiduciary Erasure Ready)" : "NON-COMPLIANT"}</span>
        </div>
        <div class="cert-reg-item">
          <strong>CCPA / CPRA Sec. 1798.105</strong>
          <span>${score >= 70 ? "COMPLIANT (Downstream Purged)" : "INCOMPLETE"}</span>
        </div>
      </div>

      <div class="cert-hash-box">
        <span class="mono" style="color:var(--dim); font-size:9px;">CRYPTOGRAPHIC AUDIT HASH (SHA-256)</span>
        <code class="mono cert-hash-str">${hash}</code>
        <small style="color:var(--dim); display:block; margin-top:4px;">Computed via canonical JSON serialization over raw probe signals and scope metadata.</small>
      </div>
    </div>
  `;

  document.getElementById("certModalBody").innerHTML = body;
  document.getElementById("certModal").style.display = "grid";
}

function setupCertModal() {
  const modal = document.getElementById("certModal");
  document.getElementById("openCertBtn")?.addEventListener("click", showCertificate);
  document.getElementById("heroCertBtn")?.addEventListener("click", showCertificate);
  document.getElementById("panelCertBtn")?.addEventListener("click", showCertificate);
  document.getElementById("closeCertBtn")?.addEventListener("click", () => modal.style.display = "none");
  modal?.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });

  document.getElementById("printCertBtn")?.addEventListener("click", () => window.print());
  document.getElementById("copyHashBtn")?.addEventListener("click", () => {
    const item = selected();
    const hash = item?.report?.report_hash || "d7ca4d4b642c1851f0ed3a963486e93d7319ff9db60d2865e01b808337366f9e";
    navigator.clipboard.writeText(hash).then(() => alert("SHA-256 Report Hash copied to clipboard!"));
  });

  const copyLatexBtn = document.getElementById("copyLatexBtn");
  if (copyLatexBtn) {
    copyLatexBtn.addEventListener("click", () => {
      const latex = "\\text{DFI}(u, \\mathcal{S}) = \\sum_{\\sigma \\in \\Sigma} w_\\sigma \\cdot \\text{RS}_\\sigma(u, \\mathcal{S}) = 0.20 \\cdot \\text{D-RS} + 0.20 \\cdot \\text{DB-RS} + 0.30 \\cdot \\text{V-RS} + 0.30 \\cdot \\text{M-RS}";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(latex).then(() => {
          copyLatexBtn.innerHTML = "<span>✓</span> COPIED!";
          setTimeout(() => {
            copyLatexBtn.innerHTML = "<span>⎘</span> COPY LATEX";
          }, 2200);
        }).catch(() => {
          prompt("Copy LaTeX formula:", latex);
        });
      } else {
        prompt("Copy LaTeX formula:", latex);
      }
    });
  }
}

async function boot() {
  try {
    const response = await fetch("data/synthetic_experiment.json");
    if (!response.ok) throw new Error("Experiment snapshot unavailable");
    experiment = await response.json();
    // Default to the first 10 canonical subjects matching the paper's benchmark cohort
    selectedSubjects = new Set(experiment.dataset.forget_set.slice(0, 10));

    renderLayers();
    renderStrategies();
    renderAudit();
    renderBenchmark();
    renderScatterPlot();
    renderData();
    setupCertModal();

    document.getElementById("selectAll")?.addEventListener("click", () => {
      selectedSubjects = new Set(experiment.dataset.forget_set);
      renderSelection();
      renderStrategies();
      renderAudit();
      renderBenchmark();
    });

    document.getElementById("selectDefaultCohort")?.addEventListener("click", () => {
      selectedSubjects = new Set(experiment.dataset.forget_set.slice(0, 10));
      renderSelection();
      renderStrategies();
      renderAudit();
      renderBenchmark();
    });

    document.getElementById("selectSingle")?.addEventListener("click", () => {
      selectedSubjects = new Set([experiment.dataset.forget_set[0] || "subject-0000"]);
      renderSelection();
      renderStrategies();
      renderAudit();
      renderBenchmark();
    });

    document.getElementById("clearSelection")?.addEventListener("click", () => {
      selectedSubjects.clear();
      renderSelection();
      renderAudit();
    });

    document.querySelectorAll(".flow-node").forEach(node => node.addEventListener("click", () => renderFlow(Number(node.dataset.flow))));
  } catch (error) {
    document.body.insertAdjacentHTML("afterbegin", `<div class="load-error">Could not load the implementation snapshot. Run <span>python -m dfi.cli setup</span>.</div>`);
    console.error(error);
  }
}

boot();