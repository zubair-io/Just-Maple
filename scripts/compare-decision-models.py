#!/usr/bin/env python3
"""Bounded synthetic Jev/Tev1/Nimble comparison; never opens production stores.
Export with MAPLE_DECISION_EXPORT=NEW_DIR swift test --package-path
src/apple/Packages/MapleCore --filter DecisionModelExportTests first.
"""
import argparse, json, math, os, platform, statistics, subprocess, time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def request(url, body, key=None, timeout=120):
    headers = {'Content-Type': 'application/json'}
    if key: headers['Authorization'] = 'Bearer ' + key
    start = time.monotonic()
    try:
        with urlopen(Request(url, data=json.dumps(body, separators=(',', ':')).encode(), headers=headers), timeout=timeout) as reply:
            data = json.load(reply)
            return {'status': reply.status, 'seconds': time.monotonic()-start, 'response': data}
    except HTTPError as error:
        # No private HTTP error body is persisted or printed.
        return {'status': error.code, 'seconds': time.monotonic()-start, 'error': 'HTTP '+str(error.code)}
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        return {'status': None, 'seconds': time.monotonic()-start, 'error': type(error).__name__}


def validate(body, response):
    answers = response.get('answers', {})
    if not isinstance(response.get('model'), str) or not response['model'].strip(): raise ValueError('missing model')
    for name, question in body['questions'].items():
        answer = answers.get(name, {})
        if answer.get('type') != question['type']: raise ValueError('answer type: '+name)
        if question['type'] == 'noul':
            value = answer.get('noul')
            if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1: raise ValueError('probability: '+name)
        elif question['type'] == 'choice':
            dist = answer.get('probabilities', {})
            if set(dist) != set(question['criteria']) or answer.get('choice') not in dist: raise ValueError('choice: '+name)
            if any(not isinstance(v, (int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in dist.values()) or abs(sum(dist.values())-1)>=.02: raise ValueError('distribution: '+name)
            if not isinstance(answer.get('confidence'), (int,float)) or not 0<=answer['confidence']<=1: raise ValueError('confidence: '+name)


def judge(response, label, body):
    answers = response['answers']
    p = lambda name: answers.get(name, {}).get('noul', 0)
    if 'message_kind' in answers:
        inbound=body['state']['event']['type']=='message.received'
        route = ('ask_user' if inbound and p('context_conflict')>=.85 else
                 'ask_user' if inbound and p('reply_needed')>=.85 and p('action_needed')>=.5 else
                 'notify' if inbound and p('time_sensitive')>=.9 and p('meaningful_update')>=.8 else
                 'reason' if p('needs_reasoning')>=.85 and p('meaningful_update')>=.8 else
                 'summarize' if p('meaningful_update')>=.8 or p('commitment_changed')>=.85 else 'retain')
    else:
        route = 'ask_user' if p('ask_user')>=.85 else 'reason' if p('reason')>=.85 else 'notify' if p('notify')>=.9 else 'summarize' if p('summarize')>=.8 else 'retain'
    actual = {'route': route, 'review': str(max(p('task_review_needed'),p('action_needed'),p('commitment_changed'))>=.5).lower(), 'reply_needed': str(p('reply_needed')>=.85).lower()}
    return {'actual': actual, 'passed': all(actual[k]==v for k,v in label.items() if k!='group')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--split-questions',action='store_true',help='Separate local-only adaptation experiment; one HTTP request per question, never truncates state')
    parser.add_argument('--providers',nargs='+',choices=['jev','tev1','nimble'],default=['jev','tev1','nimble'])
    args=parser.parse_args()
    if args.split_questions and 'jev' in args.providers: parser.error('Question splitting is restricted to local candidates')
    if args.output.exists(): parser.error('Use a new output directory')
    args.output.mkdir(parents=True,mode=0o700)
    labels=json.loads((args.corpus/'labels.json').read_text())
    bodies={name:json.loads((args.corpus/'requests'/(name+'.json')).read_text()) for name in labels}
    definitions={'jev':('https://api.typesafe.ai/v1/systemone','jev-latest'), 'tev1':('http://127.0.0.1:11435/v1/systemone','tev1:4b'), 'nimble':('http://127.0.0.1:11435/v1/systemone','nimble:latest')}
    key=None
    if 'jev' in args.providers:
        key=os.environ.get('TYPESAFE_API_KEY')
        if not key:
            result=subprocess.run(['security','find-generic-password','-s','com.just.maple.JapaneseMaple.jev-development','-a','typesafe','-w'],capture_output=True,text=True,timeout=15)
            if result.returncode==0:key=result.stdout.strip()
        if not key:raise SystemExit('Saved Jev credential is unavailable; no remote requests sent.')
    (args.output/'labels.json').write_text(json.dumps(labels,indent=2))
    metadata={'synthetic':True,'machine':platform.platform(),'git':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'requests_per_provider':len(labels)+7,'retries':0,'split_questions':args.split_questions,'corpus':str(args.corpus.resolve()),'definitions':definitions}
    try:
        metadata['ollama_version']=json.load(urlopen('http://127.0.0.1:11435/api/version',timeout=5))
        metadata['ollama_models']=json.load(urlopen('http://127.0.0.1:11435/api/tags',timeout=5))
    except URLError:pass
    (args.output/'metadata.json').write_text(json.dumps(metadata,indent=2))
    for provider in args.providers:
        url,model=definitions[provider]
        directory=args.output/provider;directory.mkdir()
        # Same warm-up input for each provider; excluded from quality/steady timing.
        names=['ha-temperature']+sorted(labels)+['synthetic-scheduling','synthetic-sale','ha-temperature']*2
        rows=[]
        for index,name in enumerate(names):
            body={**bodies[name],'model':model}
            if provider!='jev':body['keep_alive']='10m'
            if args.split_questions:
                parts=[];answers={};usage={'input_tokens':0,'output_tokens':0};started=time.monotonic()
                for question,spec in body['questions'].items():
                    part=request(url,{**body,'questions':{question:spec}})
                    parts.append({'question':question,**part})
                    if part['status']!=200:break
                    answers.update(part['response'].get('answers',{}))
                    for k in usage:usage[k]+=part['response'].get('usage',{}).get(k,0)
                result={'status':parts[-1]['status'],'seconds':time.monotonic()-started,'parts':parts,'response':{'model':model,'answers':answers,'usage':usage}}
                if result['status']!=200:result['error']='Incomplete split-question request; no partial result accepted'
            else:
                result=request(url,body,key if provider=='jev' else None)
            row={'case':name,'group':labels[name]['group'],'phase':'warmup' if index==0 else 'main' if index<=len(labels) else 'repeat', 'request_bytes':len(json.dumps(body,separators=(',',':')).encode()),**result}
            if result['status']==200:
                try:
                    validate(body,result['response']);row['schema_valid']=True;row.update(judge(result['response'],labels[name],body))
                except (ValueError,TypeError,KeyError) as error:row.update(schema_valid=False,passed=False,validation_error=str(error))
            else:row.update(schema_valid=False,passed=False)
            (directory/(f'{index:02d}-{name}.json')).write_text(json.dumps({'request':body,**row},indent=2))
            rows.append(row)
            print(provider,index,name,result['status'],round(result['seconds'],3),'PASS' if row['passed'] else 'FAIL',flush=True)
            if result['status'] in (401,402,403,429,503):
                print(provider,'stopped for authorization/quota/provider backoff; no retries',flush=True);break
        main=[r for r in rows if r['phase']=='main']
        scores={}
        for group in sorted({v['group'] for v in labels.values()}):
            values=[r for r in main if r['group']==group]
            scores[group]={'passed':sum(r['passed'] for r in values),'attempted':len(values),'expected':sum(v['group']==group for v in labels.values()),'schema_valid':sum(r['schema_valid'] for r in values)}
        steady=[r['seconds'] for r in rows if r['phase']!='warmup' and r['status']==200 and r['group']!='context-stress']
        usage={'input_tokens':0,'output_tokens':0}
        for row in rows:
            for k in usage:usage[k]+=row.get('response',{}).get('usage',{}).get(k,0)
        summary={'scores':scores,'median_seconds':statistics.median(steady) if steady else None,'p95_seconds':sorted(steady)[max(0,math.ceil(len(steady)*.95)-1)] if steady else None,'usage_reported':usage,'requests':sum(len(r.get('parts',[r])) for r in rows),'warmup_seconds':rows[0]['seconds'],'failed_cases':[r['case'] for r in main if not r['passed']]}
        (directory/'summary.json').write_text(json.dumps(summary,indent=2))
        print(provider,json.dumps(summary),flush=True)
        if provider!='jev':
            request('http://127.0.0.1:11435/api/generate',{'model':model,'keep_alive':0,'stream':False})

if __name__=='__main__':main()
