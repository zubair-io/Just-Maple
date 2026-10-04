"""Synthetic 64K context probe. Temporary aliases are removed after testing."""
import importlib.util, json, hashlib, sys
from pathlib import Path
from urllib.request import Request, urlopen
root=Path(sys.argv[1]).resolve()
source=Path(sys.argv[2]).resolve()
spec=importlib.util.spec_from_file_location('comparison',source/'scripts/compare-decision-models.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
base='http://127.0.0.1:11434'
corpus=source/'.build/decision-model-evaluation/corpus-v1'
labels=json.loads((corpus/'labels.json').read_text())
rows=[]
for original in ['clef-flash:9b','clef:latest']:
    alias='maple-eval-'+original.split(':')[0]+'-64k-20261004'
    tags=json.load(urlopen(base+'/api/tags'))['models']
    if any(m['name']==alias+':latest' for m in tags):raise RuntimeError('Alias already exists; refusing to overwrite')
    creation=c.request(base+'/api/create',{'model':alias,'from':original,'parameters':{'num_ctx':65536},'stream':False})
    if creation['status']!=200:raise RuntimeError('Temporary model creation failed')
    try:
        for phase,name in [('warmup','ha-temperature'),('context-probe','ha-size-128')]:
            body={**json.loads((corpus/'requests'/(name+'.json')).read_text()),'model':alias,'keep_alive':'10m'}
            result=c.request(base+'/v1/systemone',body)
            row={'original_model':original,'configured_num_ctx':65536,'phase':phase,'case':name,'request':body,**result}
            row['passed']=False
            if result['status']==200:
                try:c.validate(body,result['response']);row['schema_valid']=True;row.update(c.judge(result['response'],labels[name],body))
                except (ValueError,TypeError,KeyError):row['schema_valid']=False
            row['residency']=json.load(urlopen(base+'/api/ps'))
            rows.append(row)
            (root/'context-probe-results.json').write_text(json.dumps(rows,indent=2))
            print(original,phase,result['status'],round(result['seconds'],3),row['passed'],flush=True)
    finally:
        c.request(base+'/api/generate',{'model':alias,'keep_alive':0,'stream':False})
        with urlopen(Request(base+'/api/delete',data=json.dumps({'model':alias}).encode(),headers={'Content-Type':'application/json'},method='DELETE')) as response:
            if response.status!=200:raise RuntimeError('Temporary alias cleanup failed')
