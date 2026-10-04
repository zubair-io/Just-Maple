#!/usr/bin/env python3
"""Synthetic frozen-capture exporter mechanics, never live model quality evidence."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import unittest
from unittest.mock import patch
import uuid
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('predictions_export', Path(__file__).with_name('daily-action-predictions.py'))
x = importlib.util.module_from_spec(spec)
spec.loader.exec_module(x)
AT = '2026-09-23T12:00:00.000Z'
EPOCH = x.iso(AT)


def fixture(root):
    directory = root / str(uuid.uuid4())
    directory.mkdir(mode=0o700)
    task = {'id': 'a', 'version': 2, 'status': 'open', 'evidenceIDs': ['e1']}
    waiting = {'id': 'b', 'version': 3, 'status': 'waiting', 'evidenceIDs': ['e2']}
    suggestion = {'id': 'linked', 'version': 7, 'candidate': task, 'reviewStatus': 'pending', 'linkedTaskID': 'a', 'eventID': 'e1'}
    world = {'revision': 3, 'asOf': EPOCH - 1, 'tasks': [task, waiting], 'suggestions': [suggestion]}
    def row(node, version, evidence, rendered=None):
        return {'rankedNode': {'id': node, 'version': version}, 'renderedRow': rendered or {'id': node, 'version': version}, 'sourceEventIDs': evidence}
    a = row('task:a', 2, ['e1'], {'id': 'source:linked', 'version': 7})
    b = row('task:b', 3, ['e2'])
    projection = {'schemaVersion': 1, 'kind': 'current-ui-task-projection', 'currentOnly': True,
                  'scope': 'unfiltered-task-tabs', 'visibility': 'tab-membership-not-viewport', 'capturedAt': AT,
                  'world': {'revision': 3, 'asOf': x.utc(EPOCH - 1), 'hash': {'algorithm': 'SHA-256', 'value': '', 'verified': False, 'source': 'caller-supplied'}},
                  'surfaces': {'needsYou': [a], 'waiting': [b], 'later': [b]}, 'topTenNeedsYou': [a]}
    db = sqlite3.connect(directory / 'core.sqlite')
    db.executescript('''
      CREATE TABLE events(id TEXT PRIMARY KEY,connector,account,external_id,revision,occurred_at REAL);
      CREATE TABLE life_tasks(id TEXT PRIMARY KEY,json);
      CREATE TABLE task_suggestions(id TEXT PRIMARY KEY,json);
      CREATE TABLE world_history(sequence INTEGER PRIMARY KEY,id TEXT,json);
      CREATE TABLE home_batch_members(event_id TEXT PRIMARY KEY,batch_id TEXT);
      CREATE TABLE processing_jobs(event_id TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE fact_jobs(event_id TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE task_extraction_jobs(event_id TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE state_jobs(event_id TEXT PRIMARY KEY,status TEXT);
      CREATE TABLE provider_invocations(id TEXT PRIMARY KEY,job_id,attempt_id,invocation_id,parent_id,stage,event_id,provider,model,context_sha256,dispatch_json,recorded_at REAL);
      CREATE TABLE provider_invocation_events(sequence INTEGER PRIMARY KEY,invocation_id,kind,payload_sha256,payload,availability,recorded_at REAL);
    ''')
    for i in range(1, 6):
        db.execute('INSERT INTO events VALUES (?,?,?,?,?,?)', (f'e{i}', 'fixture', 'private-fixture-account', f'external{i}', 'r1', EPOCH - 60))
    for t in world['tasks']:
        db.execute('INSERT INTO life_tasks VALUES (?,?)', (t['id'], json.dumps(t)))
    db.execute('INSERT INTO task_suggestions VALUES (?,?)', (suggestion['id'], json.dumps(suggestion)))
    db.executemany('INSERT INTO processing_jobs VALUES (?,?)', [('e1', 'succeeded'), ('e2', 'failed'), ('e3', 'pending'), ('batch', 'outside_window')])
    db.execute('INSERT INTO home_batch_members VALUES (?,?)', ('e4', 'batch'))
    for seq, actor in [(1, 'task-reconciliation'), (2, 'user'), (3, 'task-reconciliation')]:
        before = {'id': 'old-hidden', 'version': seq, 'status': 'open', 'evidenceIDs': ['e1']}
        after = {**before, 'version': seq + 1, 'status': 'completed'}
        history = {'id': 'h' + str(seq), 'type': 'task.completed', 'actor': actor, 'subjects': ['old-hidden'], 'before': json.dumps(before), 'after': json.dumps(after), 'recordedAt': EPOCH - 20 + seq, 'effectiveAt': EPOCH - 20 + seq, 'correlationID': 'attempt' + str(seq)}
        db.execute('INSERT INTO world_history VALUES (?,?,?)', (seq, history['id'], json.dumps(history)))
    dispatch = {'attemptedAt': EPOCH - 30, 'coverage': 'partial', 'evidence': [{'eventID': 'e1', 'occurredAt': EPOCH - 60}]}
    db.execute('INSERT INTO provider_invocations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', ('inv1', 'job', 'attempt1', 'provider-inv', None, 'classification', 'e1', 'fixture', 'fixture-model', 'f' * 64, json.dumps(dispatch), EPOCH - 30))
    db.execute('INSERT INTO provider_invocation_events VALUES (?,?,?,?,?,?,?)', (1, 'inv1', 'failure', 'a' * 64, 'PRIVATE ERROR BODY MUST NOT EXPORT', 'available', EPOCH - 29))
    db.commit()
    db.close()
    receipt = {'schemaVersion': 1, 'captureID': directory.name, 'status': 'saved', 'path': str(directory), 'capturedAt': AT, 'worldRevision': 3, 'worldSHA256': '', 'projectionSHA256': '', 'evaluation': 'not_run'}
    meta = {'schemaVersion': 1, 'receipt': receipt, 'requestSHA256': '', 'databaseSHA256': '', 'databaseBytes': 0,
            'pipelineCoverage': 'unknown', 'dispatchIntentCount': 1, 'undispatchedAuditCount': 0,
            'databaseReadStartedAt': EPOCH + .1, 'databaseReadFinishedAt': EPOCH + .2}
    (directory / 'world.json').write_text(json.dumps(world))
    (directory / 'projection.json').write_text(json.dumps(projection))
    (directory / 'capture.json').write_text(json.dumps(meta))
    seal(directory)
    sources = [{'id': f's{i}', 'stratum': 'direct_obligation', 'split': 'holdout', 'sourceIdentity': {'connector': 'fixture', 'accountRef': 'opaque', 'externalID': f'external{i}', 'revision': 'r1'}, 'occurredAt': x.utc(EPOCH - 60), 'snapshotAt': AT, 'eligible30Days': True} for i in range(1, 6)]
    manifest = {'schemaVersion': 1, 'kind': 'manifest', 'id': 'SYNTHETIC-EXPORT-ONLY', 'datasetKind': 'synthetic_scorer_test',
                'selection': {'seed': 'fixture', 'method': 'Synthetic exporter mechanics only', 'frozenAt': AT, 'holdoutFrozenBeforeTuning': True},
                'sourceSamples': sources, 'taskSamples': [{'id': 't1', 'taskID': 'task:a', 'revision': 2, 'snapshotID': 'snap', 'split': 'holdout', 'sourceEventIDs': ['e1']}, {'id': 't2', 'taskID': 'task:b', 'revision': 3, 'snapshotID': 'snap', 'split': 'holdout', 'sourceEventIDs': ['e2']}],
                'snapshots': [{'id': 'snap', 'at': AT, 'split': 'holdout', 'needsYouVisibleCount': 1, 'needsYouTaskSampleIDs': ['t1']}]}
    mapping = {'schemaVersion': 1, 'snapshots': {'snap': directory.name}, 'sources': {f's{i}': {'captureID': directory.name, 'eventID': f'e{i}'} for i in range(1, 6)}, 'accounts': {'opaque': {'connector': 'fixture', 'account': 'private-fixture-account'}}}
    return directory, manifest, mapping


def seal(directory):
    meta = json.loads((directory / 'capture.json').read_text())
    r = meta['receipt']
    r['worldSHA256'] = x.digest((directory / 'world.json').read_bytes())
    projection = json.loads((directory / 'projection.json').read_text())
    projection['world']['hash']['value'] = r['worldSHA256']
    (directory / 'projection.json').write_text(json.dumps(projection))
    r['projectionSHA256'] = x.digest((directory / 'projection.json').read_bytes())
    request = {k: r[k] for k in ('schemaVersion', 'captureID', 'worldRevision', 'worldSHA256', 'projectionSHA256', 'capturedAt')}
    request.update(worldJSON=(directory / 'world.json').read_text(), projectionJSON=(directory / 'projection.json').read_text())
    meta['requestSHA256'] = x.digest(x.swift_json(request))
    meta['databaseSHA256'] = x.file_digest(directory / 'core.sqlite')
    meta['databaseBytes'] = (directory / 'core.sqlite').stat().st_size
    (directory / 'capture.json').write_text(json.dumps(meta))


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.capture, self.manifest, self.mapping = fixture(self.root)
        self.output = self.root / 'output'

    def tearDown(self):
        self.temp.cleanup()

    def run_export(self, captures=None):
        m, b = self.root / 'manifest.json', self.root / 'map.json'
        m.write_text(json.dumps(self.manifest))
        b.write_text(json.dumps(self.mapping))
        return x.export(captures or [self.capture], m, b, self.output, 'synthetic-v1')

    def test_final_outputs_failed_pending_skipped_overlap_and_unknown_gates(self):
        p, d = self.run_export()
        self.assertEqual([r['status'] for r in p['sourcePredictions']], ['completed', 'failed', 'pending', 'skipped', 'pending'])
        self.assertEqual(p['sourcePredictions'][0]['surfacedTaskIDs'], ['task:a'])
        self.assertEqual(p['sourcePredictions'][1]['needsYouTaskIDs'], [])
        self.assertEqual(p['taskPredictions'][1]['surface'], 'waiting')
        self.assertEqual(d['tasks'][1]['memberships'], ['waiting', 'later'])
        self.assertEqual(d['tasks'][0]['renderedRow'], {'id': 'source:linked', 'version': 7})
        self.assertEqual(d['sources'][3]['effectiveEventID'], 'batch')
        self.assertEqual(d['sources'][0]['exactStateAtCapturedAt'], 'unknown')
        self.assertTrue(p['run']['wholePipeline'])
        report = x.validate_with_scorer(self.manifest, p)
        self.assertTrue(all(value is None for value in report['proposedGates'].values()))
        self.assertIn('not_established', report['releaseConclusion'])
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        for f in self.output.iterdir():
            self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)

    def test_no_relabeling_intent_and_no_private_response_body(self):
        p, d = self.run_export()
        self.assertTrue(all(row['modelEvidence'] == [] for row in p['sourcePredictions'] + p['taskPredictions']))
        self.assertEqual(d['capturedDispatches'][0]['dispatchIntent']['attemptedAt'], EPOCH - 30)
        self.assertNotIn('sentAt', json.dumps(d))
        self.assertNotIn('PRIVATE ERROR BODY', json.dumps(d))
        self.assertEqual(d['capturedDispatches'][0]['auditOutcomes'][0]['kind'], 'failure')

    def test_retains_all_hidden_automatic_transitions_excludes_user_done(self):
        p, d = self.run_export()
        self.assertEqual([r['id'] for r in p['automaticCompletions']], ['h1', 'h3'])
        self.assertEqual(p['automaticCompletions'][0]['taskID'], 'task:old-hidden')
        self.assertEqual(d['automaticCompletions'][0]['associations'], [{'sampleKind': 'source', 'sampleID': 's1'}])

    def test_corruption_rejected_before_sqlite_open(self):
        for file in ['world.json', 'projection.json', 'core.sqlite']:
            with self.subTest(file=file):
                path = self.capture / file
                original = path.read_bytes()
                path.write_bytes(original + b' ')
                with patch.object(x.sqlite3, 'connect', side_effect=AssertionError('Database must not be opened')):
                    with self.assertRaises(ValueError): self.run_export()
                self.assertFalse(self.output.exists())
                path.write_bytes(original)

    def test_request_hash_and_receipt_identity_rejected(self):
        meta_path = self.capture / 'capture.json'
        original = json.loads(meta_path.read_text())
        for key, value in [('requestSHA256', '0' * 64), ('databaseBytes', 0)]:
            changed = copy.deepcopy(original); changed[key] = value; meta_path.write_text(json.dumps(changed))
            with self.assertRaises(ValueError): self.run_export()
        changed = copy.deepcopy(original); changed['receipt']['path'] = str(self.root); meta_path.write_text(json.dumps(changed))
        with self.assertRaises(ValueError): self.run_export()

    def test_wrong_immutable_source_revision_or_binding_is_rejected(self):
        self.manifest['sourceSamples'][0]['sourceIdentity']['revision'] = 'r2'
        with self.assertRaises(ValueError): self.run_export()
        self.manifest['sourceSamples'][0]['sourceIdentity']['revision'] = 'r1'
        self.mapping['sources']['s1']['eventID'] = 'missing'
        with self.assertRaises(ValueError): self.run_export()
        self.assertFalse(self.output.exists())

    def test_wrong_task_canonical_version_and_evidence_rejected(self):
        for field, value in [('revision', 7), ('taskID', 'source:linked'), ('sourceEventIDs', [])]:
            saved = self.manifest['taskSamples'][0][field]
            self.manifest['taskSamples'][0][field] = value
            with self.assertRaises(ValueError): self.run_export()
            self.manifest['taskSamples'][0][field] = saved

    def test_top_count_or_order_missing_sample_rejected(self):
        self.manifest['snapshots'][0]['needsYouVisibleCount'] = 2
        with self.assertRaises(ValueError): self.run_export()
        self.manifest['snapshots'][0]['needsYouVisibleCount'] = 1
        self.manifest['snapshots'][0]['needsYouTaskSampleIDs'] = ['t2']
        with self.assertRaises(ValueError): self.run_export()

    def test_projection_reseal_does_not_bypass_world_version_validation(self):
        path = self.capture / 'projection.json'
        p = json.loads(path.read_text()); p['surfaces']['needsYou'][0]['renderedRow']['version'] = 99
        path.write_text(json.dumps(p)); seal(self.capture)
        with self.assertRaises(ValueError): self.run_export()

    def test_database_reseal_does_not_bypass_world_revision_validation(self):
        db = sqlite3.connect(self.capture / 'core.sqlite'); db.execute('DELETE FROM world_history WHERE sequence=3'); db.commit(); db.close(); seal(self.capture)
        with self.assertRaises(ValueError): self.run_export()

    def test_missing_job_is_pending_unknown_not_dropped(self):
        db = sqlite3.connect(self.capture / 'core.sqlite'); db.execute('DELETE FROM processing_jobs'); db.commit(); db.close(); seal(self.capture)
        p, _ = self.run_export()
        self.assertEqual(len(p['sourcePredictions']), 5)
        self.assertTrue(all(r['status'] == 'pending' and r['coverage']['status'] == 'unknown' for r in p['sourcePredictions']))

    def test_invalid_chronology_and_nonexistent_date_rejected(self):
        path = self.capture / 'capture.json'
        meta = json.loads(path.read_text()); meta['databaseReadFinishedAt'] = EPOCH - 1; path.write_text(json.dumps(meta))
        with self.assertRaises(ValueError): self.run_export()
        with self.assertRaises(ValueError): x.iso('2026-02-30T00:00:00Z')
        with self.assertRaises(ValueError): x.iso('2026-02-01T00:00:00+01:99')

    def test_symlinks_and_wal_rejected(self):
        path = self.capture / 'world.json'
        data = path.read_bytes(); path.unlink(); other = self.root / 'other.json'; other.write_bytes(data); path.symlink_to(other)
        with self.assertRaises(ValueError): self.run_export()
        path.unlink(); path.write_bytes(data)
        (self.capture / 'core.sqlite-wal').write_bytes(b'')
        with self.assertRaises(ValueError): self.run_export()

    def test_exclusive_publication_does_not_replace_existing_empty_directory(self):
        self.output.mkdir()
        with self.assertRaises(ValueError): self.run_export()
        self.assertEqual(list(self.output.iterdir()), [])

    def test_mutating_capture_before_publication_rejects_every_output(self):
        original = x.collect
        def mutate(*args):
            result = original(*args)
            with (self.capture / 'world.json').open('ab') as f: f.write(b' ')
            return result
        with patch.object(x, 'collect', side_effect=mutate):
            with self.assertRaises(ValueError): self.run_export()
        self.assertFalse(self.output.exists())

    def test_merged_relation_progress_and_suggestion_event_provenance(self):
        world_path, projection_path = self.capture / 'world.json', self.capture / 'projection.json'
        world = json.loads(world_path.read_text())
        # Shared UI output takes linked suggestion.eventID instead of canonical task's raw IDs,
        # plus merged member and progress evidence. It need not equal either raw task list.
        world['suggestions'][0]['eventID'] = 'e3'
        world['taskRelations'] = [{'duplicateID': 'task:b', 'primaryID': 'task:a'}]
        world['taskProgress'] = [{'nodeID': 'task:a', 'eventID': 'e4'}]
        world_path.write_text(json.dumps(world))
        db = sqlite3.connect(self.capture / 'core.sqlite')
        db.execute('UPDATE task_suggestions SET json=?', (json.dumps(world['suggestions'][0]),)); db.commit(); db.close()
        projection = json.loads(projection_path.read_text())
        projection['surfaces']['needsYou'][0]['sourceEventIDs'] = ['e3', 'e2', 'e4']
        projection['topTenNeedsYou'] = projection['surfaces']['needsYou'][:]
        projection_path.write_text(json.dumps(projection)); seal(self.capture)
        self.manifest['taskSamples'][0]['sourceEventIDs'] = ['e3', 'e2', 'e4']
        p, _ = self.run_export()
        self.assertEqual(p['sourcePredictions'][0]['surfacedTaskIDs'], [])
        self.assertEqual(p['sourcePredictions'][2]['surfacedTaskIDs'], ['task:a'])
        self.assertIn('task:a', p['sourcePredictions'][1]['surfacedTaskIDs'])

    def test_duplicate_real_account_alias_cannot_inflate_denominator(self):
        duplicate = copy.deepcopy(self.manifest['sourceSamples'][0])
        duplicate['id'] = 'alias'; duplicate['sourceIdentity']['accountRef'] = 'other-opaque'
        self.manifest['sourceSamples'].append(duplicate)
        self.mapping['sources']['alias'] = copy.deepcopy(self.mapping['sources']['s1'])
        self.mapping['accounts']['other-opaque'] = copy.deepcopy(self.mapping['accounts']['opaque'])
        with self.assertRaisesRegex(ValueError, 'actual source identity'): self.run_export()
        self.assertFalse(self.output.exists())

    def test_completion_with_mixed_source_task_splits_rejected(self):
        # Associate a retained completion with current task a and source s1 in different splits.
        db = sqlite3.connect(self.capture / 'core.sqlite')
        row = json.loads(db.execute('SELECT json FROM world_history WHERE sequence=1').fetchone()[0])
        for key in ['before', 'after']:
            body = json.loads(row[key]); body['id'] = 'a'; row[key] = json.dumps(body)
        db.execute('UPDATE world_history SET json=? WHERE sequence=1', (json.dumps(row),)); db.commit(); db.close(); seal(self.capture)
        self.manifest['sourceSamples'][0]['split'] = 'tuning'
        with self.assertRaisesRegex(ValueError, 'conflicting sample splits'): self.run_export()

    def test_attempt_bound_committed_completion_response_preserves_proof(self):
        db = sqlite3.connect(self.capture / 'core.sqlite')
        db.execute('CREATE TABLE task_reconciliation_jobs(id TEXT PRIMARY KEY,status,response,input)')
        response = json.dumps({'duplicates': [], 'progress': [{'nodeID': 'task:old-hidden', 'status': 'completed', 'eventID': 'e3'}]})
        db.execute('INSERT INTO task_reconciliation_jobs VALUES (?,?,?,?)', ('completion-job', 'done', response, json.dumps({'nodes': [{'id': 'task:old-hidden', 'sourceIDs': ['e5']}]})))
        db.execute('UPDATE provider_invocations SET stage=?,job_id=? WHERE id=?', ('task_reconciliation', 'completion-job', 'inv1'))
        db.execute('INSERT INTO provider_invocation_events VALUES (?,?,?,?,?,?,?)', (2, 'inv1', 'response', x.digest(response.encode()), response, 'available', EPOCH - 25))
        db.commit(); db.close(); seal(self.capture)
        p, d = self.run_export()
        self.assertEqual(p['automaticCompletions'][0]['evidenceIDs'], ['e3'])
        self.assertEqual(p['automaticCompletions'][1]['evidenceIDs'], [])
        self.assertIn({'sampleKind': 'source', 'sampleID': 's3'}, d['automaticCompletions'][0]['associations'])
        self.assertIn({'sampleKind': 'source', 'sampleID': 's5'}, d['automaticCompletions'][0]['associations'])

    def test_unrelated_task_source_swap_rejected_even_with_resealed_hashes(self):
        path = self.capture / 'projection.json'
        projection = json.loads(path.read_text())
        projection['surfaces']['needsYou'][0]['sourceEventIDs'] = ['e2']
        projection['topTenNeedsYou'] = projection['surfaces']['needsYou'][:]
        path.write_text(json.dumps(projection)); seal(self.capture)
        self.manifest['taskSamples'][0]['sourceEventIDs'] = ['e2']
        with self.assertRaisesRegex(ValueError, 'task relation/progress provenance'): self.run_export()

    def test_same_response_merge_retains_duplicate_source_completion_association(self):
        db = sqlite3.connect(self.capture / 'core.sqlite')
        db.execute('CREATE TABLE task_reconciliation_jobs(id TEXT PRIMARY KEY,status,response,input)')
        response = json.dumps({'duplicates': [{'firstID': 'task:old-hidden', 'secondID': 'source:new-duplicate'}],
                               'progress': [{'nodeID': 'task:old-hidden', 'status': 'completed', 'eventID': 'e3'}]})
        input_json = json.dumps({'nodes': [{'id': 'task:old-hidden', 'sourceIDs': ['e1']}, {'id': 'source:new-duplicate', 'sourceIDs': ['e5']}]})
        db.execute('INSERT INTO task_reconciliation_jobs VALUES (?,?,?,?)', ('completion-job', 'done', response, input_json))
        db.execute('UPDATE provider_invocations SET stage=?,job_id=? WHERE id=?', ('task_reconciliation', 'completion-job', 'inv1'))
        db.execute('INSERT INTO provider_invocation_events VALUES (?,?,?,?,?,?,?)', (2, 'inv1', 'response', x.digest(response.encode()), response, 'available', EPOCH - 25))
        db.commit(); db.close(); seal(self.capture)
        p, d = self.run_export()
        completion = d['automaticCompletions'][0]
        self.assertIn({'sampleKind': 'source', 'sampleID': 's5'}, completion['associations'])
        self.assertEqual(p['automaticCompletions'][0]['evidenceIDs'], ['e3'])
        self.assertIn('e5', completion['provenanceEventIDs'])

    def test_multiple_captures_dedupe_history_keep_each_source_observation(self):
        other = self.root / str(uuid.uuid4()); import shutil; shutil.copytree(self.capture, other)
        meta = json.loads((other / 'capture.json').read_text())
        meta['receipt']['captureID'] = other.name; meta['receipt']['path'] = str(other)
        (other / 'capture.json').write_text(json.dumps(meta)); seal(other)
        self.mapping['sources']['s2']['captureID'] = other.name
        p, d = self.run_export([self.capture, other])
        self.assertEqual(len(p['automaticCompletions']), 2)
        self.assertEqual(len(d['captures']), 2)

    def test_swift_encoder_solidus_unicode_and_duplicate_json_keys(self):
        self.assertEqual(x.swift_json({'z': 'a/b☃', 'a': 1}), '{"a":1,"z":"a\\/b☃"}'.encode())
        with self.assertRaises(ValueError): x.parse('{"id":1,"id":2}')
        with self.assertRaises(ValueError): x.parse('{"value":NaN}')


if __name__ == '__main__': unittest.main()
