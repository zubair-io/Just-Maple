import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('audit_jev', Path(__file__).with_name('audit-jev-usage.py'))
audit_jev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_jev)


class UsageAuditTests(unittest.TestCase):
    def test_invocations_commit_copies_manual_checks_and_unfinished_attempts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.sqlite'
            db = sqlite3.connect(path)
            db.executescript('''
                CREATE TABLE events(id TEXT,connector TEXT);
                CREATE TABLE decisions(event_id TEXT,raw_response TEXT,json TEXT);
                CREATE TABLE fact_checks(event_id TEXT,json TEXT);
                CREATE TABLE source_artifacts(event_id TEXT,stage TEXT,attempt_id TEXT,kind TEXT,payload TEXT,byte_count INTEGER);
                CREATE TABLE source_attempts(id TEXT,event_id TEXT,provider TEXT,parent_id TEXT,started_at REAL,commit_outcome TEXT);
                CREATE TABLE processing_jobs(event_id TEXT,status TEXT,attempts INTEGER,error TEXT);
            ''')
            raw = json.dumps({'usage': {'input_tokens': 100, 'output_tokens': 10}})
            manual = json.dumps({'usage': {'input_tokens': 30, 'output_tokens': 3}})
            legacy_manual = json.dumps({'usage': {'input_tokens': 20, 'output_tokens': 2}})
            db.executemany('INSERT INTO events VALUES (?,?)', [('a', 'fixture'), ('b', 'fixture')])
            for event in ['a', 'b']:
                db.execute('INSERT INTO decisions VALUES (?,?,?)', (event, raw, json.dumps({'createdAt': 1000, 'assessment': {'provider': 'typesafe'}})))
                db.execute('INSERT INTO fact_checks VALUES (?,?)', (event, json.dumps({'checkedAt': 1000, 'provider': 'typesafe', 'rawResponse': raw})))
            for identifier, parent, outcome in [('invocation', 'lease', 'committed'), ('lease', None, 'committed'), ('manual', 'manual-parent', 'committed'), ('unfinished', 'other', None)]:
                db.execute('INSERT INTO source_attempts VALUES (?,?,?,?,?,?)', (identifier, 'a', 'typesafe', parent, 1000, outcome))
            for attempt, stage, payload in [('invocation', 'classification', raw), ('lease', 'classification', raw), ('manual', 'fact_check', manual)]:
                db.execute('INSERT INTO source_artifacts VALUES (?,?,?,?,?,?)', ('a', stage, attempt, 'response', payload, len(payload)))
            for attempt in ['invocation', 'unfinished']:
                db.execute('INSERT INTO source_artifacts VALUES (?,?,?,?,?,?)', ('a', 'classification', attempt, 'context', '{"state":{}}', 12))
            db.execute('INSERT INTO fact_checks VALUES (?,?)', ('a', json.dumps({'checkedAt': 1000, 'provider': 'typesafe', 'rawResponse': manual})))
            db.execute('INSERT INTO fact_checks VALUES (?,?)', ('b', json.dumps({'checkedAt': 1000, 'provider': 'typesafe', 'rawResponse': legacy_manual})))
            db.commit(); db.close()
            report = audit_jev.audit(path)
            self.assertEqual(report['recorded_usage_total']['input_tokens'], 250)
            self.assertEqual(report['recorded_usage_total']['responses_with_usage'], 4)
            self.assertEqual(report['unmatched_legacy_fact_checks'], 1)
            self.assertEqual(report['recent_audited_requests']['fixture']['outcomes']['in_flight_or_unfinished'], 1)
            json.dumps(report, sort_keys=True)


if __name__ == '__main__':
    unittest.main()
