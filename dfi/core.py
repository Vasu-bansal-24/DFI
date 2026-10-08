"""Paper-faithful DFI formulas and auditable report objects."""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Mapping

DEFAULT_WEIGHTS = {"dataset": 0.20, "database": 0.20, "vector": 0.30, "model": 0.30}


def _bounded(value: float, name: str) -> float:
    if not 0 <= value <= 100:
        raise ValueError(f"{name} must be in [0, 100], got {value}")
    return float(value)


def _ratio_score(residual: int, original: int, name: str) -> float:
    if original <= 0:
        raise ValueError(f"{name}: original count must be positive")
    if residual < 0 or residual > original:
        raise ValueError(f"{name}: residual count must be in [0, original]")
    return 100.0 * (1.0 - residual / original)


@dataclass(frozen=True)
class LayerScores:
    dataset: float
    database: float
    vector: float
    model: float

    def __post_init__(self) -> None:
        for name, value in asdict(self).items():
            _bounded(value, name)


@dataclass
class DFIReport:
    scores: LayerScores
    dfi: float
    grade: str
    weights: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    probe_version: str = "dfi-reference-1.0"
    measured_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    scope: dict[str, Any] = field(default_factory=dict)
    raw_signals: dict[str, Any] = field(default_factory=dict)
    previous_hash: str | None = None
    report_hash: str | None = None

    def finalize(self) -> "DFIReport":
        payload = self.to_dict(include_hash=False)
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        self.report_hash = hashlib.sha256(encoded).hexdigest()
        return self

    def to_dict(self, include_hash: bool = True) -> dict[str, Any]:
        data = asdict(self)
        data["scores"] = asdict(self.scores)
        if not include_hash:
            data.pop("report_hash", None)
        return data


def grade_dfi(value: float) -> str:
    """Illustrative governance bands described in the paper."""
    if value < 40:
        return "E - Non-compliant"
    if value < 55:
        return "D - Weak erasure"
    if value < 70:
        return "C - Partial erasure"
    if value < 85:
        return "B - Strong erasure"
    return "A - Near-complete erasure"


def compute_dfi(
    scores: LayerScores,
    weights: Mapping[str, float] | None = None,
    *,
    probe_version: str = "dfi-reference-1.0",
    scope: dict[str, Any] | None = None,
    raw_signals: dict[str, Any] | None = None,
    previous_hash: str | None = None,
) -> DFIReport:
    weights = dict(DEFAULT_WEIGHTS if weights is None else weights)
    if set(weights) != set(DEFAULT_WEIGHTS) or abs(sum(weights.values()) - 1.0) > 1e-9:
        raise ValueError("weights must contain dataset/database/vector/model and sum to 1")
    if any(v < 0 for v in weights.values()):
        raise ValueError("weights must be non-negative")
    values = {"dataset": scores.dataset, "database": scores.database, "vector": scores.vector, "model": scores.model}
    dfi = sum(weights[k] * values[k] for k in values)
    return DFIReport(scores, dfi, grade_dfi(dfi), weights, probe_version,
                     scope=scope or {}, raw_signals=raw_signals or {}, previous_hash=previous_hash).finalize()


def dataset_residue_score(residual: int, original: int) -> float:
    return _ratio_score(residual, original, "dataset")


def database_residue_score(residual: int, original: int) -> float:
    return _ratio_score(residual, original, "database")


def vector_residue_score(attributable_hits: int, total_top_k_slots: int) -> float:
    if total_top_k_slots <= 0 or not 0 <= attributable_hits <= total_top_k_slots:
        raise ValueError("vector hit counts must satisfy 0 <= hits <= positive total")
    return 100.0 * (1.0 - attributable_hits / total_top_k_slots)


def model_residue_score(raw_mia_advantage: float, extraction_success: float) -> float:
    """Compute M-RS; raw MIA advantage is normalized as A_mia=clip(2*raw,0,1)."""
    if not 0 <= raw_mia_advantage <= 0.5:
        raise ValueError("raw MIA advantage must be in [0, 0.5]")
    if not 0 <= extraction_success <= 1:
        raise ValueError("extraction success must be in [0, 1]")
    a_mia = min(1.0, max(0.0, 2.0 * raw_mia_advantage))
    return 100.0 * (1.0 - 0.5 * (a_mia + extraction_success))
