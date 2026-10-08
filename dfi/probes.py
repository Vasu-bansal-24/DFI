"""Reference probes for dataset, database, vector, and model surfaces."""

from dataclasses import dataclass
from difflib import SequenceMatcher
import math
from typing import Iterable, Mapping, Sequence

from .core import dataset_residue_score, database_residue_score, model_residue_score, vector_residue_score


def _canonical(record: Mapping[str, object], fields: Sequence[str]) -> str:
    return "|".join(str(record.get(f, "")).strip().casefold() for f in fields)


def count_subject_matches(records: Iterable[Mapping[str, object]], subject: Mapping[str, object], fields: Sequence[str], fuzzy_threshold: float = 0.92) -> int:
    target = _canonical(subject, fields)
    def matches(record: Mapping[str, object]) -> bool:
        # A stable subject identifier is a hard attribution key. Fuzzy matching
        # applies to descriptive fields, not to neighboring IDs such as 0001/0002.
        if "subject_id" in fields and record.get("subject_id") != subject.get("subject_id"):
            return False
        return SequenceMatcher(None, target, _canonical(record, fields)).ratio() >= fuzzy_threshold
    return sum(1 for record in records if matches(record))


@dataclass(frozen=True)
class DatasetProbe:
    subject_fields: tuple[str, ...]
    fuzzy_threshold: float = 0.92

    def run(self, copies: Mapping[str, Iterable[Mapping[str, object]]], subject: Mapping[str, object], original_count: int) -> tuple[float, dict]:
        per_copy = {name: count_subject_matches(rows, subject, self.subject_fields, self.fuzzy_threshold) for name, rows in copies.items()}
        residual = sum(per_copy.values())
        return dataset_residue_score(residual, original_count), {"residual": residual, "original": original_count, "per_copy": per_copy, "fuzzy_threshold": self.fuzzy_threshold}


@dataclass(frozen=True)
class DatabaseProbe:
    subject_fields: tuple[str, ...]
    fuzzy_threshold: float = 0.92

    def run(self, stores: Mapping[str, Iterable[Mapping[str, object]]], subject: Mapping[str, object], original_count: int) -> tuple[float, dict]:
        per_store = {name: count_subject_matches(rows, subject, self.subject_fields, self.fuzzy_threshold) for name, rows in stores.items()}
        residual = sum(per_store.values())
        return database_residue_score(residual, original_count), {"residual": residual, "original": original_count, "per_store": per_store, "fuzzy_threshold": self.fuzzy_threshold}


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b):
        raise ValueError("embedding dimensions differ")
    denom = math.sqrt(sum(x*x for x in a) * sum(y*y for y in b))
    return sum(x*y for x, y in zip(a, b)) / denom if denom else 0.0


@dataclass(frozen=True)
class VectorProbe:
    k: int = 5
    similarity_threshold: float = 0.80

    def run(self, vectors: Sequence[Mapping[str, object]], query_embeddings: Sequence[Sequence[float]], subject_id: str) -> tuple[float, dict]:
        if self.k <= 0 or not query_embeddings:
            raise ValueError("k and query_embeddings must be positive/non-empty")
        hits = 0
        details = []
        for query in query_embeddings:
            ranked = sorted(((cosine(query, item["embedding"]), item) for item in vectors), key=lambda x: x[0], reverse=True)[: self.k]
            query_hits = sum(1 for sim, item in ranked if sim >= self.similarity_threshold and item.get("subject_id") == subject_id)
            hits += query_hits
            details.append({"top_k": len(ranked), "attributable_hits": query_hits, "similarities": [round(sim, 6) for sim, _ in ranked]})
        total = len(query_embeddings) * self.k
        return vector_residue_score(hits, total), {"attributable_hits": hits, "total_top_k_slots": total, "queries": len(query_embeddings), "k": self.k, "similarity_threshold": self.similarity_threshold, "details": details}


@dataclass(frozen=True)
class ModelProbe:
    def run(self, raw_mia_advantage: float, extraction_successes: Sequence[bool]) -> tuple[float, dict]:
        if not extraction_successes:
            raise ValueError("at least one extraction attempt is required")
        extraction_rate = sum(extraction_successes) / len(extraction_successes)
        score = model_residue_score(raw_mia_advantage, extraction_rate)
        return score, {"raw_mia_advantage": raw_mia_advantage, "normalized_mia_advantage": min(1.0, 2.0 * raw_mia_advantage), "extraction_success": extraction_rate, "attempts": len(extraction_successes)}
