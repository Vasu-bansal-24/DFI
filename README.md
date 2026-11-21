# Digital Forgetting Index (DFI)

This repository is the official reference implementation of the paper:
> **Digital Forgetting Index: A Quantifiable Framework for Measuring AI Data Erasure**  
> *Aditi Shukla, Vasu Bansal, Richa Tiwari* — AIT-CSE (AI & ML), Chandigarh University, Punjab, India.

It measures a data subject's post-erasure residue across four surfaces defined in Section IV-C:

| Layer | Paper Formula | Measurement Probe | Default Weight |
|---|---|---|:---:|
| **Dataset (D-RS)** | $100 \times (1 - N_{match} / N_{total})$ | Exact/fuzzy record scan across discoverable copies | 20% |
| **Database (DB-RS)** | $100 \times (1 - R_{res} / R_{orig})$ | Exact match across primary DB, replicas, logs, caches, backups | 20% |
| **Vector Store (V-RS)** | $100 \times (1 - I_{top-k})$ | Cosine top-$k$ queries, subject attribution above threshold $\tau$ | 30% |
| **Model (M-RS)** | $100 \times (1 - 0.5 \times (A_{mia} + A_{ext}))$ | Normalized MIA attack signal + targeted extraction success rate | 30% |

$$\text{DFI} = 0.20 \cdot D\text{-}RS + 0.20 \cdot DB\text{-}RS + 0.30 \cdot V\text{-}RS + 0.30 \cdot M\text{-}RS$$

### Governance Grading Bands (Paper Figure 3)

| Band | Score Range | Governance Interpretation |
|:---:|:---:|---|
| **A** | 85 – 100 | Near-Complete Erasure |
| **B** | 70 – 84 | Substantial Erasure |
| **C** | 55 – 69 | Partial Erasure |
| **D** | 40 – 54 | Weak Erasure |
| **F** | 0 – 39 | Non-Compliant |

---

## Quick Start (1–2 Commands)

Run the live demo directly in your terminal:

```powershell
python -m dfi.cli demo
```
This runs the full 6-strategy benchmark, verifies the Table III worked example (95.25), checks the Fig. 5 MIA-vs-DFI inverse relationship, and outputs the cryptographic SHA-256 audit hash.

To regenerate synthetic data and prepare the interactive website:

```powershell
python -m dfi.cli setup
```
Then open `website/index.html` in any web browser.

---

## Testing & Verification

Run the full automated test suite:

```powershell
python -m unittest discover -v
```

All 10 unit tests verify mathematical bounds, probe counts, Table III worked example (95.25), and cross-surface erasure monotonicity.

---

## Synthetic Canary Dataset (Paper Section IV-G)

In accordance with Section IV-G of the paper, the benchmark is validated on a privacy-safe canary dataset constructed with:

| Item | Value | Paper Reference |
|---|---:|---|
| Subjects | 500 | Section IV-G |
| Documents / Records per subject | 4 | Section IV-G |
| Total documents | 2,000 | Section IV-G |
| Erased subjects (canonical / pool) | 10 default cohort / 30 candidate targets | Section IV-G |
| Dataset copies scanned | 3 | Section IV-C.1 |
| Database stores scanned | 4 | Section IV-C.2 |
| Vector similarity threshold ($\tau$) | 0.80 | Section IV-C.3 |
| Vector top-$k$ | 5 | Section IV-C.3 |
| Model extraction attempts | 20 | Section IV-C.4 |

Deterministic IDs and embeddings ensure 100% reproducible audit hashes.

---

## Auditability & Integrity

Every evaluation produces a tamper-evident `DFIReport` containing:
- Composite score + all 4 sub-scores
- Raw probe signals (records scanned, hits, MIA advantage, extraction successes)
- Scope metadata (subject count, document count)
- Audit timestamp (UTC ISO format)
- Deterministic SHA-256 report hash for audit trail chaining (`previous_hash`)
