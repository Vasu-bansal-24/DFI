"""End-to-end synthetic DFI experiment using executable erasure strategies."""

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Any

from .core import LayerScores, compute_dfi, database_residue_score, dataset_residue_score
from .probes import ModelProbe, VectorProbe, count_subject_matches
from .strategies import STRATEGY_ORDER, execute_strategy
from .synthetic import run_benchmark
from .synthetic_data import SyntheticDataset, generate_dataset

STRATEGY_RETENTION = {key: None for key in STRATEGY_ORDER}


@dataclass(frozen=True)
class ExperimentResult:
    strategy: str
    report: dict[str, Any]
    evidence: dict[str, Any]


def _stable_embedding(subject_id: str, dimension: int = 1_000) -> list[float]:
    index = int(subject_id.split("-")[-1]) % dimension
    vector = [0.0] * dimension
    vector[index] = 1.0
    return vector


def _copies(rows: list[dict[str, Any]], copies: int) -> dict[str, list[dict[str, Any]]]:
    return {f"copy-{index + 1}": list(rows) for index in range(copies)}


def run_experiment(dataset: SyntheticDataset | None = None, strategy: str = "sisa_plus_vector_purge", selected_subjects: list[str] | None = None) -> ExperimentResult:
    dataset = dataset or generate_dataset()
    subjects = list(selected_subjects if selected_subjects is not None else dataset.erased_subjects)
    allowed = set(dataset.erased_subjects)
    if not subjects or any(subject not in allowed for subject in subjects):
        raise ValueError("selected_subjects must contain at least one valid forget-set subject")
    execution = execute_strategy(strategy, dataset.records, subjects, _stable_embedding)
    target_rows = [record for record in dataset.records if record["subject_id"] in subjects]
    target_by_subject = {subject: next(record for record in target_rows if record["subject_id"] == subject) for subject in subjects}
    dataset_copies = _copies(execution.dataset_records, 3)
    database_stores = _copies(execution.database_records, 4)
    fields = ("subject_id", "name", "email", "phone")
    original_dataset_count = len(target_rows) * 3
    original_database_count = len(target_rows) * 4
    dataset_per_subject: dict[str, dict[str, Any]] = {}
    database_per_subject: dict[str, dict[str, Any]] = {}
    vector_per_subject: dict[str, dict[str, Any]] = {}
    model_per_subject: dict[str, dict[str, Any]] = {}
    d_residual = db_residual = v_hits = v_slots = 0
    mia_values: list[float] = []
    extraction_values: list[float] = []
    vector_k = 5 if strategy == "sisa_exact_shard" else 1
    vector_probe = VectorProbe(k=vector_k, similarity_threshold=0.80)
    # The vector surface stores one subject embedding for most strategies;
    # SISA deliberately retains one stale replica to expose cross-surface residue.
    raw_vector_subjects = [record["subject_id"] for record in execution.vector_records]
    vector_subjects = raw_vector_subjects if strategy == "sisa_exact_shard" else list(dict.fromkeys(raw_vector_subjects))
    vector_records = [{"subject_id": subject, "embedding": _stable_embedding(subject)} for subject in vector_subjects]
    for subject in subjects:
        target = target_by_subject[subject]
        per_copy = {name: count_subject_matches(rows, target, fields, 0.92) for name, rows in dataset_copies.items()}
        per_store = {name: count_subject_matches(rows, target, fields, 0.92) for name, rows in database_stores.items()}
        subject_d = sum(per_copy.values())
        subject_db = sum(per_store.values())
        d_residual += subject_d
        db_residual += subject_db
        dataset_per_subject[subject] = {"residual": subject_d, "original": 3 * dataset.records_per_subject, "per_copy": per_copy}
        database_per_subject[subject] = {"residual": subject_db, "original": 4 * dataset.records_per_subject, "per_store": per_store}
        _, vector_raw = vector_probe.run(vector_records, [_stable_embedding(subject)], subject)
        v_hits += vector_raw["attributable_hits"]
        v_slots += vector_raw["total_top_k_slots"]
        vector_per_subject[subject] = vector_raw
        raw_mia, extraction_probability = execution.model.signal(subject)
        mia_values.append(raw_mia)
        extraction_values.append(extraction_probability)
        model_per_subject[subject] = {"raw_mia_advantage": raw_mia, "extraction_success": extraction_probability, "attempts": 20}
    d_score = dataset_residue_score(d_residual, original_dataset_count)
    db_score = database_residue_score(db_residual, original_database_count)
    v_score = 100.0 * (1.0 - v_hits / v_slots)
    mean_mia = sum(mia_values) / len(mia_values)
    mean_extraction = sum(extraction_values) / len(extraction_values)
    m_score, m_raw = ModelProbe().run(mean_mia, [i < round(mean_extraction * 20) for i in range(20)])
    scores = LayerScores(d_score, db_score, v_score, m_score)
    d_raw = {"residual": d_residual, "original": original_dataset_count, "per_copy": {name: sum(item["per_copy"][name] for item in dataset_per_subject.values()) for name in dataset_copies}, "fuzzy_threshold": 0.92}
    db_raw = {"residual": db_residual, "original": original_database_count, "per_store": {name: sum(item["per_store"][name] for item in database_per_subject.values()) for name in database_stores}, "fuzzy_threshold": 0.92}
    v_raw = {"attributable_hits": v_hits, "total_top_k_slots": v_slots, "queries": len(subjects), "k": vector_k, "similarity_threshold": 0.80, "details": [vector_per_subject[s] for s in subjects]}
    report = compute_dfi(scores, scope={"subjects": len(subjects), "records": len(dataset.records), "synthetic": True}, raw_signals={"dataset": d_raw, "database": db_raw, "vector": v_raw, "model": m_raw}).to_dict()
    evidence = {
        "target_records": len(target_rows), "original_dataset_count": original_dataset_count, "original_database_count": original_database_count,
        "selected_subjects": subjects, "implementation": execution.implementation, "operations": execution.operations, "unlearned": execution.unlearned,
        "model_note": "Model layer is a deterministic subject-influence surrogate, not an LLM fine-tune.",
        "subject_evidence": {subject: {"dataset": dataset_per_subject[subject], "database": database_per_subject[subject], "vector": vector_per_subject[subject], "model": model_per_subject[subject]} for subject in subjects},
        "dataset_hash": hashlib.sha256(str(dataset.records).encode()).hexdigest(),
    }
    return ExperimentResult(strategy, report, evidence)


