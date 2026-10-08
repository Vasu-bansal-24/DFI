"""Deterministic, privacy-safe synthetic data for DFI experiments."""

from dataclasses import dataclass
import csv
import json
from pathlib import Path
import random
from typing import Any


DEFAULT_SUBJECTS = 1_000
DEFAULT_RECORDS_PER_SUBJECT = 5
DEFAULT_ERASED_SUBJECTS = 10
DATASET_CREATOR = "Deterministic Python generator (no LLM used)"


@dataclass(frozen=True)
class SyntheticDataset:
    records: list[dict[str, Any]]
    erased_subjects: list[str]
    records_per_subject: int
    creator: str = DATASET_CREATOR

    @property
    def subject_count(self) -> int:
        return len({r["subject_id"] for r in self.records})


def generate_dataset(
    subjects: int = DEFAULT_SUBJECTS,
    records_per_subject: int = DEFAULT_RECORDS_PER_SUBJECT,
    erased_subjects: int = DEFAULT_ERASED_SUBJECTS,
    seed: int = 20260925,
    creator: str = DATASET_CREATOR,
) -> SyntheticDataset:
    if subjects <= 0 or records_per_subject <= 0 or not 0 <= erased_subjects <= subjects:
        raise ValueError("subjects and records_per_subject must be positive; erased_subjects must be in range")
    rng = random.Random(seed)
    records = []
    for subject_number in range(subjects):
        subject_id = f"subject-{subject_number:04d}"
        for record_number in range(records_per_subject):
            records.append({
                "record_id": f"{subject_id}-record-{record_number:02d}",
                "subject_id": subject_id,
                "name": f"Synthetic User {subject_number:04d}",
                "email": f"user{subject_number:04d}@example.test",
                "phone": f"+91-90000-{subject_number:04d}",
                "city": ["Mohali", "Delhi", "Pune", "Bengaluru", "Jaipur"][subject_number % 5],
                "text": f"Synthetic profile {subject_number:04d}; record variant {record_number}; seed {seed}.",
                "canary": rng.randint(100000, 999999),
            })
    targets = [f"subject-{i:04d}" for i in range(erased_subjects)]
    return SyntheticDataset(records, targets, records_per_subject, creator)


def write_dataset(dataset: SyntheticDataset, output_dir: str | Path) -> dict[str, str]:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    csv_path = output / "synthetic_records.csv"
    target_path = output / "erased_subjects.json"
    manifest_path = output / "manifest.json"
    fields = list(dataset.records[0])
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(dataset.records)
    target_path.write_text(json.dumps(dataset.erased_subjects, indent=2), encoding="utf-8")
    manifest = {
        "subjects": dataset.subject_count,
        "records": len(dataset.records),
        "records_per_subject": dataset.records_per_subject,
        "erased_subjects": len(dataset.erased_subjects),
        "synthetic": True,
        "privacy_note": "All values are generated; no real personal data is included.",
        "creator": dataset.creator,
        "seed": 20260925,
        "fields": fields,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return {"records": str(csv_path), "targets": str(target_path), "manifest": str(manifest_path)}
