# Digital Forgetting Index (DFI)

This repository implements the model in `Draft 1.pdf` as an executable, auditable Python reference implementation. It measures a single subject's post-erasure residue across four surfaces:

| Layer | Paper formula implemented | Reference probe |
|---|---|---|
| Dataset | `100 * (1 - N_match / N_total)` | exact/fuzzy record matching over discoverable copies |
| Database | `100 * (1 - R_res / R_orig)` | matching over primary DB, replicas, logs, caches, and backups |
| Vector store | `100 * (1 - I_top-k)` | cosine top-k queries, subject attribution, and threshold |
| Model | `100 * (1 - 0.5 * (A_mia + A_ext))` | normalized MIA advantage plus extraction success rate |

The default composite is `0.20 * D-RS + 0.20 * DB-RS + 0.30 * V-RS + 0.30 * M-RS`. The implementation bounds all layer inputs, records raw probe signals, reports the paper's illustrative governance bands, and creates a SHA-256 report hash for audit chaining.

## Run

Use the bundled Python runtime or any Python 3.10+ environment:

```powershell
python -m dfi.cli benchmark
python -m unittest discover -v
```

The benchmark is deterministic and demonstrates monotonic DFI improvement from no action through database-only deletion, approximate unlearning, SISA-style shard removal, certified removal, and vector purge.

## Concrete synthetic experiment

The project now includes a privacy-safe synthetic dataset generator with 1,000 subjects, 5 records per subject, and 10 erased subjects by default (5,000 records total). It creates dataset and database copies, deterministic one-hot embeddings, subject-derived queries, and model-probe signals. Run:

```powershell
python -m dfi.cli generate-synthetic --output data/synthetic
python -m dfi.cli export-web-data --output website/data
python -m dfi.cli run-experiment --strategy sisa_plus_vector_purge
```

Use `--subjects`, `--records-per-subject`, and `--erased-subjects` to change the experiment size. The generated values are synthetic and contain no real personal information.

The default generated experiment uses:

| Item | Value |
|---|---:|
| Subjects | 1,000 |
| Records per subject | 5 |
| Total records | 5,000 |
| Erased subjects | 10 |
| Dataset copies scanned | 3 |
| Database stores scanned | 4 |
| Vector queries | 10 |
| Vector top-k | 5 |

Stable synthetic subject IDs are used for attribution, deterministic one-hot embeddings make vector retrieval reproducible, and 20 deterministic model extraction trials are evaluated. Strategy retention settings are synthetic experimental controls; they represent different residue levels and are not claims about any specific production unlearning algorithm.

The website reads `website/data/synthetic_experiment.json`, generated from the Python experiment runner. Its default ladder preserves the paper/PPT calibration (3.00, 43.75, 60.70, 79.15, 89.65, 95.25), while the six strategies execute concrete synthetic-surface operations in `dfi/strategies.py`; choosing a custom forget set switches the browser to recomputed live evidence. Rerun `export-web-data` after changing the dataset or strategy implementation.

## Important interpretation

DFI is an empirical lower-bound-style audit score, not proof of deletion and not a differential-privacy guarantee. Results are only meaningful when the auditor documents the scan scope, probe version, thresholds, model/database versions, and measurement time. Production MIA and extraction probes should be supplied by the deployment-specific audit harness; `ModelProbe` accepts their measured outputs rather than pretending a generic black-box model attack is universally valid.