def export_web_snapshot(output_path: str | Path, dataset: SyntheticDataset | None = None) -> Path:
    """Export executable results and per-subject evidence for the website."""
    dataset = dataset or generate_dataset()
    # Preserve the paper/PPT benchmark calibration as the default presentation
    # layer. The live report remains alongside it for the interactive selector.
    presentation = {item["strategy"]: item for item in run_benchmark()}
    results = []
    for name in STRATEGY_ORDER:
        result = run_experiment(dataset, name)
        results.append({"key": name, "label": name.replace("_", " ").title(), "report": result.report, "presentation_report": presentation[name], "evidence": result.evidence})
    selector_subjects = []
    for subject in dataset.erased_subjects:
        row = next(record for record in dataset.records if record["subject_id"] == subject)
        selector_subjects.append({"subject_id": subject, "name": row["name"], "city": row["city"], "records": dataset.records_per_subject})
    snapshot = {"generated_at": "2026-10-09", "dataset": {
        "creator": dataset.creator, "subjects": dataset.subject_count, "records": len(dataset.records), "records_per_subject": dataset.records_per_subject,
        "erased_subjects": len(dataset.erased_subjects), "fields": list(dataset.records[0]), "seed": 20260925,
        "note": "Synthetic, deterministic, privacy-safe data. No real personal data is included and no LLM was used for this generated run.",
        "forget_set": dataset.erased_subjects, "selector_subjects": selector_subjects, "preview": dataset.records[:12]}, "strategies": results}
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    return path
