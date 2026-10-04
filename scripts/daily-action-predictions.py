#!/usr/bin/env python3
"""Export sampled final outputs from explicitly supplied, immutable local quality captures."""
import argparse
import ctypes
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import uuid

MAX_JSON = 32 * 1024 * 1024
MAX_DB = 64 * 1024 * 1024 * 1024
SURFACES = ('needsYou', 'waiting', 'later')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def parse(data):
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON number')))


def regular(path):
    require(stat.S_ISREG(path.lstat().st_mode), 'Input must be a regular file, not a symlink')


def read(path, limit=MAX_JSON):
    regular(path)
    require(path.stat().st_size <= limit, 'Input exceeds size limit')
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'Input exceeds size limit')
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    regular(path)
    require(path.stat().st_size <= MAX_DB, 'Database exceeds size limit')
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def iso(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)', value), 'Invalid ISO timestamp')
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    offset = re.search(r'([+-])(\d\d):(\d\d)$', value)
    require(not offset or int(offset[2]) < 24 and int(offset[3]) < 60, 'Invalid timestamp offset')
    return result.timestamp()


def epoch(value):
    require(type(value) in (int, float) and math.isfinite(value), 'Invalid epoch timestamp')
    return value


def utc(value):
    return dt.datetime.fromtimestamp(epoch(value), dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def index(rows, key='id'):
    require(isinstance(rows, list), 'Expected array')
    result = {}
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get(key), str) and row[key] and row[key] not in result, 'Missing or duplicate identity')
        result[row[key]] = row
    return result


def swift_json(value):
    # JSONCodec uses sorted keys, literal UTF-8 and JSONEncoder's escaped solidus.
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).replace('/', '\\/').encode()


