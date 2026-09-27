#!/usr/bin/env python3
"""Aggregate-only, read-only Maple processing health. Python standard library only."""
import argparse
import json
import math
from pathlib import Path
import sqlite3
import sys
import time

CONNECTORS = frozenset(('gmail', 'imessage', 'home_assistant', 'apple_calendar',
                       'google_calendar', 'apple_contacts', 'google_contacts',
                       'notes', 'notebook', 'iphone_companion', 'user', 'feedback'))
QUEUES = {'classify': 'processing_jobs', 'task_review': 'task_extraction_jobs',
          'fact_review': 'fact_jobs', 'state_review': 'state_jobs', 'index': 'embedding_jobs'}
COUNTERS = ('pending', 'eligible_pending', 'delayed_pending', 'leased', 'expired_lease',
            'failed', 'completed', 'outside_window', 'superseded', 'other',
            'older_than_30_days', 'old_unfinished', 'orphaned', 'invalid_time')


def audit(database, now=None):
    now = time.time() if now is None else now
    if not math.isfinite(now):
        raise ValueError('Invalid audit time')
    result = {'schema_version': 1, 'sampled_at': now, 'window_days': 30, 'queues': {}}
    with sqlite3.connect(Path(database).resolve(strict=True).as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')  # All counters share one consistent SQLite snapshot, including WAL.
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'events' not in tables:
            raise ValueError('Missing events table')
        for name, table in QUEUES.items():
            if table not in tables:
                result['queues'][name] = {'available': False}
                continue
            columns = {r[1] for r in db.execute(f'PRAGMA table_info({table})')}
            lease = 'j.lease_until' if 'lease_until' in columns else 'NULL'
            due = 'j.next_attempt_at' if 'next_attempt_at' in columns else 'NULL'
            buckets = {}
            # Never select bodies, accounts, IDs, error strings, tokens or provider responses.
            for connector, status, expiry, ready, occurred, received, exists in db.execute(
                f'SELECT e.connector,j.status,{lease},{due},e.occurred_at,e.received_at,'
                f'e.id IS NOT NULL FROM {table} j LEFT JOIN events e ON e.id=j.event_id'):
                connector = connector if connector in CONNECTORS else 'other'
                b = buckets.setdefault(connector, {**dict.fromkeys(COUNTERS, 0), 'oldest_eligible_pending_age_seconds': None})
                if not exists:
                    b['orphaned'] += 1
                valid_time = all(isinstance(v, (int, float)) and math.isfinite(v) for v in (occurred, received))
                if not valid_time:
                    b['invalid_time'] += 1
                old = valid_time and occurred < now - 30 * 86400
                if old:
                    b['older_than_30_days'] += 1
                    if status not in ('succeeded', 'done', 'superseded', 'coalesced', 'outside_window'):
                        b['old_unfinished'] += 1
                if status == 'pending':
                    b['pending'] += 1
                    due_valid = 'next_attempt_at' not in columns or isinstance(ready, (int, float)) and math.isfinite(ready)
                    eligible = valid_time and (name == 'index' or not old) and due_valid and (ready is None or ready <= now)
                    if eligible:
                        b['eligible_pending'] += 1
                        age = max(0, now - received)
                        b['oldest_eligible_pending_age_seconds'] = max(b['oldest_eligible_pending_age_seconds'] or 0, age)
                    elif due_valid and ready is not None and ready > now:
                        b['delayed_pending'] += 1
                elif status in ('leased', 'processing', 'running'):
                    b['expired_lease' if isinstance(expiry, (int, float)) and math.isfinite(expiry) and expiry <= now else 'leased'] += 1
                else:
                    b[{'succeeded': 'completed', 'done': 'completed', 'failed': 'failed', 'blocked': 'failed',
                       'outside_window': 'outside_window', 'superseded': 'superseded', 'coalesced': 'superseded'}.get(status, 'other')] += 1
            result['queues'][name] = {'available': True, 'connectors': buckets}
    return result


def throughput(previous, current):
    elapsed = current['sampled_at'] - previous['sampled_at']
    if previous.get('schema_version') != 1 or elapsed <= 0 or not math.isfinite(elapsed):
        raise ValueError('Incompatible snapshots')
    rows = {}
    for name in QUEUES:
        before = previous['queues'].get(name, {})
        after = current['queues'].get(name, {})
        if not before.get('available') or not after.get('available'):
            continue
        rows[name] = {}
        for connector in sorted(CONNECTORS | {'other'}):
            b = before.get('connectors', {}).get(connector, {})
            a = after.get('connectors', {}).get(connector, {})
            if not a and not b:
                continue
            delta = a.get('completed', 0) - b.get('completed', 0)
            rows[name][connector] = {'net_completed_change': delta, 'net_completed_per_minute': delta * 60 / elapsed}
    return {'elapsed_seconds': elapsed, 'queues': rows,
            'caveat': 'Net completed inventory change, not an execution ledger; retries, resets or deletions can change counts. Compare only the same database.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database')
    parser.add_argument('--previous', help='Previous aggregate JSON snapshot from this same database')
    args = parser.parse_args()
    try:
        result = audit(args.database)
        if args.previous:
            result['throughput'] = throughput(json.loads(Path(args.previous).read_text()), result)
        print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError):
        print('Audit failed: check database schema, read access and previous snapshot format. No database changes were made.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
