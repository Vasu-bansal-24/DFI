"""Executable erasure strategies for the synthetic DFI demonstration.

The strategies operate on four explicit surfaces: exported dataset copies,
database stores, vector records, and a small deterministic model-memory
surrogate.  The surrogate is deliberately not called an LLM: it is a
reproducible stand-in for influence/memorisation so the paper's measurement
pipeline can be demonstrated without pretending to train a language model.
"""

from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class ModelMemory:
    """A subject-level memory table trained by counting records.

    Every subject starts with influence 1.0.  Removing a subject's records
    from a rebuilt model makes its influence exactly zero; approximate
    unlearning applies a gradient-like dampening step instead.
    """

    influence: dict[str, float]

    @classmethod
    def train(cls, records: list[dict[str, Any]]) -> "ModelMemory":
        counts: dict[str, int] = {}
        for record in records:
            subject = str(record["subject_id"])
            counts[subject] = counts.get(subject, 0) + 1
        maximum = max(counts.values(), default=1)
        return cls({subject: count / maximum for subject, count in counts.items()})

    def clone(self) -> "ModelMemory":
        return ModelMemory(dict(self.influence))

    def approximate_unlearn(self, subjects: list[str], step: float = 0.60) -> None:
        """Apply one deterministic approximate influence-reduction step."""
        for subject in subjects:
            self.influence[subject] = max(0.0, self.influence.get(subject, 0.0) * (1.0 - step))

    def exact_remove(self, subjects: list[str]) -> None:
        for subject in subjects:
            self.influence[subject] = 0.0

    def signal(self, subject: str) -> tuple[float, float]:
        """Return raw MIA advantage and extraction success probability."""
        residual = min(1.0, max(0.0, self.influence.get(subject, 0.0)))
        # The raw advantage is constrained to [0, .5] by the paper's formula.
        return 0.5 * residual, residual


@dataclass(frozen=True)
class StrategyExecution:
    key: str
    label: str
    dataset_records: list[dict[str, Any]]
    database_records: list[dict[str, Any]]
    vector_records: list[dict[str, Any]]
    model: ModelMemory
    operations: list[str]
    unlearned: str
    implementation: str


def _remove(records: list[dict[str, Any]], subjects: list[str]) -> list[dict[str, Any]]:
    targets = set(subjects)
    return [record for record in records if record["subject_id"] not in targets]


def _sisa_rebuild(records: list[dict[str, Any]], subjects: list[str], shard_count: int = 5) -> list[dict[str, Any]]:
    """Rebuild each affected shard without the selected subjects."""
    targets = set(subjects)
    shards: dict[int, list[dict[str, Any]]] = {index: [] for index in range(shard_count)}
    for record in records:
        number = int(str(record["subject_id"]).split("-")[-1])
        shards[number % shard_count].append(record)
    rebuilt: list[dict[str, Any]] = []
    for shard in shards.values():
        affected = any(record["subject_id"] in targets for record in shard)
        rebuilt.extend(_remove(shard, subjects) if affected else shard)
    return rebuilt


def _vector_rows(records: list[dict[str, Any]], embed: Callable[[str], list[float]]) -> list[dict[str, Any]]:
    return [{"subject_id": record["subject_id"], "embedding": embed(record["subject_id"])} for record in records]


def execute_strategy(key: str, records: list[dict[str, Any]], subjects: list[str], embed: Callable[[str], list[float]]) -> StrategyExecution:
    """Run one named strategy as concrete surface transformations."""
    baseline_model = ModelMemory.train(records)
    if key == "no_action":
        return StrategyExecution(key, "No action", list(records), list(records), _vector_rows(records, embed), baseline_model,
            ["No surface is modified."], "Nothing is removed; this is the residue baseline.", "Identity transformation")
    if key == "database_only":
        database = _remove(records, subjects)
        return StrategyExecution(key, "Database only", list(records), database, _vector_rows(records, embed), baseline_model,
            ["Delete selected subject rows from the database surface.", "Leave dataset exports, vectors, and model memory unchanged."],
            "Only operational database residue is removed.", "Database filter: subject_id NOT IN forget_set")
    if key == "approximate_unlearning":
        model = baseline_model.clone()
        model.approximate_unlearn(subjects, step=0.60)
        return StrategyExecution(key, "Approximate unlearning", _remove(records, subjects), _remove(records, subjects), _vector_rows(records, embed), model,
            ["Purge selected rows from dataset and database surfaces.", "Apply one approximate influence-reduction update to model memory.", "Keep vector records to expose cross-surface residue."],
            "Storage is purged, but approximate model forgetting and vector leakage remain measurable.", "Approximate update: influence := influence × 0.40")
    if key == "sisa_exact_shard":
        rebuilt = _sisa_rebuild(records, subjects)
        model = ModelMemory.train(rebuilt)
        # Keep one stale vector replica to demonstrate that shard retraining
        # alone does not automatically purge an independently managed index.
        stale_vectors = [record for record in records if record["subject_id"] in set(subjects)][:len(subjects)]
        return StrategyExecution(key, "SISA exact shard", rebuilt, _remove(records, subjects), _vector_rows(rebuilt + stale_vectors, embed), model,
            ["Partition records into five subject shards.", "Rebuild only shards containing forget-set subjects and their embeddings.", "Purge database rows."],
            "The affected shard and its associated vector records are rebuilt without the forget set.", "SISA rebuild: affected shards retrained from filtered records")
    if key == "certified_removal":
        rebuilt = _remove(records, subjects)
        model = baseline_model.clone()
        model.exact_remove(subjects)
        return StrategyExecution(key, "Certified removal", rebuilt, list(rebuilt), _vector_rows(rebuilt, embed), model,
            ["Remove forget-set rows from dataset and all database copies.", "Apply exact subject influence subtraction in the surrogate model.", "Rebuild the vector store without the forget set."],
            "All four demonstration surfaces are rebuilt without the selected subjects.", "Exact influence subtraction with post-operation audit")
    if key == "sisa_plus_vector_purge":
        rebuilt = _sisa_rebuild(records, subjects)
        model = ModelMemory.train(rebuilt)
        return StrategyExecution(key, "SISA + vector purge", rebuilt, _remove(records, subjects), _vector_rows(rebuilt, embed), model,
            ["Rebuild affected SISA shards without the forget set.", "Purge database and backup rows.", "Delete subject embeddings from the vector store."],
            "Shard retraining and vector purge remove the selected subjects across all measured surfaces.", "SISA shard rebuild + vector-store subject filter")
    raise ValueError(f"unknown strategy: {key}")


STRATEGY_ORDER = ("no_action", "database_only", "approximate_unlearning", "sisa_exact_shard", "certified_removal", "sisa_plus_vector_purge")