class Capture:
    def __init__(self, path):
        self.path = Path(path).absolute()
        require(stat.S_ISDIR(self.path.lstat().st_mode), 'Capture must be a directory, not a symlink')
        self.path = self.path.resolve()
        self.raw = {name: read(self.path / name, limit) for name, limit in
                    [('capture.json', 1024 * 1024), ('world.json', MAX_JSON), ('projection.json', 8 * 1024 * 1024)]}
        self.meta, self.world, self.projection = (parse(self.raw[n]) for n in ('capture.json', 'world.json', 'projection.json'))
        m, r = self.meta, self.meta['receipt']
        self.receipt, self.id = r, r['captureID']
        require(m['schemaVersion'] == r['schemaVersion'] == 1 and r['status'] == 'saved' and r['evaluation'] == 'not_run', 'Unsupported capture receipt')
        require(str(uuid.UUID(self.id)) == self.id.lower() and self.path.name == self.id.lower(), 'Capture directory identity mismatch')
        require(Path(r['path']).is_absolute() and Path(r['path']).resolve() == self.path, 'Receipt path mismatch')
        require(digest(self.raw['world.json']) == r['worldSHA256'] and digest(self.raw['projection.json']) == r['projectionSHA256'], 'Capture JSON hash mismatch')
        self.at = iso(r['capturedAt'])
        self.started, self.finished = epoch(m['databaseReadStartedAt']), epoch(m['databaseReadFinishedAt'])
        require(epoch(self.world['asOf']) <= self.at and self.started <= self.finished and self.at <= self.finished + 60, 'Capture clock ordering mismatch')
        require(self.finished <= dt.datetime.now(dt.timezone.utc).timestamp() + 60, 'Capture read interval is in the future')
        require(type(r['worldRevision']) is int and r['worldRevision'] >= 0 and self.world['revision'] == r['worldRevision'], 'World revision mismatch')
        request = {key: r[key] for key in ('schemaVersion', 'captureID', 'worldRevision', 'worldSHA256', 'projectionSHA256', 'capturedAt')}
        request.update(worldJSON=self.raw['world.json'].decode(), projectionJSON=self.raw['projection.json'].decode())
        require(digest(swift_json(request)) == m['requestSHA256'], 'Capture request hash mismatch')
        self.dbpath = self.path / 'core.sqlite'
        require(all(not (self.path / ('core.sqlite' + suffix)).exists() for suffix in ('-wal', '-shm', '-journal')), 'Capture has database sidecars')
        regular(self.dbpath)
        require(type(m['databaseBytes']) is int and self.dbpath.stat().st_size == m['databaseBytes'], 'Database size mismatch')
        require(file_digest(self.dbpath) == m['databaseSHA256'], 'Database hash mismatch')
        self.nodes = {'task:' + k: v for k, v in index(self.world['tasks']).items()}
        self.nodes.update({'source:' + k: v for k, v in index(self.world['suggestions']).items()})
        self.rows, self.memberships = {}, {}
        self.validate_projection()
        self.db = None

    def validate_projection(self):
        p, r = self.projection, self.receipt
        require(p['schemaVersion'] == 1 and p['kind'] == 'current-ui-task-projection' and p['currentOnly'] is True and p['scope'] == 'unfiltered-task-tabs' and p['visibility'] == 'tab-membership-not-viewport', 'Unsupported projection scope')
        require(iso(p['capturedAt']) == self.at and p['world']['revision'] == r['worldRevision'] and abs(iso(p['world']['asOf']) - self.world['asOf']) < .0011, 'Projection clock/revision mismatch')
        require(p['world']['hash']['algorithm'] == 'SHA-256' and p['world']['hash']['value'] == r['worldSHA256'], 'Projection world hash mismatch')
        require(set(p['surfaces']) == set(SURFACES), 'Unexpected projection surface')
        rendered = {}
        # Validate only evidence identity graph. Recorded shared-UI membership/order stays
        # authoritative; this does not rank, filter by time, or rebuild historical UI.
        relations = {}
        for relation in self.world.get('taskRelations', []):
            require(relation['duplicateID'] not in relations, 'Duplicate relation identity')
            relations[relation['duplicateID']] = relation['primaryID']
        def root(node):
            visited = set()
            while node in relations:
                require(node not in visited, 'Cyclic task relations')
                visited.add(node)
                node = relations[node]
            return node
        for node in relations: root(node)
        tasks = {t['id']: t for t in self.world['tasks']}
        pending = [s for s in self.world['suggestions'] if s.get('reviewStatus') == 'pending']
        entries = {}
        for task in tasks.values():
            linked = next((s for s in pending if s.get('linkedTaskID') == task['id']), None)
            entries['task:' + task['id']] = [linked['eventID']] if linked else task['evidenceIDs']
        for suggestion in pending:
            if suggestion.get('linkedTaskID') not in tasks:
                entries['source:' + suggestion['id']] = [suggestion['eventID']]
        def provenance_for(key):
            allowed = set()
            for node, evidence in entries.items():
                if node == key or root(node) == key:
                    allowed.update(evidence)
            progress = next((p for p in self.world.get('taskProgress', []) if p['nodeID'] == key), None)
            if progress: allowed.add(progress['eventID'])
            return allowed
        for surface in SURFACES:
            seen = set()
            require(len(p['surfaces'][surface]) <= 50000, 'Projection exceeds row limit')
            for row in p['surfaces'][surface]:
                key = row['rankedNode']['id']
                require(key not in seen, 'Duplicate surface row')
                seen.add(key)
                for part in ('rankedNode', 'renderedRow'):
                    node = row[part]
                    require(node['id'] in self.nodes and type(node['version']) is int and node['version'] == self.nodes[node['id']]['version'], 'Projection identity/version mismatch')
                other = row['renderedRow']['id']
                require(other not in rendered or rendered[other] == key, 'Conflicting rendered identity')
                rendered[other] = key
                if other != key:
                    require(key.startswith('task:') and other.startswith('source:') and self.nodes[other].get('linkedTaskID') == key[5:], 'Rendered suggestion is not linked to ranked task')
                require(isinstance(row['sourceEventIDs'], list) and all(isinstance(i, str) and i for i in row['sourceEventIDs']), 'Invalid projection evidence')
                require(set(row['sourceEventIDs']) == provenance_for(key) and len(set(row['sourceEventIDs'])) == len(row['sourceEventIDs']), 'Projection evidence differs from its task relation/progress provenance or is duplicated')
                require(key not in self.rows or self.rows[key] == row, 'Conflicting cross-surface row')
                self.rows[key] = row
                self.memberships.setdefault(key, []).append(surface)
        require(p['topTenNeedsYou'] == p['surfaces']['needsYou'][:10], 'Projection top-ten mismatch')

    def open(self):
        self.db = sqlite3.connect(self.dbpath.as_uri() + '?mode=ro&immutable=1', uri=True)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA query_only=ON')
        self.db.execute('PRAGMA trusted_schema=OFF')
        require(self.db.execute('PRAGMA quick_check').fetchall()[0][0] == 'ok', 'Frozen database integrity check failed')
        self.tables = {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        require({'events', 'world_history', 'life_tasks', 'task_suggestions'} <= self.tables, 'Missing frozen core tables')
        require(self.db.execute('SELECT COALESCE(MAX(sequence),0) FROM world_history').fetchone()[0] == self.receipt['worldRevision'], 'Frozen database revision mismatch')
        for row in self.rows.values():
            for event_id in row['sourceEventIDs']:
                require(self.db.execute('SELECT 1 FROM events WHERE id=?', (event_id,)).fetchone() is not None, 'Projected evidence has no immutable source')
        for table, field in [('life_tasks', 'tasks'), ('task_suggestions', 'suggestions')]:
            for node in self.world[field]:
                stored = self.db.execute(f'SELECT json FROM {table} WHERE id=?', (node['id'],)).fetchone()
                require(stored is not None and parse(stored[0]) == node, 'Accepted world differs from frozen task record')

    def verify_unchanged(self):
        for name, data in self.raw.items():
            require(read(self.path / name) == data, 'Capture changed while reading')
        require(file_digest(self.dbpath) == self.meta['databaseSHA256'], 'Database changed while reading')

    def source_status(self, event_id):
        effective = event_id
        if 'home_batch_members' in self.tables:
            batch = self.db.execute('SELECT batch_id FROM home_batch_members WHERE event_id=?', (event_id,)).fetchall()
            require(len(batch) <= 1, 'Conflicting HA batch identity')
            if batch:
                effective = batch[0][0]
        states = {}
        for table in ('processing_jobs', 'fact_jobs', 'task_extraction_jobs', 'state_jobs'):
            if table not in self.tables:
                states[table] = None
                continue
            rows = self.db.execute(f'SELECT status FROM {table} WHERE event_id=?', (effective,)).fetchall()
            require(len(rows) <= 1, 'Conflicting source job identity')
            states[table] = rows[0][0] if rows else None
        values = set(states.values())
        if values & {'failed', 'blocked'}:
            status = 'failed'
        elif values & {'pending', 'leased', 'processing', 'running'}:
            status = 'pending'
        elif states['processing_jobs'] in ('coalesced', 'outside_window'):
            status = 'skipped'
        elif states['processing_jobs'] == 'succeeded' and not (values - {None, 'succeeded', 'done', 'skipped', 'not_applicable'}):
            status = 'completed'
        else:
            status = 'pending'
        return status, {'effectiveEventID': effective, 'queueStates': states,
                        'observationInterval': {'startedAt': utc(self.started), 'finishedAt': utc(self.finished)},
                        'exactStateAtCapturedAt': 'unknown'}



def completion_proof(capture, history, node_id):
    """Only exact attempt-bound response + committed job agreement establishes proof IDs."""
    tables = {'provider_invocations', 'provider_invocation_events', 'task_reconciliation_jobs'}
    if not tables <= capture.tables:
        return [], []
    evidence, provenance = set(), set()
    for inv in capture.db.execute("SELECT id,job_id FROM provider_invocations WHERE attempt_id=? AND stage='task_reconciliation'", (history['correlationID'],)):
        job = capture.db.execute('SELECT status,response,input FROM task_reconciliation_jobs WHERE id=?', (inv['job_id'],)).fetchone()
        if job is None or job['status'] != 'done' or not job['response']:
            continue
        response = parse(job['response'])
        matching = False
        for audit in capture.db.execute("SELECT payload,payload_sha256 FROM provider_invocation_events WHERE invocation_id=? AND kind='response' AND availability='available'", (inv['id'],)):
            if audit['payload'] and parse(audit['payload']) == response:
                require(digest(audit['payload'].encode()) == audit['payload_sha256'], 'Completion response hash mismatch')
                matching = True
        if not matching:
            continue
        # Same-transaction merges can add provenance after the captured input was made.
        component = {node_id}
        changed = True
        while changed:
            changed = False
            for pair in response.get('duplicates', []):
                members = {pair['firstID'], pair['secondID']}
                if component & members and not members <= component:
                    component.update(members)
                    changed = True
        for update in response.get('progress', []):
            if update.get('nodeID') in component and update.get('status') == 'completed':
                event_id = update.get('eventID')
                require(isinstance(event_id, str) and capture.db.execute('SELECT 1 FROM events WHERE id=?', (event_id,)).fetchone() is not None, 'Completion proof references missing immutable source')
                evidence.add(event_id)
                if job['input']:
                    for node in parse(job['input']).get('nodes', []):
                        if node.get('id') in component:
                            for source_id in node.get('sourceIDs', []):
                                require(isinstance(source_id, str) and capture.db.execute('SELECT 1 FROM events WHERE id=?', (source_id,)).fetchone() is not None, 'Completion input provenance references missing source')
                                provenance.add(source_id)
    return sorted(evidence), sorted(provenance)


def validate_with_scorer(manifest, predictions):
    spec = importlib.util.spec_from_file_location('daily_action_score', Path(__file__).with_name('daily-action-score.py'))
    scorer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scorer)
    return scorer.score(manifest, {'schemaVersion': 1, 'kind': 'labels', 'manifestID': manifest['id'],
                                  'sourceLabels': [], 'taskLabels': [], 'completionLabels': []}, predictions)


