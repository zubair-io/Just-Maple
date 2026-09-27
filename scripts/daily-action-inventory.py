#!/usr/bin/env python3
"""Freeze an imported-source inventory for blind local review. No model calls or writes to the app DB."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3


def export_inventory(database, output, seed, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None or not seed:
        raise ValueError('A timezone-aware freeze time and selection seed are required.')
    output = Path(output).resolve()
    # Review material is private, never part of a public working tree by default.
    if output.exists():
        raise ValueError('Choose a new output directory; frozen inventories are immutable.')
    source = Path(database).resolve(strict=True)
    connection = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('PRAGMA query_only=ON')
        connection.execute('BEGIN')
        tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'events' not in tables:
            raise ValueError('Not a Maple source database.')
        rows = connection.execute('''SELECT id,connector,account,external_id,revision,occurred_at,received_at,json
            FROM events WHERE connector IN ('gmail','imessage') AND occurred_at>=? AND received_at<=?
            ORDER BY received_at DESC,id DESC''',
            ((now-dt.timedelta(days=30)).timestamp(),now.timestamp())).fetchall()
        # A source revision is not a second independent message. Pick the latest known at freeze time.
        seen, inventory = set(), []
        for row in rows:
            identity = (row['connector'],row['account'],row['external_id'])
            if identity in seen:
                continue
            seen.add(identity)
            event = json.loads(row['json'])
            digest = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
            thread_ids = sorted(v for v in event.get('subjects',[]) if v.startswith('thread:'))
            partition_scope = json.dumps((row['connector'],row['account'],thread_ids[0] if thread_ids else row['external_id']))
            inventory.append({'partitionScope':hashlib.sha256(partition_scope.encode()).hexdigest(),'sampleID':digest,'eventID':row['id'],'source':event['source'],
                'occurredAt':dt.datetime.fromtimestamp(row['occurred_at'],dt.timezone.utc).isoformat(),
                'receivedAt':dt.datetime.fromtimestamp(row['received_at'],dt.timezone.utc).isoformat(),
                'content':event['content'],'subjects':event.get('subjects',[]),
                'stratum':None,'judgment':None,'reason':'',
                'partition':'holdout' if int(hashlib.sha256((seed+partition_scope).encode()).hexdigest(),16)%5 else 'tuning'})
        inventory.sort(key=lambda r:hashlib.sha256((seed+r['sampleID']).encode()).hexdigest())
        counts = {}
        for r in inventory:
            key=r['source']['connector'];counts[key]=counts.get(key,0)+1
        metadata={'schemaVersion':1,'kind':'blind-source-inventory','frozenAt':now.isoformat(),
            'seed':seed,'counts':counts,'total':len(inventory),
            'coverage':'Imported Gmail and iMessage sources only. Missing upstream imports are not represented; this is not an end-to-end recall benchmark.',
            'selection':'All eligible latest source revisions, deterministic randomized order. Conversation-level partitions use source thread IDs; cross-source related obligations still require human partition review. Assign strata and gold labels before viewing pipeline predictions.',
            'status':'Unlabeled inventory; 100-message stratified selection and 50-task sample remain required.',
            'quotas':{'conversational_info':30,'direct_obligation':30,'waiting_delegated':20,'calendar_time_sensitive':10,'noise_transport':10}}
        output.mkdir(parents=True,mode=0o700)
        os.chmod(output,0o700)
        for name,value in [('inventory.json',inventory),('selection.json',metadata)]:
            path=output/name
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as file:json.dump(value,file,indent=2)
        template = Path(__file__).with_name('daily-action-review.html').read_text()
        data = json.dumps({'rows':inventory,'metadata':metadata}).replace('<','\\u003c')
        fd=os.open(output/'review.html',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as file:file.write(template.replace('__MAPLE_DATA__',data))
        return metadata
    finally:
        connection.close()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',required=True);p.add_argument('--output',required=True);p.add_argument('--seed',required=True)
    a=p.parse_args()
    try:
        result=export_inventory(a.db,a.output,a.seed)
        print(json.dumps({'status':result['status'],'total':result['total'],'counts':result['counts']}))
    except (ValueError,sqlite3.Error,OSError,json.JSONDecodeError):
        p.exit(1,'Could not freeze inventory. Check the database and choose a new private output directory.\n')
