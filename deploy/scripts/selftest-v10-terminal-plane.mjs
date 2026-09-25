import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {readOperatorSourceSurface} from './test-source-surface.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const need=(v,m)=>{if(!v)throw new Error(m);};
const api=read('api/operator.js'),host=readOperatorSourceSurface(root),agent=read('device-agent/operator-agent.mjs');
const helper=read('lib/plus-tool-helper.js'),wall=read('device-agent/local-wall.mjs'),dashboard=read('gateway/dashboard.mjs'),policy=read('gateway/device-policy-page.mjs');
const core=JSON.parse(read('client/core-files.json')),pkg=JSON.parse(read('package.json')),stage=read('deploy/scripts/stage-terminal-runtime.mjs');
need(api.includes("action.startsWith('terminal-')")&&api.includes("action:'terminal'"),'plus_terminal_surface_missing');
need(host.includes("payload.action==='terminal'")&&host.includes('startTerminalOperation'),'host_terminal_dispatch_missing');
need(agent.includes("p.type==='terminal'")&&agent.includes('executeTerminalCommand'),'leaf_terminal_dispatch_missing');
need(helper.includes("'terminal-start'")&&helper.includes("capability:'terminal'")&&helper.includes('platformGuide'),'tool_helper_terminal_missing');
need(wall.includes("'terminal'")&&wall.includes('Interactive terminal'),'local_wall_terminal_policy_missing');
need(policy.includes("'terminal'")&&policy.includes('Interactive terminal'),'fleet_policy_terminal_missing');
for(const source of [wall,policy]){
  const developer=source.match(/developer:\[([^\]]*)\]/)?.[1]||'';
  const infra=source.match(/infra:\[([^\]]*)\]/)?.[1]||'';
  need(!developer.includes("'terminal'"),'developer_profile_must_not_auto_grant_terminal');
  need(infra.includes("'terminal'"),'infra_profile_terminal_missing');
}
need(helper.includes('raw service-account authority')||helper.includes('underlying service-account authority'),'tool_helper_raw_terminal_authority_warning_missing');
need(core.files.some(x=>x.source==='lib/native-terminal.mjs'),'client_core_terminal_missing');
need(pkg.dependencies?.['node-pty']==='^1.1.0'||pkg.dependencies?.['node-pty']==='1.1.0','node_pty_dependency_missing');
need(pkg.dependencies?.['@homebridge/node-pty-prebuilt-multiarch']==='^0.14.1'||pkg.dependencies?.['@homebridge/node-pty-prebuilt-multiarch']==='0.14.1','linux_pty_dependency_missing');
need(stage.includes("fs.rmSync(path.join(destination,'third_party')"),'terminal_runtime_third_party_prune_missing');
need(stage.includes("'spawn-helper'")&&stage.includes('fs.chmodSync(helperPath,0o755)')&&stage.includes('terminal_runtime_spawn_helper_not_executable'),'macos_spawn_helper_exec_contract_missing');
need(host.includes('terminalWallMeta(request)')&&host.includes('script:toolMeta.label')&&host.includes('resultSummary=terminalResultSummary'),'terminal_wall_activity_metadata_missing');
for(const surface of [wall,dashboard]){
  need(surface.includes('function toolLabel(j)')&&surface.includes('terminalHandle(j)')&&surface.includes('resultSummary')&&surface.includes('opbadge'),'terminal_wall_observability_ui_missing');
  for(const token of ["search:'SEARCH'","process:'PROCESS'","scp:'SCP'","desktop:'DESKTOP'",'function toolIdentity(j)','function toolCommand(j)'])need(surface.includes(token),'native_group_wall_observability_missing:'+token);
  for(const token of ['LEGACY_TOOL_PREFIXES','native-search:','String(j.script||\'\')','syntheticToolScript(j)'])if(!surface.includes(token))throw new Error('legacy_native_prefix_script_fallback:'+token);
  need(surface.includes('filter cwd / command / output / PTY'),'terminal_wall_filter_hint_missing');
  const start=surface.indexOf('function fsCommand(j)'),end=surface.indexOf('function jobText(j)',start);
  need(start>=0&&end>start,'native_group_renderer_probe_slice_missing');
  const renderer=surface.slice(start,end);
  const probe=vm.runInNewContext(renderer+";({startLabel:toolLabel({note:'native-search:start',script:'',cwd:'/srv'}),startCommand:commandText({note:'native-search:start',script:'',cwd:'/srv',toolMeta:{kind:'search',op:'start',searchType:'content',pattern:'Light Remote',filePattern:'README.md',path:'/srv/repo'}}),resultsLabel:toolLabel({note:'native-search:results',script:'',toolMeta:{kind:'search',op:'results',pattern:'Light Remote',filePattern:'README.md',path:'/srv/repo'}}),resultsCommand:commandText({note:'native-search:results',script:'',toolMeta:{kind:'search',op:'results',pattern:'Light Remote',filePattern:'README.md',path:'/srv/repo'}}),shellCommand:commandText({note:'',script:'echo hello'}),fsColor:groupBadgeClass({toolMeta:{kind:'fs',op:'read'}}),searchColor:groupBadgeClass({toolMeta:{kind:'search',op:'results'}}),runtimeColor:groupBadgeClass({toolMeta:{kind:'process',op:'list'}}),safeRisk:riskBadge({toolMeta:{kind:'search',op:'results'},script:'',requiredCapabilities:['filesystem']}),mutateRisk:riskBadge({toolMeta:{kind:'process',op:'input',processId:'lp_probe',inputBytes:4},script:'',requiredCapabilities:['filesystem']}),systemRisk:riskBadge({script:'npm test',requiredCapabilities:['build-test']}),dangerRisk:riskBadge({script:'sudo systemctl restart demo',requiredCapabilities:['sudo-on-demand','systemctl']}),syntaxHtml:shellSyntaxHtml('sudo systemctl restart demo && git status --short /tmp $HOME | grep foo'),stringHtml:shellSyntaxHtml('echo '+String.fromCharCode(34)+'foo'+String.fromCharCode(34))})");
  need(probe.startLabel==='SEARCH START'&&probe.startCommand.startsWith('search.start')&&!probe.startCommand.includes('native-search:'),'native_search_start_renderer_behavior_failed');
  need(probe.startCommand.includes('Light Remote')&&probe.startCommand.includes('README.md')&&probe.startCommand.includes('/srv/repo'),'native_search_query_detail_missing');
  need(probe.resultsLabel==='SEARCH RESULTS'&&probe.resultsCommand.startsWith('search.results')&&!probe.resultsCommand.includes('native-search:'),'native_search_results_renderer_behavior_failed');
  need(probe.shellCommand==='echo hello','shell_script_renderer_regressed');
  need(probe.fsColor==='op-fs'&&probe.searchColor==='op-search'&&probe.runtimeColor==='op-runtime','native_group_color_behavior_failed');
  need(probe.safeRisk===null,'safe_operation_must_not_warn');
  need(probe.mutateRisk?.label==='MUTATE'&&probe.mutateRisk?.cls==='risk-yellow','mutate_risk_badge_failed');
  need(probe.systemRisk?.label==='SYSTEM'&&probe.systemRisk?.cls==='risk-yellow','system_risk_badge_failed');
  need(probe.dangerRisk?.label==='DANGER'&&probe.dangerRisk?.cls==='risk-red','danger_risk_badge_failed');
  for(const token of ['syn-danger-command','syn-command','syn-option','syn-path','syn-var','syn-op'])need(probe.syntaxHtml.includes(token),'terminal_syntax_class_missing:'+token);
  need(probe.stringHtml.includes('syn-string'),'terminal_syntax_string_class_missing');
  need(probe.syntaxHtml.includes('sudo')&&probe.syntaxHtml.includes('systemctl')&&probe.syntaxHtml.includes('git')&&probe.syntaxHtml.includes('grep'),'terminal_syntax_content_missing');
}
console.log('v10-terminal-plane-routing=PASS');
console.log('v10-terminal-helper-policy=PASS');
console.log('v10-terminal-package-contract=PASS');