def collect(manifest, mapping, captures, pipeline_version):
    require(mapping.get('schemaVersion') == 1, 'Unsupported snapshot map')
    snapshots, sources, tasks = (index(manifest[name]) for name in ('snapshots', 'sourceSamples', 'taskSamples'))
    require(set(mapping['snapshots']) == set(snapshots) and set(mapping['sources']) == set(sources), 'Bindings must cover exactly every selected sample/snapshot')
    referenced = set(mapping['snapshots'].values()) | {v['captureID'] for v in mapping['sources'].values()}
    require(referenced == set(captures), 'Supply exactly the explicitly bound captures')
    require(set(mapping['accounts']) == {s['sourceIdentity']['accountRef'] for s in sources.values()}, 'Account mapping must match selected account references')
    predictions = {'schemaVersion': 2, 'kind': 'predictions', 'manifestID': manifest['id'],
                   'run': {'id': str(uuid.uuid4()), 'pipelineVersion': pipeline_version, 'at': utc(dt.datetime.now(dt.timezone.utc).timestamp()),
                           'wholePipeline': True, 'coverage': {'status': 'unknown', 'completionHistory': 'unknown'}},
                   'sourcePredictions': [], 'taskPredictions': [], 'automaticCompletions': []}
    diagnostics = {'schemaVersion': 1, 'kind': 'frozen-capture-prediction-bindings', 'manifestID': manifest['id'],
                   'evaluation': 'not_run', 'datasetKind': manifest['datasetKind'], 'scope': 'final-unfiltered-task-tabs-and-frozen-source-state',
                   'wholePipelineReason': 'Final accepted UI projections and committed source/task history from validated frozen captures; no extractor rerun or historical UI reconstruction.',
                   'coverageGaps': ['Model send chronology and exhaustive invocation coverage are unknown; dispatch intents are not proven sends.',
                                    'Completion history may predate retained audit evidence; completeness remains unknown.',
                                    'Source states are observed during each database read interval, not an exact historical state at the web capture timestamp.'],
                   'captures': [], 'snapshots': [], 'sources': [], 'tasks': [], 'automaticCompletions': [], 'capturedDispatches': []}
    associations = {cid: {'sources': {}, 'tasks': {}} for cid in captures}
    for sid, snapshot in snapshots.items():
        c = captures[mapping['snapshots'][sid]]
        require(iso(snapshot['at']) == c.at, 'Snapshot timestamp does not bind to capture')
        top = [tasks[t]['taskID'] for t in snapshot['needsYouTaskSampleIDs']]
        require(snapshot['needsYouVisibleCount'] == len(c.projection['surfaces']['needsYou']) and top == [r['rankedNode']['id'] for r in c.projection['topTenNeedsYou']], 'Selected top-ten order/count differs from captured projection')
        diagnostics['snapshots'].append({'snapshotID': sid, 'captureID': c.id, 'worldAsOf': utc(c.world['asOf']), 'capturedAt': c.receipt['capturedAt'], 'surfaceCounts': {s: len(c.projection['surfaces'][s]) for s in SURFACES}, 'topTenNeedsYou': c.projection['topTenNeedsYou']})
    actual_source_identities = set()
    for sid, sample in sources.items():
        binding, identity = mapping['sources'][sid], sample['sourceIdentity']
        c, event_id = captures[binding['captureID']], binding['eventID']
        require(iso(sample['snapshotAt']) == c.at, 'Source snapshot timestamp does not bind to capture')
        account = mapping['accounts'][identity['accountRef']]
        require(account['connector'] == identity['connector'], 'Account connector mismatch')
        event = c.db.execute('SELECT connector,account,external_id,revision,occurred_at FROM events WHERE id=?', (event_id,)).fetchone()
        require(event is not None and tuple(event[:4]) == (identity['connector'], account['account'], identity['externalID'], identity['revision']) and abs(epoch(event[4]) - iso(sample['occurredAt'])) < .000001, 'Selected immutable source identity/revision/time mismatch')
        actual_identity = tuple(event[:3])
        require(actual_identity not in actual_source_identities, 'Aliased or duplicate actual source identity in selected population')
        actual_source_identities.add(actual_identity)
        surfaced = [key for key, row in c.rows.items() if event_id in row['sourceEventIDs']]
        status, observed = c.source_status(event_id)
        predictions['sourcePredictions'].append({'sampleID': sid, 'status': status, 'surfacedTaskIDs': surfaced,
                                                'needsYouTaskIDs': [key for key in surfaced if 'needsYou' in c.memberships[key]],
                                                'modelEvidence': [], 'coverage': {'status': 'unknown', 'modelCallCount': None}})
        associations[c.id]['sources'][sid] = event_id
        diagnostics['sources'].append({'sampleID': sid, 'captureID': c.id, 'eventID': event_id, 'status': status, **observed})
    for sid, sample in tasks.items():
        c = captures[mapping['snapshots'][sample['snapshotID']]]
        key = sample['taskID']
        require(key in c.rows and str(sample['revision']) == str(c.rows[key]['rankedNode']['version']), 'Selected task is missing or version mismatched')
        require(sample['sourceEventIDs'] == c.rows[key]['sourceEventIDs'], 'Selected task evidence differs from projection')
        members = c.memberships[key]
        surface = 'needs_you' if 'needsYou' in members else 'waiting' if 'waiting' in members else 'later'
        predictions['taskPredictions'].append({'sampleID': sid, 'taskID': key, 'surface': surface, 'modelEvidence': [], 'coverage': {'status': 'unknown', 'modelCallCount': None}})
        associations[c.id]['tasks'][sid] = key
        diagnostics['tasks'].append({'sampleID': sid, 'captureID': c.id, 'memberships': members, **c.rows[key]})
    completion_rows = {}
    for c in captures.values():
        diagnostics['captures'].append({'captureID': c.id, 'worldRevision': c.receipt['worldRevision'], 'worldSHA256': c.receipt['worldSHA256'], 'projectionSHA256': c.receipt['projectionSHA256'], 'databaseSHA256': c.meta['databaseSHA256'], 'capturedAt': c.receipt['capturedAt'], 'databaseReadStartedAt': utc(c.started), 'databaseReadFinishedAt': utc(c.finished), 'pipelineCoverage': 'unknown', 'captureClockAheadOfDatabaseRead': c.at > c.started})
        relevant_events = set(associations[c.id]['sources'].values())
        for key in associations[c.id]['tasks'].values():
            relevant_events.update(c.rows[key]['sourceEventIDs'])
        if 'provider_invocations' in c.tables and 'provider_invocation_events' in c.tables:
            for inv in c.db.execute('SELECT * FROM provider_invocations ORDER BY recorded_at,id'):
                dispatch = parse(inv['dispatch_json']) if inv['dispatch_json'] else None
                evidence = dispatch.get('evidence', []) if dispatch else []
                if inv['event_id'] not in relevant_events and not relevant_events.intersection(e.get('eventID') for e in evidence):
                    continue
                outcomes = [dict(r) for r in c.db.execute('SELECT kind,availability,payload_sha256 AS payloadSHA256,recorded_at AS recordedAt FROM provider_invocation_events WHERE invocation_id=? ORDER BY sequence', (inv['id'],))]
                diagnostics['capturedDispatches'].append({'captureID': c.id, 'id': inv['id'], 'attemptID': inv['attempt_id'], 'invocationID': inv['invocation_id'], 'parentID': inv['parent_id'], 'stage': inv['stage'], 'provider': inv['provider'], 'model': inv['model'], 'contextSHA256': inv['context_sha256'], 'dispatchIntent': dispatch, 'auditOutcomes': outcomes, 'actualSendTime': 'unknown'})
        for record in c.db.execute('SELECT json FROM world_history ORDER BY sequence'):
            h = parse(record[0])
            if h.get('actor') == 'user' or h.get('type') != 'task.completed':
                continue
            require(epoch(h['recordedAt']) <= c.finished + .001, 'History exceeds database observation interval')
            if h.get('actor') != 'task-reconciliation':
                diagnostics['coverageGaps'].append('Unrecognized automatic completion actor; transition not classified: ' + h['id'])
                continue
            require(h.get('before') and h.get('after'), 'Known completion lacks before/after history')
            before, after = parse(h['before']), parse(h['after'])
            old, new = before.get('candidate', before), after.get('candidate', after)
            require(old['status'] != 'completed' and new['status'] == 'completed', 'Malformed automatic completion transition')
            key = ('source:' if 'candidate' in after else 'task:') + after['id']
            evidence = sorted(set(old.get('evidenceIDs', []) + new.get('evidenceIDs', []) + ([after['eventID']] if after.get('eventID') else [])))
            proof, input_provenance = completion_proof(c, h, key)
            evidence = sorted(set(evidence + input_provenance))
            refs = [{'sampleKind': 'source', 'sampleID': sid} for sid, eid in associations[c.id]['sources'].items() if eid in set(evidence + proof)]
            refs += [{'sampleKind': 'task', 'sampleID': sid} for sid, node in associations[c.id]['tasks'].items() if node == key]
            if not refs:
                continue
            signature = {'taskID': key, 'evidenceIDs': evidence, 'history': h}
            if h['id'] in completion_rows:
                require(completion_rows[h['id']]['signature']['history'] == h and completion_rows[h['id']]['signature']['taskID'] == key, 'Conflicting completion identity across captures')
                entry = completion_rows[h['id']]
                entry['signature']['evidenceIDs'] = sorted(set(entry['signature']['evidenceIDs'] + evidence))
                entry['associations'].extend(r for r in refs if r not in entry['associations'])
                entry['captureIDs'].append(c.id)
                if entry['proof'] and proof:
                    require(entry['proof'] == proof, 'Conflicting completion proof across captures')
                entry['proof'] = entry['proof'] or proof
            else:
                completion_rows[h['id']] = {'signature': signature, 'associations': refs, 'captureIDs': [c.id], 'proof': proof}
    for cid, entry in sorted(completion_rows.items()):
        sig = entry['signature']
        refs = sorted(entry['associations'], key=lambda r: (r['sampleKind'], r['sampleID']))
        splits = {(sources if r['sampleKind'] == 'source' else tasks)[r['sampleID']]['split'] for r in refs}
        require(len(splits) == 1, 'Automatic completion is associated with conflicting sample splits')
        entry['associations'] = refs
        predictions['automaticCompletions'].append({'id': cid, **entry['associations'][0], 'taskID': sig['taskID'], 'evidenceIDs': entry['proof']})
        diagnostics['automaticCompletions'].append({'id': cid, 'taskID': sig['taskID'], 'captureIDs': entry['captureIDs'], 'associations': entry['associations'], 'recordedAt': utc(sig['history']['recordedAt']), 'actor': sig['history']['actor'], 'provenanceEventIDs': sig['evidenceIDs'], 'evidenceScope': 'Exact attempt response agrees with committed reconciliation result.' if entry['proof'] else 'Completion-specific evidence unavailable; task provenance is retained separately and not scored as completion proof.'})
    validate_with_scorer(manifest, predictions)
    return predictions, diagnostics


