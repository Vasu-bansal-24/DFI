const labels = { dataset: "D-RS", database: "DB-RS", vector: "V-RS", model: "M-RS" };
let experiment = null;
let currentKey = "sisa_plus_vector_purge";
let selectedSubjects = new Set();

const layerMeta = [
  { index: "01", icon: "⌁", title: "Dataset", text: "Raw files, exports, archives and staging copies. Find exact or near-duplicate records that survived the delete request.", formula: "D-RS = 100 × (1 − Nmatch / Ntotal)" },
  { index: "02", icon: "▦", title: "Database", text: "Primary stores, replicas, logs, caches and backups. The system of record is only one part of the audit surface.", formula: "DB-RS = 100 × (1 − Rres / Rorig)" },
  { index: "03", icon: "✣", title: "Vector store", text: "RAG and semantic-search embeddings. Query the erased subject and measure attributable high-similarity top-k leakage.", formula: "V-RS = 100 × (1 − Itop-k)" },
  { index: "04", icon: "◉", title: "Model", text: "A deterministic subject-influence surrogate for this demo. Combine membership-inference advantage with targeted extraction success.", formula: "M-RS = 100 × (1 − ½(Amia + Aext))" }
];

function fmt(value) { return Number(value).toFixed(2).replace(/\.00$/, ""); }
function grade(value) { return value < 40 ? "E - Non-compliant" : value < 55 ? "D - Weak erasure" : value < 70 ? "C - Partial erasure" : value < 85 ? "B - Strong erasure" : "A - Near-complete erasure"; }
function selected() { return derivedItem(experiment.strategies.find(item => item.key === currentKey)); }
function scoreReport(item) { return item.presentation_report || item.report; }
function scoreOf(item) { return Number(scoreReport(item).dfi); }
function layerScores(item) { return scoreReport(item).scores; }
function gradeOf(item) { const text = scoreReport(item).grade || grade(scoreOf(item)); return [text.slice(0, 1), text.replace(/^[A-E]\s*-\s*/, "").toUpperCase()]; }

function derivedItem(item) {
  if (!item || !selectedSubjects.size) return item;
  const defaultTargets = experiment.dataset.forget_set || [];
  if (selectedSubjects.size === defaultTargets.length && defaultTargets.every(subject => selectedSubjects.has(subject))) return item;
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
  return { ...item, presentation_report: null, report: { ...item.report, dfi, grade: grade(dfi), scores, scope: { ...item.report.scope, subjects: rows.length }, raw_signals: { ...item.report.raw_signals, dataset: { ...item.report.raw_signals.dataset, residual: dResidual, original: dOriginal }, database: { ...item.report.raw_signals.database, residual: dbResidual, original: dbOriginal }, vector: { ...item.report.raw_signals.vector, attributable_hits: vHits, total_top_k_slots: vSlots, queries: rows.length }, model: { ...item.report.raw_signals.model, raw_mia_advantage: mia, normalized_mia_advantage: Math.min(1, 2 * mia), extraction_success: extraction } } } };
}

function renderLayers() { document.getElementById("layerGrid").innerHTML = layerMeta.map(layer => `<article class="layer-card"><div class="layer-index">${layer.index} / 04</div><div class="layer-icon">${layer.icon}</div><h3>${layer.title}</h3><p>${layer.text}</p><div class="layer-formula">${layer.formula}</div></article>`).join(""); }

function renderHero(item) {
  const score = scoreOf(item), [letter, words] = gradeOf(item), scores = layerScores(item);
  document.getElementById("heroScore").textContent = fmt(score); document.getElementById("heroGrade").textContent = words; document.getElementById("heroRing").style.setProperty("--score", score); document.querySelector(".grade-tag").textContent = letter;
  document.getElementById("heroLayers").innerHTML = Object.entries(scores).map(([key, value]) => `<div class="mini-row"><span>${labels[key]}</span><span class="mini-track"><span class="mini-fill" style="width:${value}%"></span></span><span>${fmt(value)}</span></div>`).join("");
}

