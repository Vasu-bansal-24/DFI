import argparse
import json
from pathlib import Path
from .core import LayerScores, compute_dfi, grade_dfi
from .synthetic import run_benchmark, STRATEGIES
from .synthetic_data import generate_dataset, write_dataset, DEFAULT_SUBJECTS, DEFAULT_RECORDS_PER_SUBJECT, DEFAULT_ERASED_SUBJECTS
from .experiment import STRATEGY_RETENTION, export_web_snapshot, run_experiment


def _box_table(headers: list[str], rows: list[list[str]]) -> str:
    """Render a table with Unicode box-drawing characters."""
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    top = "┌" + "┬".join("─" * (w + 2) for w in widths) + "┐"
    mid = "├" + "┼".join("─" * (w + 2) for w in widths) + "┤"
    bot = "└" + "┴".join("─" * (w + 2) for w in widths) + "┘"
    def fmt(cells: list[str]) -> str:
        return "│" + "│".join(f" {c:<{widths[i]}} " for i, c in enumerate(cells)) + "│"
    lines = [top, fmt(headers), mid]
    for row in rows:
        lines.append(fmt(row))
    lines.append(bot)
    return "\n".join(lines)


def _demo() -> None:
    """One-command live presentation: generate data, run all strategies, verify paper values."""
    print("=" * 72)
    print("  Digital Forgetting Index (DFI) — Live Demo")
    print("  Paper: Draft 1.pdf  |  Section IV-G defaults")
    print("=" * 72)
    print()

    # Generate synthetic dataset with paper defaults
    print(f"▶ Generating synthetic dataset: {DEFAULT_SUBJECTS} subjects, "
          f"{DEFAULT_RECORDS_PER_SUBJECT} records each, {DEFAULT_ERASED_SUBJECTS} erased")
    dataset = generate_dataset()
    print(f"  ✓ {dataset.subject_count} subjects, {len(dataset.records)} total records\n")

    # Run benchmark (all 6 strategies)
    print("▶ Running all 6 erasure strategies…\n")
    results = run_benchmark()

    headers = ["Strategy", "D-RS", "DB-RS", "V-RS", "M-RS", "DFI", "Grade"]
    rows = []
    best = None
    for item in results:
        s = item["scores"]
        row = [
            item["strategy"].replace("_", " "),
            f"{s['dataset']:.1f}",
            f"{s['database']:.1f}",
            f"{s['vector']:.1f}",
            f"{s['model']:.1f}",
            f"{item['dfi']:.2f}",
            item["grade"],
        ]
        rows.append(row)
        if best is None or item["dfi"] > best["dfi"]:
            best = item
    print(_box_table(headers, rows))
    print()

    # Paper Table III worked example verification
    print("─" * 72)
    print("  Paper Table III — Worked Example Verification")
    print("─" * 72)
    table3_scores = LayerScores(97, 95, 95, 94.5)
    table3_report = compute_dfi(table3_scores)
    expected_dfi = 95.25
    match = "✓ MATCH" if abs(table3_report.dfi - expected_dfi) < 0.01 else "✗ MISMATCH"
    print(f"  SISA + Vector Purge: D=97, DB=95, V=95, M=94.5")
    print(f"  Expected DFI = {expected_dfi}  |  Computed DFI = {table3_report.dfi:.2f}  [{match}]")
    print(f"  Grade: {table3_report.grade}")
    print()

    # Fig. 5 regression verification — MIA advantage vs DFI inverse relationship
    print("─" * 72)
    print("  Paper Fig. 5 — MIA Advantage vs DFI Inverse Relationship")
    print("─" * 72)
    mia_headers = ["Strategy", "MIA Adv", "DFI"]
    mia_rows = []
    prev_mia = None
    prev_dfi = None
    monotonic = True
    for name, (_, _, _, mia_adv, _) in STRATEGIES:
        strat_result = next(r for r in results if r["strategy"] == name)
        mia_rows.append([name.replace("_", " "), f"{mia_adv:.2f}", f"{strat_result['dfi']:.2f}"])
        if prev_mia is not None:
            if mia_adv < prev_mia and strat_result["dfi"] <= prev_dfi:
                monotonic = False
        prev_mia = mia_adv
        prev_dfi = strat_result["dfi"]
    print(_box_table(mia_headers, mia_rows))
    if monotonic:
        print("  ✓ Inverse relationship confirmed: lower MIA advantage → higher DFI")
    else:
        print("  ✗ Inverse relationship NOT confirmed")
    print()

    # Audit hash for best strategy
    print("─" * 72)
    print(f"  Audit Hash — Best Strategy: {best['strategy']}")
    print("─" * 72)
    print(f"  SHA-256: {best['report_hash']}")
    print(f"  DFI: {best['dfi']:.2f}  |  Grade: {best['grade']}")
    print("=" * 72)


def _setup(args) -> None:
    """Generate synthetic data and export web data in one step."""
    print("▶ Step 1: Generating synthetic dataset…")
    dataset = generate_dataset(args.subjects, args.records_per_subject, args.erased_subjects, creator=args.creator)
    paths = write_dataset(dataset, args.output)
    print(f"  ✓ Written to {args.output}")
    for key, path in paths.items():
        print(f"    {key}: {path}")

    print("\n▶ Step 2: Exporting web data…")
    web_output = Path("website/data") / "synthetic_experiment.json"
    result_path = export_web_snapshot(web_output, dataset)
    print(f"  ✓ Written to {result_path}")
    print("\n✓ Setup complete! Open website/index.html in your browser.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Digital Forgetting Index reference implementation")
    parser.add_argument("command", choices=["benchmark", "generate-synthetic", "run-experiment", "export-web-data", "demo", "setup"])
    parser.add_argument("--output", default="data/synthetic", help="Output directory for generated synthetic data")
    parser.add_argument("--strategy", choices=list(STRATEGY_RETENTION), default="sisa_plus_vector_purge")
    parser.add_argument("--subjects", type=int, default=DEFAULT_SUBJECTS)
    parser.add_argument("--records-per-subject", type=int, default=DEFAULT_RECORDS_PER_SUBJECT)
    parser.add_argument("--erased-subjects", type=int, default=DEFAULT_ERASED_SUBJECTS)
    parser.add_argument("--creator", default="Deterministic Python generator (no LLM used)", help="Dataset provenance label shown in the manifest and website")
    args = parser.parse_args()
    if args.command == "benchmark":
        print(json.dumps(run_benchmark(), indent=2))
    elif args.command == "generate-synthetic":
        dataset = generate_dataset(args.subjects, args.records_per_subject, args.erased_subjects, creator=args.creator)
        print(json.dumps(write_dataset(dataset, args.output), indent=2))
    elif args.command == "run-experiment":
        dataset = generate_dataset(args.subjects, args.records_per_subject, args.erased_subjects, creator=args.creator)
        result = run_experiment(dataset, args.strategy)
        print(json.dumps({"strategy": result.strategy, "report": result.report, "evidence": result.evidence}, indent=2))
    elif args.command == "demo":
        _demo()
    elif args.command == "setup":
        _setup(args)
    else:
        dataset = generate_dataset(args.subjects, args.records_per_subject, args.erased_subjects, creator=args.creator)
        output = Path(args.output) / "synthetic_experiment.json"
        print(export_web_snapshot(output, dataset))


if __name__ == "__main__":
    main()