def publish(output, documents):
    output = Path(output).absolute()
    require(output.parent.is_dir() and not output.exists() and not output.is_symlink(), 'Output must be a new directory under an existing parent')
    staging = Path(tempfile.mkdtemp(prefix='.daily-action-predictions-', dir=output.parent))
    try:
        os.chmod(staging, 0o700)
        for name, document in documents.items():
            fd = os.open(staging / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump(document, stream, ensure_ascii=False, indent=2, allow_nan=False)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
        fd = os.open(staging, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        # Atomic no-replace publication: never overwrite even an empty directory in a race.
        libc = ctypes.CDLL(None, use_errno=True)
        if sys.platform == 'darwin':
            result = libc.renamex_np(os.fsencode(staging), os.fsencode(output), 4)  # RENAME_EXCL
        elif sys.platform.startswith('linux') and hasattr(libc, 'renameat2'):
            result = libc.renameat2(-100, os.fsencode(staging), -100, os.fsencode(output), 1)
        else:
            raise ValueError('Exclusive atomic directory publication is unsupported on this platform')
        if result:
            raise OSError(ctypes.get_errno(), 'Exclusive output publication failed')
        fd = os.open(output.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def export(capture_paths, manifest_path, map_path, output, pipeline_version):
    require(isinstance(pipeline_version, str) and pipeline_version.strip(), 'Pipeline version is required')
    manifest, mapping = parse(read(Path(manifest_path))), parse(read(Path(map_path), 8 * 1024 * 1024))
    captures = {}
    try:
        # Validate every artifact before opening even the first frozen SQLite file.
        for path in capture_paths:
            capture = Capture(path)
            require(capture.id not in captures, 'Duplicate supplied capture')
            captures[capture.id] = capture
        for capture in captures.values():
            capture.open()
        predictions, diagnostics = collect(manifest, mapping, captures, pipeline_version)
        for capture in captures.values():
            capture.verify_unchanged()
        publish(output, {'predictions.json': predictions, 'diagnostics.json': diagnostics})
        return predictions, diagnostics
    finally:
        for capture in captures.values():
            if capture.db:
                capture.db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='append', required=True, help='Explicit frozen capture directory; repeat for multiple captures')
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--snapshot-map', required=True)
    parser.add_argument('--output', required=True, help='New private output directory; never overwritten')
    parser.add_argument('--pipeline-version', required=True)
    args = parser.parse_args()
    try:
        export(args.capture, args.manifest, args.snapshot_map, args.output, args.pipeline_version)
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error, OverflowError) as error:
        # Do not print private SQL, input bodies, filenames from parser errors or source values.
        print('Export rejected (' + type(error).__name__ + '). Validate the supplied capture and bindings; no evaluation was run.', file=sys.stderr)
        return 1
    print('Private predictions and diagnostics saved. Quality evaluation not run; coverage remains unknown.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
