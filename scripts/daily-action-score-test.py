#!/usr/bin/env python3
"""Synthetic scorer mechanics only; these fixtures are not product quality evidence."""
import copy
import importlib.util
from pathlib import Path
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("daily_score", Path(__file__).with_name("daily-action-score.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    at = "2026-09-23T12:00:00Z"
    source = lambda sid, stratum: {"id": sid, "stratum": stratum, "split": "holdout", "sourceIdentity": {"connector": "fixture", "accountRef": "fixture", "externalID": sid, "revision": "1"}, "occurredAt": at, "snapshotAt": at, "eligible30Days": True}
    manifest = {"schemaVersion": 1, "kind": "manifest", "id": "SYNTHETIC-SCORER-ONLY", "datasetKind": "synthetic_scorer_test",
                "selection": {"seed": "fixture", "method": "tiny synthetic unit fixture", "frozenAt": at, "holdoutFrozenBeforeTuning": True},
                "sourceSamples": [source("s1", "direct_obligation"), source("s2", "conversational_info"), source("s3", "waiting_delegated")],
                "taskSamples": [{"id": "t1", "taskID": "fixture-task", "revision": 1, "snapshotID": "snapshot", "split": "holdout", "sourceEventIDs": ["s1"]}],
                "snapshots": [{"id": "snapshot", "at": at, "split": "holdout", "needsYouVisibleCount": 1, "needsYouTaskSampleIDs": ["t1"]}]}
    labels = {"schemaVersion": 1, "kind": "labels", "manifestID": manifest["id"],
              "sourceLabels": [{"sampleID": "s1", "judgment": "obligation", "obligations": [{"id": "o1", "matchedPredictionIDs": ["fixture-task"]}, {"id": "o2", "matchedPredictionIDs": []}]}, {"sampleID": "s2", "judgment": "non_obligation", "obligations": []}, {"sampleID": "s3", "judgment": "ambiguous", "obligations": []}],
              "taskLabels": [{"sampleID": "t1", "actionable": "yes"}], "completionLabels": [{"completionID": "c1", "support": "unsupported"}]}
    predictions = {"schemaVersion": 1, "kind": "predictions", "manifestID": manifest["id"], "run": {"id": "fixture-run", "pipelineVersion": "fixture", "at": at, "wholePipeline": True},
                   "sourcePredictions": [{"sampleID": "s1", "status": "completed", "surfacedTaskIDs": ["fixture-task"], "needsYouTaskIDs": ["fixture-task"], "modelEvidence": []}, {"sampleID": "s2", "status": "completed", "surfacedTaskIDs": [], "needsYouTaskIDs": [], "modelEvidence": []}, {"sampleID": "s3", "status": "failed", "surfacedTaskIDs": [], "needsYouTaskIDs": [], "modelEvidence": []}],
                   "taskPredictions": [{"sampleID": "t1", "taskID": "fixture-task", "surface": "needs_you", "modelEvidence": []}],
                   "automaticCompletions": [{"id": "c1", "sampleKind": "source", "sampleID": "s1", "taskID": "fixture-task", "evidenceIDs": []}]}
    return manifest, labels, predictions


class ScorerTests(unittest.TestCase):
    def test_denominators_ambiguity_and_no_live_claim(self):
        report = module.score(*fixture())
        held = report["metrics"]["holdout"]
        self.assertEqual(held["obligationRecall"], {"numerator": 1, "denominator": 2, "rate": .5})
        self.assertEqual(held["sourceAmbiguous"], 1)
        self.assertEqual(held["unsupportedAutomaticCompletions"]["denominator"], 1)
        self.assertFalse(report["proposedGates"]["noUnsupportedAutomaticCompletions"])
        self.assertFalse(report["sampleReadiness"]["complete"])
        self.assertEqual(held["reviewFailures"]["missedObligations"], [{"sampleID": "s1", "obligationID": "o2"}])
        self.assertIn("not_established", report["releaseConclusion"])

    def test_missing_output_counts_as_missed_not_dropped(self):
        m, l, p = fixture()
        p["sourcePredictions"] = p["sourcePredictions"][1:]
        l["sourceLabels"][0]["obligations"][0]["matchedPredictionIDs"] = []
        held = module.score(m, l, p)["metrics"]["holdout"]
        self.assertEqual(held["obligationRecall"]["denominator"], 2)
        self.assertEqual(held["obligationRecall"]["numerator"], 0)
        self.assertEqual(held["sourceUnpredicted"], 1)

    def test_unjudged_top_slots_and_completions_are_not_passes(self):
        m, l, p = fixture(); l["taskLabels"] = []; l["completionLabels"] = []
        gates = module.score(m, l, p)["proposedGates"]
        self.assertIsNone(gates["eachHoldoutTopList90Percent"])
        self.assertIsNone(gates["noUnsupportedAutomaticCompletions"])
        p["automaticCompletions"] = []
        self.assertIsNone(module.score(m, l, p)["proposedGates"]["noUnsupportedAutomaticCompletions"])

    def test_tuning_separate_and_old_model_context_flagged(self):
        m, l, p = fixture(); m["sourceSamples"][0]["split"] = "tuning"
        p["taskPredictions"][0]["modelEvidence"] = [{"eventID": "old", "occurredAt": "2026-08-01T00:00:00Z", "sentAt": "2026-09-23T12:00:00Z"}]
        report = module.score(m, l, p)
        self.assertEqual(report["metrics"]["tuning"]["obligationRecall"]["denominator"], 2)
        self.assertIsNone(report["metrics"]["holdout"]["obligationRecall"]["rate"])
        self.assertFalse(report["proposedGates"]["thirtyDayModelPolicy"])

    def test_future_scheduled_evidence_matches_existing_processing_window(self):
        m, l, p = fixture()
        m["sourceSamples"][0]["occurredAt"] = "2026-10-01T12:00:00Z"
        p["sourcePredictions"][0]["modelEvidence"] = [{"eventID": "scheduled", "occurredAt": "2026-10-01T12:00:00Z", "sentAt": "2026-09-23T12:00:00Z"}]
        self.assertTrue(module.score(m, l, p)["proposedGates"]["thirtyDayModelPolicy"])
        p["sourcePredictions"][0]["modelEvidence"].append({"eventID": "old", "occurredAt": "2026-08-01T12:00:00Z", "sentAt": "2026-09-23T12:00:00Z"})
        report = module.score(m, l, p)
        self.assertEqual(report["modelAgeViolations"], [{"sampleID": "s1", "eventID": "old"}])

    def test_duplicate_revisions_or_fabricated_matches_rejected(self):
        m, l, p = fixture(); duplicate = copy.deepcopy(m["sourceSamples"][0]); duplicate["id"] = "revision-copy"; duplicate["sourceIdentity"]["revision"] = "2"; m["sourceSamples"].append(duplicate)
        with self.assertRaisesRegex(ValueError, "Duplicate source"):
            module.score(m, l, p)
        m, l, p = fixture(); l["sourceLabels"][0]["obligations"][0]["matchedPredictionIDs"] = ["not-produced"]
        with self.assertRaisesRegex(ValueError, "not surfaced"):
            module.score(m, l, p)

    def test_duplicate_visible_task_instance_rejected(self):
        m, l, p = fixture(); duplicate = copy.deepcopy(m["taskSamples"][0]); duplicate["id"] = "copy"; m["taskSamples"].append(duplicate)
        with self.assertRaisesRegex(ValueError, "Duplicate visible task"):
            module.score(m, l, p)

    def test_eligibility_boundary_and_empty_templates(self):
        m, l, p = fixture(); m["sourceSamples"][0]["occurredAt"] = "2026-08-24T12:00:00Z"
        self.assertTrue(module.score(m, l, p)["sampleReadiness"]["eligibleSourceCounts"]["direct_obligation"])
        m["sourceSamples"][0]["occurredAt"] = "2026-08-24T11:59:59Z"
        with self.assertRaisesRegex(ValueError, "Eligibility"):
            module.score(m, l, p)
        m, l, p = fixture()
        m["sourceSamples"] = []; m["taskSamples"] = []; m["snapshots"] = []
        l["sourceLabels"] = []; l["taskLabels"] = []; l["completionLabels"] = []
        p["sourcePredictions"] = []; p["taskPredictions"] = []; p["automaticCompletions"] = []
        report = module.score(m, l, p)
        self.assertIsNone(report["metrics"]["holdout"]["obligationRecall"]["rate"])
        self.assertFalse(report["sampleReadiness"]["complete"])


if __name__ == "__main__":
    unittest.main()
