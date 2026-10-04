#!/usr/bin/env python3
"""Synthetic CLI regression; uses a fake local runner and a temporary database only.

Run after building the CLI:
  python3 scripts/preview-tasks-audit-test.py --cli PATH_TO_JUST_MAPLE
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

parser = argparse.ArgumentParser()
parser.add_argument("--cli", type=Path, required=True)
options, remaining = parser.parse_known_args()
CLI = options.cli.resolve()


class PreviewTasksAuditTests(unittest.TestCase):
    def test_preview_repair_and_repeat_are_audited_without_applying_tasks(self):
        with tempfile.TemporaryDirectory(prefix="maple-preview-fixture-") as temporary:
            root = Path(temporary)
            database = root / "fixture.sqlite"
            runner = root / "fixture.cjs"
            source = root / "fixture.md"
            source.write_text("Synthetic preview fixture: Review the garden proposal.")
            runner.write_text(r"""
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),path=require('node:path');
const db=path.join(__dirname,'fixture.sqlite');
let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{
  const prompt=JSON.parse(data).prompt;
  const query=sql=>JSON.parse(cp.execFileSync('/usr/bin/sqlite3',['-readonly','-json',db,sql],{encoding:'utf8'})||'[]');
  const invocation=query("SELECT * FROM provider_invocations WHERE stage='task_preview' ORDER BY rowid").at(-1);
  const context=query("SELECT payload FROM provider_invocation_events WHERE kind='context' ORDER BY sequence").at(-1);
  if(!invocation?.dispatch_json||context?.payload!==prompt||invocation.context_sha256!==crypto.createHash('sha256').update(prompt).digest('hex')) throw new Error('Preview dispatched without durable capture');
  fs.appendFileSync(db+'.calls',invocation.id+'\n');
  process.stdout.write(JSON.stringify({ok:true,text:prompt.includes('previous response failed strict validation')?'{"tasks":[]}':'synthetic invalid response'}));
});
""")

            def command(*arguments, success=True):
                result = subprocess.run([str(CLI), *arguments, "--db", str(database)],
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0 if success else 1, result.stderr)
                return json.loads(result.stdout) if success else result

            event_id = command("note", str(source), "--subject", "person:self")["eventID"]
            with sqlite3.connect(database) as connection:
                queue_before = connection.execute("SELECT * FROM task_extraction_jobs").fetchall()
            for _ in range(2):
                self.assertEqual(command("preview-tasks", event_id, "--runner", str(runner)), [])
            with sqlite3.connect(database) as connection:
                connection.row_factory = sqlite3.Row
                invocations = connection.execute("SELECT * FROM provider_invocations ORDER BY rowid").fetchall()
                self.assertEqual(len(invocations), 4)  # One initial request + one existing repair per preview.
                self.assertEqual(len({row["job_id"] for row in invocations}), 2)
                self.assertEqual(len({row["attempt_id"] for row in invocations}), 2)
                for initial, repair in zip(invocations[::2], invocations[1::2]):
                    self.assertIsNone(initial["parent_id"])
                    self.assertEqual(repair["parent_id"], initial["id"])
                    self.assertEqual(repair["attempt_id"], initial["attempt_id"])
                    self.assertEqual(repair["job_id"], initial["job_id"])
                for row in invocations:
                    self.assertEqual(row["stage"], "task_preview")
                    capture = json.loads(row["dispatch_json"])
                    self.assertIn(event_id, [item["eventID"] for item in capture["evidence"]])
                    context = connection.execute("SELECT payload FROM provider_invocation_events WHERE invocation_id=? AND kind='context'", (row["id"],)).fetchone()[0]
                    self.assertEqual(hashlib.sha256(context.encode()).hexdigest(), row["context_sha256"])
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM life_tasks").fetchone()[0], 0)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM task_suggestions").fetchone()[0], 0)
                self.assertEqual([tuple(row) for row in connection.execute("SELECT * FROM task_extraction_jobs")], queue_before)
                connection.execute("CREATE TRIGGER reject_preview_dispatch BEFORE INSERT ON provider_invocation_events WHEN NEW.kind='dispatch' BEGIN SELECT RAISE(ABORT,'synthetic capture failure'); END")
            calls = Path(str(database) + ".calls").read_text()
            command("preview-tasks", event_id, "--runner", str(runner), success=False)
            self.assertEqual(Path(str(database) + ".calls").read_text(), calls)
            with sqlite3.connect(database) as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM provider_invocations WHERE dispatch_json IS NOT NULL").fetchone()[0], 4)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM task_suggestions").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main(argv=[__file__, *remaining])
