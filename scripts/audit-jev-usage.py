#!/usr/bin/env python3
"""Read-only Jev usage audit. Emits aggregate metadata, never source text or credentials.
Usage: python3 scripts/audit-jev-usage.py --database /path/to/core.sqlite
Recorded usage is provider-reported, not inferred from character counts. Responses
recorded both at invocation and commit are counted once; legacy decisions fill gaps.
"""
import argparse
import collections
import datetime as dt
import json
import pathlib
import sqlite3
import statistics


def audit(path):
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.execute('BEGIN')  # Consistent read snapshot while collectors continue.
    by_source = collections.defaultdict(collections.Counter)
    by_day = collections.defaultdict(collections.Counter)
    accounted = set()
    known_responses = set()
    missing_usage = 0

    def add(connector, raw, timestamp):
        nonlocal missing_usage
        try:
            usage = json.loads(raw).get('usage', {})
        except (ValueError, AttributeError):
            missing_usage += 1
            return
        if not isinstance(usage, dict) or not all(isinstance(usage.get(k), int) and not isinstance(usage[k], bool) and usage[k] >= 0 for k in ('input_tokens', 'output_tokens')):
            missing_usage += 1
            return
        values = {'responses_with_usage': 1, 'input_tokens': usage['input_tokens'], 'output_tokens': usage['output_tokens']}
        by_source[connector].update(values)
        day = dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).strftime('%Y-%m-%d')
        by_day[day].update(values)

    # Child attempts represent HTTP invocations; parent commit artifacts duplicate them.
    for row in db.execute("SELECT a.event_id,a.stage,e.connector,a.payload,p.started_at FROM source_artifacts a JOIN source_attempts p ON p.id=a.attempt_id JOIN events e ON e.id=a.event_id WHERE a.kind='response' AND p.provider='typesafe' AND p.parent_id IS NOT NULL"):
        add(row['connector'], row['payload'] or '', row['started_at'])
        known_responses.add((row['event_id'], row['payload']))
        if row['stage'] == 'classification':
            accounted.add(row['event_id'])
    for row in db.execute("SELECT d.event_id,e.connector,d.raw_response,json_extract(d.json,'$.createdAt') AS at FROM decisions d JOIN events e ON e.id=d.event_id WHERE json_extract(d.json,'$.assessment.provider')='typesafe'"):
        known_responses.add((row['event_id'], row['raw_response']))
        if row['event_id'] not in accounted:
            add(row['connector'], row['raw_response'], float(row['at']))

    # Classification writes its own response to fact_checks too. Only unmatched
    # legacy responses add usage; no additional HTTP invocation is inferred.
    legacy_fact_checks = 0
    for row in db.execute("SELECT f.event_id,e.connector,json_extract(f.json,'$.rawResponse') AS raw,json_extract(f.json,'$.checkedAt') AS at FROM fact_checks f JOIN events e ON e.id=f.event_id WHERE json_extract(f.json,'$.provider')='typesafe' AND json_extract(f.json,'$.rawResponse') IS NOT NULL"):
        if (row['event_id'], row['raw']) not in known_responses:
            add(row['connector'], row['raw'], float(row['at']))
            legacy_fact_checks += 1

    requests = collections.defaultdict(list)
    parts = collections.defaultdict(collections.Counter)
    attempts = collections.defaultdict(collections.Counter)
    for row in db.execute("SELECT e.connector,a.byte_count,a.payload,p.commit_outcome FROM source_artifacts a JOIN source_attempts p ON p.id=a.attempt_id JOIN events e ON e.id=a.event_id WHERE a.kind='context' AND p.provider='typesafe' AND p.parent_id IS NOT NULL"):
        connector = row['connector']
        requests[connector].append(row['byte_count'])
        attempts[connector][row['commit_outcome'] or 'in_flight_or_unfinished'] += 1
        try:
            state = json.loads(row['payload']).get('state', {})
            for key, value in state.items():
                parts[connector][key] += len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())
        except (ValueError, AttributeError, TypeError):
            pass
    queue = [dict(row) for row in db.execute('SELECT e.connector,p.status,count(*) AS count,sum(p.attempts) AS attempts,max(p.attempts) AS max_attempts FROM processing_jobs p JOIN events e ON e.id=p.event_id GROUP BY e.connector,p.status')]
    # HTTP statuses are extracted from known safe legacy error formats, never arbitrary bodies.
    legacy_status = {str(status): db.execute('SELECT count(*) FROM processing_jobs WHERE error LIKE ?', (f'TypeSafe HTTP {status}.%',)).fetchone()[0] for status in (400, 401, 402, 403, 429, 500, 503)}
    total = collections.Counter()
    for value in by_source.values():
        total.update(value)
    result = {
        'audit_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
        'recorded_usage_total': total, 'recorded_usage_by_source': by_source, 'recorded_usage_by_request_day_utc': by_day,
        'recent_audited_requests': {key: {'requests': len(values), 'bytes': sum(values), 'median_bytes': statistics.median(values), 'max_bytes': max(values), 'outcomes': attempts[key]} for key, values in requests.items()},
        'recent_context_field_bytes': parts, 'queue': queue, 'legacy_http_error_rows': legacy_status,
        'responses_without_valid_usage': missing_usage, 'unmatched_legacy_fact_checks': legacy_fact_checks,
        'limitations': ['Local records may predate or omit dashboard activity. Never treat this as the complete bill.', 'Pre-audit failed or discarded attempts may have no response or usage record.', 'Character/byte counts are not token estimates.', 'Failed requests without usage have unknown billed tokens, not zero.', 'Legacy fact-check responses matching an already recorded response cannot establish an additional billable invocation.'],
    }
    db.close()
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=pathlib.Path, required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.database), indent=2, sort_keys=True))