function renderStrategyDetail(item) {
  const evidence = item.evidence, residual = item.report.raw_signals, ops = evidence.operations || [];
  document.getElementById("strategyDetail").innerHTML = `<div class="detail-head"><span class="panel-kicker">WHAT CHANGED IN THIS RUN</span><span class="detail-target">${evidence.unlearned}</span></div><div class="detail-grid"><div><small>RESIDUAL RECORDS</small><strong>${residual.dataset.residual} / ${residual.dataset.original}</strong><span>dataset copies</span></div><div><small>DB RESIDUAL</small><strong>${residual.database.residual} / ${residual.database.original}</strong><span>stores + replicas</span></div><div><small>VECTOR LEAKAGE</small><strong>${residual.vector.attributable_hits} / ${residual.vector.total_top_k_slots}</strong><span>top-k slots</span></div><div><small>MODEL SIGNAL</small><strong>${fmt(residual.model.normalized_mia_advantage * 100)}%</strong><span>MIA advantage</span></div></div><div class="operation-list"><small>EXECUTED OPERATIONS</small>${ops.map(op => `<span>+ ${op}</span>`).join("")}</div><div class="parameter-row"><span>IMPLEMENTATION</span><span class="mono">${evidence.implementation}</span></div><div class="parameter-row"><span>MODEL SCOPE</span><span class="mono">${evidence.model_note}</span></div>`;
}

function renderAudit() {
  if (!selectedSubjects.size) {
    document.getElementById("auditScore").textContent = "—";
    document.getElementById("formulaResult").textContent = "—";
    document.getElementById("auditGrade").textContent = "SELECT TARGETS";
    document.getElementById("strategyDetail").innerHTML = `<div class="detail-head"><span class="panel-kicker">WAITING FOR A FORGET SET</span><span class="detail-target">Select at least one synthetic subject in the data selector to run the DFI measurement.</span></div>`;
    return;
  }
  const item = selected(); if (!item) return;
  const score = scoreOf(item), [letter, words] = gradeOf(item), scores = layerScores(item);
  document.getElementById("auditScore").textContent = fmt(score); document.getElementById("formulaResult").textContent = fmt(score); document.getElementById("auditGrade").textContent = `${letter} · ${words}`;
  document.getElementById("barChart").innerHTML = Object.entries(scores).map(([layer, value]) => `<div class="bar-row"><label>${labels[layer]}</label><span class="bar-track"><span class="bar-fill" style="width:${value}%"></span></span><output>${fmt(value)}</output></div>`).join("");
  document.querySelectorAll(".strategy-option").forEach(option => option.classList.toggle("active", option.dataset.strategy === currentKey)); renderStrategyDetail(item); renderHero(item);
}

function renderStrategies() {
  document.getElementById("strategyList").innerHTML = experiment.strategies.map((item, index) => { const live = derivedItem(item); return `<button class="strategy-option ${item.key === currentKey ? "active" : ""}" data-strategy="${item.key}"><b>${String(index + 1).padStart(2, "0")} / ${item.label}</b><span>${fmt(scoreOf(live))}</span></button>`; }).join("");
  document.querySelectorAll(".strategy-option").forEach(option => option.addEventListener("click", () => { currentKey = option.dataset.strategy; renderStrategies(); renderAudit(); }));
}

function renderBenchmark() {
  document.getElementById("benchmarkChart").innerHTML = experiment.strategies.map(item => { const live = derivedItem(item); return `<div class="benchmark-col"><span class="benchmark-value">${fmt(scoreOf(live))}</span><span class="benchmark-bar" style="height:${scoreOf(live)}%"></span><span class="benchmark-name">${item.label}</span></div>`; }).join("");
  document.getElementById("evidenceTable").innerHTML = `<div class="evidence-row head"><span>STRATEGY</span><span class="score">DFI</span><span class="grade">BAND</span></div>` + experiment.strategies.map(item => { const live = derivedItem(item), [letter, words] = gradeOf(live); return `<div class="evidence-row"><span>${item.label}</span><span class="score">${fmt(scoreOf(live))}</span><span class="grade">${letter} · ${words.split(" ")[0]}</span></div>`; }).join("");
}

