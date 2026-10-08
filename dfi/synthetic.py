"""Deterministic synthetic benchmark demonstrating DFI monotonicity."""

from .core import LayerScores, compute_dfi


STRATEGIES = (
    # d/db are forgetting fractions; vector is residual top-k leakage.
    ("no_action", (0, 0, 1.00, 0.40, 1.00)),
    ("database_only", (0.70, 0.70, 0.80, 0.30, 0.75)),
    ("approximate_unlearning", (0.80, 0.78, 0.60, 0.18, 0.50)),
    ("sisa_exact_shard", (0.92, 0.90, 0.35, 0.10, 0.25)),
    ("certified_removal", (0.96, 0.95, 0.15, 0.06, 0.15)),
    ("sisa_plus_vector_purge", (0.97, 0.95, 0.05, 0.03, 0.05)),
)


def run_benchmark() -> list[dict]:
    results = []
    for name, (d, db, vector_leakage, mia_advantage, extraction) in STRATEGIES:
        scores = LayerScores(d * 100, db * 100, (1 - vector_leakage) * 100, 100 * (1 - 0.5 * (min(1, 2 * mia_advantage) + extraction)))
        report = compute_dfi(scores, raw_signals={"synthetic": True, "residual_mia_advantage": mia_advantage})
        results.append({"strategy": name, **report.to_dict()})
    return results
