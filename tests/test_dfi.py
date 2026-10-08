import math
import unittest

from dfi.core import LayerScores, compute_dfi, model_residue_score
from dfi.probes import DatasetProbe, VectorProbe
from dfi.synthetic_data import generate_dataset
from dfi.experiment import run_experiment


class TestDFI(unittest.TestCase):
  def test_paper_worked_example(self):
    report = compute_dfi(LayerScores(97, 95, 88, 87))
    # Exact weighted sum is 90.9; the paper reports 91.0 after rounding.
    self.assertTrue(math.isclose(report.dfi, 90.9))
    self.assertTrue(report.grade.startswith("A"))


  def test_model_formula_and_normalization(self):
    self.assertTrue(math.isclose(model_residue_score(0.10, 0.20), 80.0))


  def test_dataset_probe_counts_fuzzy_matches_across_copies(self):
    subject = {"name": "Vasu Bansal", "email": "vasu@example.com"}
    copies = {"raw": [subject], "export": [{"name": "Vasu Bansal", "email": "vasu@example.com"}], "archive": []}
    score, raw = DatasetProbe(("name", "email"), 0.90).run(copies, subject, 2)
    self.assertEqual(raw["residual"], 2)
    self.assertEqual(score, 0)


  def test_vector_probe_detects_attributable_top_k_result(self):
    vectors = [{"subject_id": "u1", "embedding": [1.0, 0.0]}, {"subject_id": "other", "embedding": [0.0, 1.0]}]
    score, raw = VectorProbe(k=1, similarity_threshold=0.8).run(vectors, [[1.0, 0.0]], "u1")
    self.assertEqual(score, 0)
    self.assertEqual(raw["attributable_hits"], 1)


  def test_bounded_inputs(self):
    with self.assertRaises(ValueError):
        LayerScores(101, 0, 0, 0)

  def test_proposed_synthetic_dataset_size(self):
    dataset = generate_dataset()
    self.assertEqual(dataset.subject_count, 1000)
    self.assertEqual(len(dataset.records), 5000)
    self.assertEqual(len(dataset.erased_subjects), 10)

  def test_end_to_end_synthetic_experiment_uses_probe_evidence(self):
    dataset = generate_dataset(subjects=100, records_per_subject=5, erased_subjects=10)
    result = run_experiment(dataset, "sisa_plus_vector_purge")
    self.assertGreater(result.report["dfi"], 80)
    self.assertEqual(result.report["scope"]["records"], 500)
    self.assertIn("dataset", result.report["raw_signals"])

  def test_executable_strategies_change_real_surfaces(self):
    dataset = generate_dataset(subjects=20, records_per_subject=5, erased_subjects=3)
    no_action = run_experiment(dataset, "no_action")
    database = run_experiment(dataset, "database_only")
    strong = run_experiment(dataset, "sisa_plus_vector_purge")
    self.assertEqual(no_action.report["raw_signals"]["database"]["residual"], 60)
    self.assertEqual(database.report["raw_signals"]["database"]["residual"], 0)
    self.assertEqual(strong.report["raw_signals"]["vector"]["attributable_hits"], 0)
    self.assertGreater(strong.report["dfi"], database.report["dfi"])

  def test_selected_forget_set_is_measured(self):
    dataset = generate_dataset(subjects=20, records_per_subject=5, erased_subjects=3)
    selected = [dataset.erased_subjects[0]]
    result = run_experiment(dataset, "database_only", selected_subjects=selected)
    self.assertEqual(result.report["scope"]["subjects"], 1)
    self.assertEqual(result.evidence["selected_subjects"], selected)


if __name__ == "__main__":
    unittest.main()
