import argparse
import json
from pathlib import Path
from .synthetic import run_benchmark
from .synthetic_data import generate_dataset, write_dataset
from .experiment import STRATEGY_RETENTION, export_web_snapshot, run_experiment


def main() -> None:
    parser = argparse.ArgumentParser(description="Digital Forgetting Index reference implementation")
    parser.add_argument("command", choices=["benchmark", "generate-synthetic", "run-experiment", "export-web-data"])
    parser.add_argument("--output", default="data/synthetic", help="Output directory for generated synthetic data")
    parser.add_argument("--strategy", choices=list(STRATEGY_RETENTION), default="sisa_plus_vector_purge")
    parser.add_argument("--subjects", type=int, default=1000)
    parser.add_argument("--records-per-subject", type=int, default=5)
    parser.add_argument("--erased-subjects", type=int, default=10)
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
    else:
        dataset = generate_dataset(args.subjects, args.records_per_subject, args.erased_subjects, creator=args.creator)
        output = Path(args.output) / "synthetic_experiment.json"
        print(export_web_snapshot(output, dataset))


if __name__ == "__main__":
    main()
