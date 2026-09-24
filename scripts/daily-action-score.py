#!/usr/bin/env python3
"""Offline daily-action scorer. Reads explicit JSON files; never opens app DBs or calls providers."""
import argparse
import datetime as dt
import json
from pathlib import Path

TARGETS = {"conversational_info": 30, "direct_obligation": 30, "waiting_delegated": 20,
           "calendar_time_sensitive": 10, "noise_transport": 10}
SPLITS = {"holdout", "tuning"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def timestamp(value):
    require(isinstance(value, str), "Timestamp must be ISO 8601 text with a timezone")
    result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(result.tzinfo is not None, "Timestamp requires a timezone")
    return result


def indexed(rows, key, name):
    require(isinstance(rows, list), name + " must be an array")
    result = {}
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get(key), str) and row[key], name + " needs " + key)
        require(row[key] not in result, "Duplicate " + name + " " + row[key])
        result[row[key]] = row
    return result


def ratio(numerator, denominator):
    return {"numerator": numerator, "denominator": denominator,
            "rate": numerator / denominator if denominator else None}


def score(manifest, labels, predictions):
    for document, kind in [(manifest, "manifest"), (labels, "labels"), (predictions, "predictions")]:
        require(document.get("schemaVersion") == 1 and document.get("kind") == kind, "Wrong document kind/version: " + kind)
    require(manifest.get("datasetKind") in {"live_local", "synthetic_scorer_test"}, "Unknown dataset kind")
    require(labels.get("manifestID") == predictions.get("manifestID") == manifest.get("id"), "Manifest IDs differ")
    require(predictions.get("run", {}).get("wholePipeline") is True, "Predictions must represent the whole pipeline")
    require(predictions["run"].get("id") and predictions["run"].get("pipelineVersion"), "Run identity/version missing")
    timestamp(predictions["run"]["at"])
    timestamp(manifest["selection"]["frozenAt"])
    require(manifest["selection"].get("seed") and manifest["selection"].get("method"), "Selection provenance missing")
    require(manifest["selection"].get("holdoutFrozenBeforeTuning") is True, "Holdout must be frozen before tuning")
    sources = indexed(manifest["sourceSamples"], "id", "source sample")
    tasks = indexed(manifest["taskSamples"], "id", "task sample")
    snapshots = indexed(manifest["snapshots"], "id", "snapshot")
    source_labels = indexed(labels["sourceLabels"], "sampleID", "source label")
    task_labels = indexed(labels["taskLabels"], "sampleID", "task label")
    source_predictions = indexed(predictions["sourcePredictions"], "sampleID", "source prediction")
    task_predictions = indexed(predictions["taskPredictions"], "sampleID", "task prediction")
    completions = indexed(predictions["automaticCompletions"], "id", "completion")
    completion_labels = indexed(labels["completionLabels"], "completionID", "completion label")
    for rows, known in [(source_labels, sources), (source_predictions, sources), (task_labels, tasks), (task_predictions, tasks), (completion_labels, completions)]:
        require(set(rows) <= set(known), "Unknown sample/transition reference")
    counts = dict.fromkeys(TARGETS, 0)
    eligible = {}
    identities = set()
    for sid, sample in sources.items():
        require(sample["split"] in SPLITS and sample["stratum"] in TARGETS, "Invalid source split/stratum")
        identity = sample["sourceIdentity"]
        require(all(isinstance(identity.get(k), str) and identity[k] for k in ["connector", "accountRef", "externalID", "revision"]), "Incomplete source identity")
        # Two revisions/copies of the same observation must not inflate the 100-message denominator.
        key = tuple(identity[k] for k in ["connector", "accountRef", "externalID"])
        require(key not in identities, "Duplicate source identity/revision in sample")
        identities.add(key)
        age = timestamp(sample["snapshotAt"]) - timestamp(sample["occurredAt"])
        eligible[sid] = age <= dt.timedelta(days=30)
        require(sample["eligible30Days"] is eligible[sid], "Eligibility flag disagrees with source time")
        if eligible[sid]:
            counts[sample["stratum"]] += 1
    task_instances = set()
    for tid, task in tasks.items():
        require(task["split"] in SPLITS and task["snapshotID"] in snapshots, "Invalid task split/snapshot")
        require(task.get("taskID") and task.get("revision") is not None, "Task identity/revision missing")
        instance = (task["snapshotID"], task["taskID"])
        require(instance not in task_instances, "Duplicate visible task instance")
        task_instances.add(instance)
        require(task["split"] == snapshots[task["snapshotID"]]["split"], "Task/snapshot split mismatch")
        require(isinstance(task["sourceEventIDs"], list), "Task source references missing")
    for snapshot in snapshots.values():
        timestamp(snapshot["at"])
        require(snapshot["split"] in SPLITS, "Invalid snapshot split")
        top = snapshot["needsYouTaskSampleIDs"]
        require(type(snapshot["needsYouVisibleCount"]) is int and snapshot["needsYouVisibleCount"] >= 0, "Invalid visible count")
        require(len(top) == min(10, snapshot["needsYouVisibleCount"]) and len(set(top)) == len(top), "Top list must contain every first-ten visible slot in order")
        require(all(t in tasks and tasks[t]["snapshotID"] == snapshot["id"] for t in top), "Top item missing task sample")
    for label in source_labels.values():
        require(label.get("judgment") in {"obligation", "non_obligation", "ambiguous"}, "Invalid source judgment")
        obligations = indexed(label["obligations"], "id", "human obligation")
        require((label["judgment"] == "obligation") == bool(obligations), "Only clear obligation labels have obligations")
        for obligation in obligations.values():
            matches = obligation["matchedPredictionIDs"]
            require(isinstance(matches, list) and len(set(matches)) == len(matches), "Invalid matched task IDs")
            require(set(matches) <= set(source_predictions.get(label["sampleID"], {}).get("surfacedTaskIDs", [])), "Human match references a task not surfaced for this source")
    policy_violations = []
    for sid, prediction in source_predictions.items():
        require(prediction["status"] in {"completed", "failed", "pending", "skipped"}, "Invalid pipeline status")
        require(isinstance(prediction["surfacedTaskIDs"], list) and len(set(prediction["surfacedTaskIDs"])) == len(prediction["surfacedTaskIDs"]), "Duplicate surfaced IDs")
        require(isinstance(prediction["needsYouTaskIDs"], list) and set(prediction["needsYouTaskIDs"]) <= set(prediction["surfacedTaskIDs"]), "Needs you IDs must be surfaced task IDs")
        for evidence in prediction["modelEvidence"]:
            age = timestamp(evidence["sentAt"]) - timestamp(evidence["occurredAt"])
            require(evidence.get("eventID"), "Missing model evidence ID")
            if not age <= dt.timedelta(days=30):
                policy_violations.append({"sampleID": sid, "eventID": evidence["eventID"]})
    for tid, prediction in task_predictions.items():
        require(prediction["taskID"] == tasks[tid]["taskID"], "Task prediction identity mismatch")
        require(prediction["surface"] in {"needs_you", "waiting", "later", "history"}, "Invalid predicted surface")
        snapshot = snapshots[tasks[tid]["snapshotID"]]
        if tid in snapshot["needsYouTaskSampleIDs"]:
            require(prediction["surface"] == "needs_you", "Top snapshot item is not on predicted Needs you surface")
        for evidence in prediction["modelEvidence"]:
            age = timestamp(evidence["sentAt"]) - timestamp(evidence["occurredAt"])
            require(evidence.get("eventID"), "Missing model evidence ID")
            if not age <= dt.timedelta(days=30):
                policy_violations.append({"sampleID": tid, "eventID": evidence["eventID"]})
    for label in task_labels.values():
        require(label["actionable"] in {"yes", "no", "ambiguous"}, "Invalid actionability label")
    for cid, completion in completions.items():
        kind = completion["sampleKind"]
        require(kind in {"source", "task"}, "Invalid completion sample kind")
        require(completion["sampleID"] in (sources if kind == "source" else tasks), "Completion outside sampled population")
        require(completion.get("taskID") and isinstance(completion.get("evidenceIDs"), list), "Completion needs task/evidence references")
        if cid in completion_labels:
            require(completion_labels[cid]["support"] in {"supported", "unsupported", "ambiguous"}, "Invalid completion label")

    metrics = {}
    for split in sorted(SPLITS):
        source_ids = [sid for sid, sample in sources.items() if sample["split"] == split and eligible[sid]]
        clear = [source_labels[sid] for sid in source_ids if sid in source_labels and source_labels[sid]["judgment"] == "obligation"]
        obligations = [ob for label in clear for ob in label["obligations"]]
        recalled = sum(bool(ob["matchedPredictionIDs"]) for ob in obligations)
        negatives = [sid for sid in source_ids if source_labels.get(sid, {}).get("judgment") == "non_obligation"]
        negative_predictions = sum(bool(source_predictions.get(sid, {}).get("needsYouTaskIDs")) for sid in negatives)
        task_ids = [tid for tid, task in tasks.items() if task["split"] == split]
        judged_tasks = [task_labels[tid] for tid in task_ids if task_labels.get(tid, {}).get("actionable") in {"yes", "no"}]
        snapshot_results = []
        for snapshot in snapshots.values():
            if snapshot["split"] != split:
                continue
            top = snapshot["needsYouTaskSampleIDs"]
            judged = [task_labels[t] for t in top if task_labels.get(t, {}).get("actionable") in {"yes", "no"}]
            snapshot_results.append({"snapshotID": snapshot["id"], **ratio(sum(t["actionable"] == "yes" for t in judged), len(judged)),
                                     "visibleSlots": len(top), "ambiguous": sum(task_labels.get(t, {}).get("actionable") == "ambiguous" for t in top),
                                     "unlabeled": sum(t not in task_labels for t in top), "unpredicted": sum(t not in task_predictions for t in top)})
        completion_ids = [cid for cid, c in completions.items() if (sources if c["sampleKind"] == "source" else tasks)[c["sampleID"]]["split"] == split]
        judged_completions = [completion_labels[cid] for cid in completion_ids if completion_labels.get(cid, {}).get("support") in {"supported", "unsupported"}]
        metrics[split] = {
            "obligationRecall": ratio(recalled, len(obligations)),
            "negativeSourceNeedsYou": ratio(negative_predictions, len(negatives)),
            "taskActionability": ratio(sum(t["actionable"] == "yes" for t in judged_tasks), len(judged_tasks)),
            "topNeedsYou": snapshot_results,
            "unsupportedAutomaticCompletions": {**ratio(sum(c["support"] == "unsupported" for c in judged_completions), len(judged_completions)),
                "observed": len(completion_ids), "ambiguous": sum(completion_labels.get(c, {}).get("support") == "ambiguous" for c in completion_ids),
                "unlabeled": sum(c not in completion_labels for c in completion_ids)},
            "reviewFailures": {
                "missedObligations": [{"sampleID": label["sampleID"], "obligationID": obligation["id"]} for label in clear for obligation in label["obligations"] if not obligation["matchedPredictionIDs"]],
                "nonActionableTaskSampleIDs": [tid for tid in task_ids if task_labels.get(tid, {}).get("actionable") == "no"],
                "unsupportedCompletionIDs": [cid for cid in completion_ids if completion_labels.get(cid, {}).get("support") == "unsupported"],
            },
            "sourceAmbiguous": sum(source_labels.get(s, {}).get("judgment") == "ambiguous" for s in source_ids),
            "sourceUnlabeled": sum(s not in source_labels for s in source_ids),
            "sourceUnpredicted": sum(s not in source_predictions for s in source_ids),
            "sourceFailedOrPending": sum(source_predictions.get(s, {}).get("status") in {"failed", "pending"} for s in source_ids),
            "taskAmbiguous": sum(task_labels.get(t, {}).get("actionable") == "ambiguous" for t in task_ids),
            "taskUnlabeled": sum(t not in task_labels for t in task_ids),
            "taskUnpredicted": sum(t not in task_predictions for t in task_ids),
        }
    holdout = metrics["holdout"]
    complete = (counts == TARGETS and len(sources) == 100 and len(tasks) == 50
                and set(source_labels) == set(source_predictions) == set(sources)
                and set(task_labels) == set(task_predictions) == set(tasks)
                and set(completion_labels) == set(completions))
    top = holdout["topNeedsYou"]
    completion = holdout["unsupportedAutomaticCompletions"]
    recall = holdout["obligationRecall"]["rate"]
    return {"manifestID": manifest["id"], "datasetKind": manifest["datasetKind"], "runID": predictions["run"]["id"],
            "sampleReadiness": {"complete": complete, "sourceTargets": TARGETS, "eligibleSourceCounts": counts, "visibleTaskCount": len(tasks), "visibleTaskTarget": 50,
                                "sourceCountsBySplit": {split: {stratum: sum(s["split"] == split and s["stratum"] == stratum and eligible[sid] for sid, s in sources.items()) for stratum in TARGETS} for split in sorted(SPLITS)},
                                "ineligibleSourceIDs": [s for s, ok in eligible.items() if not ok]},
            "metrics": metrics, "modelAgeViolations": policy_violations,
            "proposedGates": {
                "holdoutRecall85Percent": None if recall is None else recall >= .85,
                "eachHoldoutTopList90Percent": None if not top or any(t["unlabeled"] or t["unpredicted"] or t["ambiguous"] or not t["denominator"] for t in top) else all(t["rate"] >= .90 for t in top),
                "noUnsupportedAutomaticCompletions": None if not completion["observed"] or completion["unlabeled"] or completion["ambiguous"] else completion["numerator"] == 0,
                "thirtyDayModelPolicy": not policy_violations},
            "releaseConclusion": "not_established: labeling completeness, independent holdout and non-quality reliability gates require human review"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path); parser.add_argument("labels", type=Path); parser.add_argument("predictions", type=Path)
    args = parser.parse_args()
    try:
        report = score(*(json.loads(path.read_text()) for path in [args.manifest, args.labels, args.predictions]))
        print(json.dumps(report, indent=2, sort_keys=True, allow_nan=False))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
