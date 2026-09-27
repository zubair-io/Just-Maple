#!/usr/bin/env python3
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('inventory',Path(__file__).with_name('daily-action-inventory.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class InventoryTests(unittest.TestCase):
    def test_snapshot_deduplicates_revisions_excludes_old_later_received_and_nonmessage_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);db=root/'source.sqlite';now=dt.datetime(2026,9,24,tzinfo=dt.timezone.utc);t=now.timestamp()
            c=sqlite3.connect(db);c.execute('CREATE TABLE events(id,connector,account,external_id,revision,occurred_at,received_at,json)')
            for id,external,connector,occurred,received in [('a','one','gmail',t-100,t-80),('b','one','gmail',t-100,t-20),('c','old','imessage',t-31*86400,t-10),('d','new','gmail',t,t+10),('e','contact','apple_contacts',t-10,t-10),('f','two','imessage',t-30*86400,t-2),('g','three','gmail',t-50,t-3)]:
                event={'source':{'connector':connector,'account':'fixture','externalID':external,'revision':id},'content':'SYNTHETIC fixture </script><script>unsafe</script>','subjects':['thread:fixture-shared']}
                c.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',(id,connector,'fixture',external,id,occurred,received,json.dumps(event)))
            c.commit();c.close();before=db.read_bytes()
            result=module.export_inventory(db,root/'one','fixture-seed',now)
            module.export_inventory(db,root/'two','fixture-seed',now)
            self.assertEqual(result['total'],3)
            inventory=json.loads((root/'one/inventory.json').read_text())
            self.assertEqual({r['eventID'] for r in inventory},{'b','f','g'})
            self.assertTrue(all(r['judgment'] is None for r in inventory))
            self.assertTrue(all('partitionScope' in r for r in inventory))
            related=[r for r in inventory if r['source']['connector']=='gmail']
            self.assertEqual(related[0]['partitionScope'],related[1]['partitionScope'])
            self.assertEqual(related[0]['partition'],related[1]['partition'])
            self.assertEqual((root/'one/inventory.json').read_bytes(),(root/'two/inventory.json').read_bytes())
            self.assertEqual(before,db.read_bytes())
            html=(root/'one/review.html').read_text()
            self.assertNotIn('</script><script>unsafe',html)
            self.assertIn('\\u003c/script>',html)
            self.assertEqual((root/'one/inventory.json').stat().st_mode & 0o777,0o600)
            with self.assertRaises(ValueError):module.export_inventory(db,root/'one','seed',now)

if __name__=='__main__':unittest.main()