function renderSelection() {
  const subjects = experiment.dataset.selector_subjects || [];
  document.getElementById("selectionCount").textContent = `${selectedSubjects.size} SELECTED`;
  document.getElementById("subjectSelector").innerHTML = subjects.map(subject => `<label class="subject-option"><input type="checkbox" value="${subject.subject_id}" ${selectedSubjects.has(subject.subject_id) ? "checked" : ""}><span><strong>${subject.subject_id}</strong><small>${subject.name} · ${subject.city} · ${subject.records} records</small></span></label>`).join("");
  document.querySelectorAll(".subject-option input").forEach(input => input.addEventListener("change", event => { if (event.target.checked) selectedSubjects.add(event.target.value); else selectedSubjects.delete(event.target.value); renderSelection(); renderStrategies(); renderAudit(); renderBenchmark(); }));
}

function renderData() {
  const data = experiment.dataset; const cards = [["SUBJECTS", data.subjects], ["RECORDS", data.records], ["PER SUBJECT", data.records_per_subject], ["ERASED TARGETS", data.erased_subjects]];
  document.getElementById("dataOverview").innerHTML = cards.map(([label, value]) => `<div class="data-stat"><span class="mono">${label}</span><strong>${value.toLocaleString()}</strong></div>`).join("");
  document.getElementById("forgetCount").textContent = `${selectedSubjects.size} SELECTED / ${data.erased_subjects} AVAILABLE`; document.getElementById("forgetList").innerHTML = [...selectedSubjects].map(subject => `<span>${subject}</span>`).join("");
  document.getElementById("creatorNote").innerHTML = `<span class="mono">DATASET PROVENANCE</span><strong>${data.creator}</strong><p>${data.note}</p><span class="mono">SEED ${data.seed}</span>`;
  const columns = ["record_id", "subject_id", "name", "email", "city"]; document.getElementById("dataPreview").innerHTML = `<table><thead><tr>${columns.map(column => `<th>${column}</th>`).join("")}</tr></thead><tbody>${data.preview.map(row => `<tr>${columns.map(column => `<td>${row[column]}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  renderSelection();
}

const flowSteps = ["A data subject, or synthetic canary, becomes the audit target. The baseline is fixed before deletion so the denominator is evidence — not an assumption.", "Four probes search the dataset, database, vector store, and model. Each surface gets a probe that matches its failure mode.", "Raw matches, leakage hits, membership advantage, and extraction success are normalized onto a common 0—100 forgetting scale.", "The weighted composite is reported with sub-scores, probe versions, scope, thresholds, and timestamps so an auditor can reproduce it."];
function renderFlow(index) { document.querySelectorAll(".flow-node").forEach(node => node.classList.toggle("active", Number(node.dataset.flow) === index)); document.getElementById("flowDetail").innerHTML = `<span class="mono">STEP ${String(index + 1).padStart(2, "0")}</span><p>${flowSteps[index]}</p>`; }

async function boot() {
  try {
    const response = await fetch("data/synthetic_experiment.json"); if (!response.ok) throw new Error("Experiment snapshot unavailable"); experiment = await response.json(); selectedSubjects = new Set(experiment.dataset.forget_set);
    renderLayers(); renderStrategies(); renderAudit(); renderBenchmark(); renderData();
    document.getElementById("selectAll").addEventListener("click", () => { selectedSubjects = new Set(experiment.dataset.forget_set); renderData(); renderStrategies(); renderAudit(); renderBenchmark(); });
    document.getElementById("clearSelection").addEventListener("click", () => { selectedSubjects.clear(); renderSelection(); });
    document.querySelectorAll(".flow-node").forEach(node => node.addEventListener("click", () => renderFlow(Number(node.dataset.flow))));
  } catch (error) { document.body.insertAdjacentHTML("afterbegin", `<div class="load-error">Could not load the implementation snapshot. Run <span>python -m dfi.cli export-web-data --output website/data</span>.</div>`); console.error(error); }
}
boot();
