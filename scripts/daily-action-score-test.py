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
    predictions = {"schemaVersion": 2, "kind": "predictions", "manifestID": manifest["id"], "run": {"id": "fixture-run", "pipelineVersion": "fixture", "at": at, "wholePipeline": True},
                   "sourcePredictions": [{"sampleID": "s1", "status": "completed", "surfacedTaskIDs": ["fixture-task"], "needsYouTaskIDs": ["fixture-task"], "modelEvidence": []}, {"sampleID": "s2", "status": "completed", "surfacedTaskIDs": [], "needsYouTaskIDs": [], "modelEvidence": []}, {"sampleID": "s3", "status": "failed", "surfacedTaskIDs": [], "needsYouTaskIDs": [], "modelEvidence": []}],
                   "taskPredictions": [{"sampleID": "t1", "taskID": "fixture-task", "surface": "needs_you", "modelEvidence": []}],
                   "automaticCompletions": [{"id": "c1", "sampleKind": "source", "sampleID": "s1", "taskID": "fixture-task", "evidenceIDs": []}]}
    predictions["run"]["coverage"] = {"status": "complete", "captureID": "synthetic-capture",
        "startedAt": at, "throughAt": at, "projectionSnapshotIDs": ["snapshot"], "completionHistory": "complete"}
    for row in predictions["sourcePredictions"] + predictions["taskPredictions"]:
        row["coverage"] = {"status": "complete", "captureID": "synthetic-capture", "originAt": at, "modelCallCount": 0}
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
        p["taskPredictions"][0]["modelEvidence"] = [{"invocationID": "fixture-call", "eventID": "old", "occurredAt": "2026-08-01T00:00:00Z", "sentAt": "2026-09-23T12:00:00Z"}]
        p["taskPredictions"][0]["coverage"]["modelCallCount"] = 1
        report = module.score(m, l, p)
        self.assertEqual(report["metrics"]["tuning"]["obligationRecall"]["denominator"], 2)
        self.assertIsNone(report["metrics"]["holdout"]["obligationRecall"]["rate"])
        self.assertFalse(report["proposedGates"]["thirtyDayModelPolicy"])

    def test_future_scheduled_evidence_matches_existing_processing_window(self):
        m, l, p = fixture()
        m["sourceSamples"][0]["occurredAt"] = "2026-10-01T12:00:00Z"
        p["sourcePredictions"][0]["modelEvidence"] = [{"invocationID": "fixture-call", "eventID": "scheduled", "occurredAt": "2026-10-01T12:00:00Z", "sentAt": "2026-09-23T12:00:00Z"}]
        p["sourcePredictions"][0]["coverage"]["modelCallCount"] = 1
        self.assertTrue(module.score(m, l, p)["proposedGates"]["thirtyDayModelPolicy"])
        p["sourcePredictions"][0]["modelEvidence"].append({"invocationID": "fixture-call", "eventID": "old", "occurredAt": "2026-08-01T12:00:00Z", "sentAt": "2026-09-23T12:00:00Z"})
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
        p["run"]["coverage"] = {"status": "unknown"}
        report = module.score(m, l, p)
        self.assertIsNone(report["metrics"]["holdout"]["obligationRecall"]["rate"])
        self.assertFalse(report["sampleReadiness"]["complete"])


    def test_legacy_empty_evidence_cannot_establish_any_gate(self):
        m, l, p = fixture(); p["schemaVersion"] = 1
        report = module.score(m, l, p)
        self.assertFalse(report["coverage"]["complete"])
        self.assertTrue(all(v is None for v in report["proposedGates"].values()))
        self.assertEqual(report["metrics"]["holdout"]["obligationRecall"]["denominator"], 2)
        self.assertFalse(report["sampleReadiness"]["complete"])

    def test_explicit_complete_zero_calls_is_valid(self):
        report = module.score(*fixture())
        self.assertTrue(report["coverage"]["complete"])
        self.assertEqual(report["coverage"]["capturedUniqueModelCalls"], 0)
        self.assertTrue(report["proposedGates"]["thirtyDayModelPolicy"])

    def test_unknown_or_incomplete_sample_keeps_denominators_and_blocks_gates(self):
        for row_coverage in [None, {"status": "unknown", "modelCallCount": None}, {"status": "incomplete", "modelCallCount": 0}]:
            m, l, p = fixture()
            if row_coverage is None: p["sourcePredictions"][0].pop("coverage")
            else: p["sourcePredictions"][0]["coverage"] = row_coverage
            report = module.score(m, l, p)
            self.assertTrue(all(v is None for v in report["proposedGates"].values()))
            self.assertEqual(report["metrics"]["holdout"]["obligationRecall"]["denominator"], 2)
            self.assertEqual(report["coverage"]["sampleCount"], 4)

    def test_missing_run_capture_cannot_be_certified_by_complete_rows(self):
        m, l, p = fixture(); p["run"].pop("coverage")
        with self.assertRaisesRegex(ValueError, "requires complete capture"):
            module.score(m, l, p)
        for row in p["sourcePredictions"] + p["taskPredictions"]: row.pop("coverage")
        self.assertFalse(module.score(m, l, p)["coverage"]["complete"])

    def test_complete_capture_rejects_pre_cutover_origin_or_wrong_snapshot(self):
        m, l, p = fixture(); p["sourcePredictions"][0]["coverage"]["originAt"] = "2026-09-22T12:00:00Z"
        with self.assertRaisesRegex(ValueError, "pre-cutover"):
            module.score(m, l, p)
        m, l, p = fixture(); p["run"]["coverage"]["projectionSnapshotIDs"] = []
        with self.assertRaisesRegex(ValueError, "exact projection snapshot"):
            module.score(m, l, p)
        m, l, p = fixture(); p["taskPredictions"][0]["coverage"]["captureID"] = "different-capture"
        with self.assertRaisesRegex(ValueError, "captureID mismatch"):
            module.score(m, l, p)

    def test_completion_capture_and_whole_pipeline_are_independent_requirements(self):
        for change in ["completion", "pipeline"]:
            m, l, p = fixture()
            if change == "completion": p["run"]["coverage"]["completionHistory"] = "unknown"
            else: p["run"]["wholePipeline"] = False
            report = module.score(m, l, p)
            self.assertTrue(all(v is None for v in report["proposedGates"].values()))
            self.assertEqual(report["metrics"]["holdout"]["unsupportedAutomaticCompletions"]["observed"], 1)

    def test_call_counts_and_real_invocation_evidence_must_agree(self):
        m, l, p = fixture(); row = p["sourcePredictions"][0]
        row["coverage"]["modelCallCount"] = 1
        with self.assertRaisesRegex(ValueError, "disagrees"):
            module.score(m, l, p)
        row["modelEvidence"] = [{"invocationID": "fixture-call", "eventID": "s1", "occurredAt": m["sourceSamples"][0]["occurredAt"], "sentAt": p["run"]["at"]}]
        self.assertTrue(module.score(m, l, p)["coverage"]["complete"])
        row["coverage"]["modelCallCount"] = False
        with self.assertRaisesRegex(ValueError, "modelCallCount"):
            module.score(m, l, p)
        row["coverage"]["modelCallCount"] = 1
        row["modelEvidence"].append(copy.deepcopy(row["modelEvidence"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate invocation"):
            module.score(m, l, p)

    def test_send_time_and_cross_sample_evidence_are_not_reconstructed(self):
        m, l, p = fixture(); row = p["sourcePredictions"][0]
        row["coverage"]["modelCallCount"] = 1
        row["modelEvidence"] = [{"invocationID": "fixture-call", "eventID": "s1", "occurredAt": p["run"]["at"], "sentAt": "2026-09-23T12:00:01Z"}]
        with self.assertRaisesRegex(ValueError, "send outside"):
            module.score(m, l, p)
        row["modelEvidence"][0]["sentAt"] = p["run"]["at"]
        task = p["taskPredictions"][0]
        task["coverage"]["modelCallCount"] = 1
        task["modelEvidence"] = copy.deepcopy(row["modelEvidence"])
        self.assertEqual(module.score(m, l, p)["coverage"]["capturedUniqueModelCalls"], 1)
        task["modelEvidence"][0]["eventID"] = "different-evidence"
        with self.assertRaisesRegex(ValueError, "differs between samples"):
            module.score(m, l, p)

    def test_full_sample_readiness_still_requires_coverage(self):
        m, l, p = fixture()
        source = copy.deepcopy(m["sourceSamples"][0]); prediction = copy.deepcopy(p["sourcePredictions"][0])
        task = copy.deepcopy(m["taskSamples"][0]); task_prediction = copy.deepcopy(p["taskPredictions"][0])
        m["sourceSamples"] = []; l["sourceLabels"] = []; p["sourcePredictions"] = []
        for stratum, count in module.TARGETS.items():
            for index in range(count):
                sid = stratum + str(index)
                row = copy.deepcopy(source); row.update(id=sid, stratum=stratum); row["sourceIdentity"]["externalID"] = sid
                m["sourceSamples"].append(row)
                l["sourceLabels"].append({"sampleID": sid, "judgment": "non_obligation", "obligations": []})
                row = copy.deepcopy(prediction); row.update(sampleID=sid, surfacedTaskIDs=[], needsYouTaskIDs=[])
                p["sourcePredictions"].append(row)
        m["taskSamples"] = []; l["taskLabels"] = []; p["taskPredictions"] = []
        for index in range(50):
            tid = "task" + str(index)
            row = copy.deepcopy(task); row.update(id=tid, taskID=tid)
            m["taskSamples"].append(row)
            l["taskLabels"].append({"sampleID": tid, "actionable": "yes"})
            row = copy.deepcopy(task_prediction); row.update(sampleID=tid, taskID=tid)
            p["taskPredictions"].append(row)
        m["snapshots"][0].update(needsYouVisibleCount=50, needsYouTaskSampleIDs=["task" + str(i) for i in range(10)])
        p["automaticCompletions"] = []; l["completionLabels"] = []
        self.assertTrue(module.score(m, l, p)["sampleReadiness"]["complete"])
        p["sourcePredictions"][0]["coverage"] = {"status": "unknown"}
        report = module.score(m, l, p)
        self.assertFalse(report["sampleReadiness"]["complete"])
        self.assertEqual(report["coverage"]["sampleCount"], 150)
        self.assertEqual(report["sampleReadiness"]["eligibleSourceCounts"], module.TARGETS)
        self.assertTrue(all(v is None for v in report["proposedGates"].values()))

    def test_committed_templates_are_unknown_not_zero_call_claims(self):
        import json
        directory = Path(__file__).resolve().parent.parent / "docs/evaluations"
        docs = [json.loads((directory / ("daily-actions." + name + ".template.json")).read_text()) for name in ["manifest", "labels", "predictions"]]
        report = module.score(*docs)
        self.assertFalse(report["coverage"]["complete"])
        self.assertTrue(all(v is None for v in report["proposedGates"].values()))

if __name__ == "__main__":
    unittest.main()
