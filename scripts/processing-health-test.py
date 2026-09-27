import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('health', Path(__file__).with_name('processing-health.py'))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class HealthTests(unittest.TestCase):
    def test_status_window_privacy_and_read_only(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'fixture.sqlite'
            now = 10_000_000
            with sqlite3.connect(path) as db:
                db.executescript('CREATE TABLE events(id TEXT,connector TEXT,occurred_at REAL,received_at REAL,json TEXT); CREATE TABLE processing_jobs(event_id TEXT,status TEXT,next_attempt_at REAL,lease_until REAL,error TEXT); CREATE TABLE task_extraction_jobs(event_id TEXT,status TEXT,lease_until REAL); CREATE TABLE embedding_jobs(event_id TEXT,status TEXT);')
                samples = [('pending', now-10, now-100, now-1, None), ('pending', now-20, now-200, now+30, None), ('leased', now-30, now-300, now, now+30), ('leased', now-40, now-400, now, now-1), ('failed', now-50, now-500, now, None), ('succeeded', now-60, now-600, now, None), ('pending', now-31*86400, now-700, now, None), ('outside_window', now-32*86400, now-800, now, None), ('pending', now-30*86400, now-900, now, None)]
                for index, (status, occurred, received, ready, lease) in enumerate(samples):
                    db.execute('INSERT INTO events VALUES(?,?,?,?,?)', (str(index), 'gmail', occurred, received, 'SECRET BODY'))
                    db.execute('INSERT INTO processing_jobs VALUES(?,?,?,?,?)', (str(index), status, ready, lease, 'SECRET ERROR'))
                db.execute("INSERT INTO events VALUES('private-id','SECRET CONNECTOR',?,?, 'SECRET BODY')", (now,now))
                db.execute("INSERT INTO processing_jobs VALUES('private-id','SECRET STATUS',0,NULL,'SECRET')")
                db.execute("INSERT INTO task_extraction_jobs VALUES('0','processing',?)", (now-1,))
                db.execute("INSERT INTO embedding_jobs VALUES('6','pending')")
            before = path.read_bytes()
            result = health.audit(path, now)
            self.assertEqual(path.read_bytes(), before)
            b = result['queues']['classify']['connectors']['gmail']
            self.assertEqual([b[k] for k in ('pending','eligible_pending','delayed_pending','leased','expired_lease','failed','completed','outside_window')], [4,2,1,1,1,1,1,1])
            self.assertEqual(b['oldest_eligible_pending_age_seconds'],900)
            self.assertEqual(b['old_unfinished'],1)
            self.assertEqual(result['queues']['task_review']['connectors']['gmail']['expired_lease'],1)
            self.assertEqual(result['queues']['index']['connectors']['gmail']['eligible_pending'],1)
            self.assertFalse(result['queues']['fact_review']['available'])
            self.assertNotIn('SECRET', json.dumps(result))
            self.assertNotIn('private-id', json.dumps(result))

    def test_throughput_uses_separate_stage_counts_and_reports_resets(self):
        before={'schema_version':1,'sampled_at':100,'queues':{'classify':{'available':True,'connectors':{'gmail':{'completed':5}}},'task_review':{'available':True,'connectors':{'gmail':{'completed':4}}}}}
        after={'schema_version':1,'sampled_at':160,'queues':{'classify':{'available':True,'connectors':{'gmail':{'completed':7}}},'task_review':{'available':True,'connectors':{'gmail':{'completed':3}}}}}
        delta=health.throughput(before,after)['queues']
        self.assertEqual(delta['classify']['gmail']['net_completed_per_minute'],2)
        self.assertEqual(delta['task_review']['gmail']['net_completed_change'],-1)
        with self.assertRaises(ValueError): health.throughput(after,before)

    def test_missing_database_does_not_create_it(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'missing.sqlite'
            with self.assertRaises(FileNotFoundError): health.audit(path)
            self.assertFalse(path.exists())


if __name__ == '__main__': unittest.main()
