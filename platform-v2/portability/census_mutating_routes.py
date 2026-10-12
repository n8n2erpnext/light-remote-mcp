#!/usr/bin/env python3
"""Conservative source-level census of potential HTTP mutators and async pumps.

Not a routing parser, not a claim that every GET is side-effect free.
Does NOT run server/network/Docker, read runtime configs or expose source lines.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'platform-v2/portability/mutating-route-census.json'
METHOD=re.compile(r"req\.method\s*(?:===|==|!==|!=)\s*['\"](POST|PUT|PATCH|DELETE)['\"]")
APP=re.compile(r"\b(?:app|router)\.(post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]")
LITERAL=re.compile(r"['\"](\/v1\/[A-Za-z0-9_./:-]+|\/oauth\/[A-Za-z0-9_./:-]+|\/billing\/[A-Za-z0-9_./:-]+|\/support\/[A-Za-z0-9_./:-]+|\/api\/[A-Za-z0-9_./:-]+|\/account\/[A-Za-z0-9_./:-]+|\/mcp)['\"]")
BG=re.compile(r"\b(?:setInterval|setTimeout|startPolling|startPump|\.pump\s*\(|\.enqueue\s*\(|\.poll\s*\(|\.appendFile\s*\(|\.writeFileSync\s*\()")
DYNAMIC=re.compile(r"req\.method\s*(?:===|==|!==|!=)\s*[a-zA-Z_]")
SENSITIVE_RELATIVE={'plugin-server/selftest.mjs','plugin-server/selftest-integration.mjs'}
class CensusError(ValueError):pass
def main():
    files=[]
    files.extend(sorted((ROOT/'operator-host').glob('executor-routes-*.mjs')))
    files.append(ROOT/'operator-host/executor.mjs')
    files.extend(sorted((ROOT/'plugin-server').glob('*.mjs')))
    unique=sorted(set(files),key=lambda p:str(p.relative_to(ROOT)))
    sites=[]; background=[]; totals={}
    for file in unique:
        if not file.is_file() or file.is_symlink():raise CensusError('source_file_invalid')
        rel=file.relative_to(ROOT).as_posix()
        if rel in SENSITIVE_RELATIVE or 'selftest' in file.name:
            continue
        raw=file.read_bytes()
        source=raw.decode('utf8')
        lines=source.splitlines()
        totals[rel]={'sha256':hashlib.sha256(raw).hexdigest(),'lines':len(lines)}
        for n,line in enumerate(lines,1):
            verbs=sorted(set(METHOD.findall(line)+[m.group(1).upper() for m in APP.finditer(line)]))
            paths=sorted(set(LITERAL.findall(line)+[m.group(2) for m in APP.finditer(line)]))
            if verbs:
                sites.append({'source':rel,'line':n,'verbs':verbs,
                    'literal_paths':paths[:12],
                    'resolution':'source_candidate_manual_verify',
                    'requires_fence_review':True})
            if BG.search(line) and (
                'setInterval' in line or 'setTimeout' in line or '.pump(' in line
                or '.enqueue(' in line or 'startPump' in line
            ):
                background.append({'source':rel,'line':n,
                    'category':'timer_or_async_dispatch_candidate',
                    'resolution':'source_candidate_manual_verify'})
    if len(sites)<70 or len(unique)<9:raise CensusError('unexpected_low_route_coverage')
    must_have={
        'operator-host/executor-routes-account.mjs',
        'operator-host/executor-routes-runtime.mjs',
        'operator-host/executor-routes-device-channel.mjs',
        'operator-host/executor-routes-plugin.mjs',
        'plugin-server/oauth.mjs','plugin-server/paddle-billing.mjs',
        'plugin-server/support-backoffice.mjs'
    }
    if not must_have.issubset(totals):raise CensusError('critical_route_file_missing')
    for rel in must_have:
        if not any(x['source']==rel for x in sites):
            raise CensusError('critical_mutation_surface_not_seen:'+rel)
    return {
      'schema_version':1,'classification':'SOURCE_HEURISTIC_REQUIRES_MANUAL_ROUTE_REVIEW',
      'disclaimer':'Line-based first-pass only. Multiline/indirect handlers, POST multiplexers, side-effecting GET, timers, websockets and external workers may escape detection. No runtime claim.',
      'sources':totals,'candidate_mutating_route_sites':sites,
      'candidate_async_dispatch_sites':background,
      'stats':{'source_files':len(totals),'candidate_mutation_sites':len(sites),
        'candidate_background_sites':len(background),
        'critical_source_files':len(must_have)},
      'global_epoch_wired':False,'production_cutover_authorized':False
    }
if __name__=='__main__':
    try:
        report=main()
        if len(sys.argv)==2 and sys.argv[1]=='--write':
            OUT.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
        elif len(sys.argv)!=1:
            raise CensusError('usage: census_mutating_routes.py [--write]')
        print('RC50_MUTATING_ROUTE_SOURCE_CENSUS '+json.dumps(report['stats'],sort_keys=True))
    except (CensusError,UnicodeDecodeError,ValueError) as e:
        print('RC50_MUTATING_ROUTE_SOURCE_CENSUS_FAIL '+str(e),file=sys.stderr)
        sys.exit(1)
