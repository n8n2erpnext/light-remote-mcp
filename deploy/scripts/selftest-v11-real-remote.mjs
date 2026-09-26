import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeDesktopBridge, realRemoteAvailable, realRemoteEnabled } from '../../lib/native-desktop.mjs';
import { withRealRemoteCapabilities, defaultRealRemoteDenied, realRemotePolicyAfterSave } from '../../lib/real-remote-policy.mjs';
import realRemoteInputPolicy from '../../lib/real-remote-input.cjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const {normalizeDesktopInput}=realRemoteInputPolicy;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-real-remote-'));
const fake=path.join(tmp,'fake-helper.mjs');
fs.writeFileSync(fake,`
import readline from 'node:readline';
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of rl){
  if(!line.trim())continue;
  const request=JSON.parse(line);
  if(request.op==='hang')continue;
  if(request.op==='fail'){process.stdout.write(JSON.stringify({id:request.id,ok:false,error:'fake_failure'})+'\\n');continue;}
  const result=request.op==='status'
    ? {protocolVersion:1,interactive:true,helperPid:process.pid,screens:[{name:'fake-screen'}]}
    : request.op==='windows'
      ? {protocolVersion:1,helperPid:process.pid,count:1,windows:[{title:'Fake Window'}]}
      : request.op==='frame'
        ? {protocolVersion:1,helperPid:process.pid,mime:'image/jpeg',encoding:'base64',width:320,height:180,bytes:4,data:'AQIDBA=='}
        : request.op==='input'
          ? request.args.semanticSessionId
            ? {protocolVersion:1,helperPid:process.pid,appliedEvents:request.args.events.length,sentInputs:2,inputSeq:1,semanticSessionId:request.args.semanticSessionId,epoch:'ep_fake',afterSeq:request.args.afterSeq??2,stateSeq:3,cursor:{x:120,y:80},focused:{id:'uia_2',role:'Button',name:'Login'},gap:false,resyncRecommended:false,hasMore:false,events:[{seq:3,kind:'focus',element:{id:'uia_2',role:'Button',name:'Login'}}]}
            : {protocolVersion:1,helperPid:process.pid,appliedEvents:request.args.events.length,sentInputs:2}
          : request.op==='semantic-attach'
            ? {protocolVersion:1,helperPid:process.pid,provider:'windows-uia',semanticSessionId:'sem_fake',epoch:'ep_fake',stateSeq:1,nodeCount:2,nodes:[{id:'uia_1',role:'Window'},{id:'uia_2',parentId:'uia_1',role:'Button',name:'Login'}]}
            : request.op==='semantic-snapshot'
              ? {protocolVersion:1,helperPid:process.pid,provider:'windows-uia',semanticSessionId:request.args.semanticSessionId,epoch:'ep_fake',stateSeq:2,nodeCount:2,nodes:[{id:'uia_1',role:'Window'},{id:'uia_2',parentId:'uia_1',role:'Button',name:'Login'}]}
              : request.op==='semantic-events'
                ? {protocolVersion:1,helperPid:process.pid,provider:'windows-uia',semanticSessionId:request.args.semanticSessionId,epoch:'ep_fake',afterSeq:request.args.afterSeq,stateSeq:4,gap:false,resyncRecommended:false,eventsAvailable:true,events:[{seq:4,kind:'property',property:'AutomationElement.NameProperty',element:{id:'uia_2',role:'Button',name:'Continue'}}]}
                : request.op==='semantic-detach'
                  ? {protocolVersion:1,helperPid:process.pid,provider:'windows-uia',semanticSessionId:request.args.semanticSessionId,epoch:'ep_fake',stateSeq:4,detached:true}
                : {helperPid:process.pid,echo:request};
  process.stdout.write(JSON.stringify({id:request.id,ok:true,result})+'\\n');
}
`);

assert.equal(realRemoteEnabled({LIGHT_REMOTE_REAL_REMOTE:'1'}),true);
assert.equal(realRemoteEnabled({LIGHT_REMOTE_REAL_REMOTE:'false'}),false);
assert.equal(realRemoteAvailable({platform:'win32',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:fake},exists:fs.existsSync}),true);
assert.equal(realRemoteAvailable({platform:'linux',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:fake},exists:fs.existsSync}),false);

const discovered=withRealRemoteCapabilities(['filesystem','terminal'],{available:true});
assert.deepEqual(discovered,['desktop','desktop-input','filesystem','terminal']);
assert.deepEqual(defaultRealRemoteDenied({discovered,denied:[],inputDecision:null}),['desktop-input'],'desktop-input must be locally denied by default');
assert.deepEqual(defaultRealRemoteDenied({discovered,denied:['terminal'],inputDecision:null}),['desktop-input','terminal']);
assert.deepEqual(defaultRealRemoteDenied({discovered,denied:['desktop-input','terminal'],inputDecision:'allow'}),['terminal'],'explicit owner allow must survive reenroll');
const allowedPolicy=realRemotePolicyAfterSave({deniedCapabilities:[]},{grantable:discovered,allowed:['desktop','desktop-input','filesystem','terminal']});
assert.equal(allowedPolicy.realRemoteInputDecision,'allow');
const deniedPolicy=realRemotePolicyAfterSave({deniedCapabilities:['desktop-input']},{grantable:discovered,allowed:['desktop','filesystem','terminal']});
assert.equal(deniedPolicy.realRemoteInputDecision,'deny');
assert.deepEqual(defaultRealRemoteDenied({discovered,denied:deniedPolicy.deniedCapabilities,inputDecision:deniedPolicy.realRemoteInputDecision}),['desktop-input']);

const normalizedInput=normalizeDesktopInput({events:[
  {type:'move',x:120,y:80},
  {type:'click',button:'left',count:1},
  {type:'wheel',delta:-120},
  {type:'drag',x:120,y:80,toX:320,toY:180,button:'left',steps:6,durationMs:90},
  {type:'text',text:'Light Remote'},
  {type:'key',key:'ENTER',modifiers:['CTRL']}
]});
assert.equal(normalizedInput.events.length,6);
assert.deepEqual(normalizedInput.events[3],{type:'drag',x:120,y:80,toX:320,toY:180,button:'left',steps:6,durationMs:90});
assert.deepEqual(normalizedInput.events[5],{type:'key',key:'ENTER',modifiers:['CTRL']});
const normalizedScreenInput=normalizeDesktopInput({events:[
  {type:'move',x:10,y:20,screen:0},
  {type:'click',x:30,y:40,screen:1,button:'left'},
  {type:'drag',x:5,y:6,toX:15,toY:16,screen:2,button:'left'}
]});
assert.deepEqual(normalizedScreenInput.events[0],{type:'move',x:10,y:20,screen:0});
assert.deepEqual(normalizedScreenInput.events[1],{type:'click',button:'left',count:1,x:30,y:40,screen:1});
assert.deepEqual(normalizedScreenInput.events[2],{type:'drag',x:5,y:6,screen:2,toX:15,toY:16,toScreen:2,button:'left',steps:8,durationMs:120});
const topologyId='a'.repeat(64);
const normalizedTopologyInput=normalizeDesktopInput({displayTopologyId:topologyId,events:[{type:'move',x:10,y:20,screen:0}]});
assert.equal(normalizedTopologyInput.displayTopologyId,topologyId);
assert.throws(()=>normalizeDesktopInput({displayTopologyId:'bad',events:[{type:'move',x:1,y:1}]}),/desktop_input_invalid_display_topology_id/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'move',x:-1,y:0,screen:0}]}),/desktop_input_invalid_screen_coordinates/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'move',x:0,y:0,screen:256}]}),/desktop_input_invalid_screen/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'move'}]}),/desktop_input_coordinates_required/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'drag',x:1,y:1,toY:2}]}),/desktop_input_invalid_to_x/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'drag',x:1,y:1,toX:2,toY:2,steps:33}]}),/desktop_input_invalid_steps/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'key',key:'RAW_SCANCODE'}]}),/desktop_input_invalid_key/);
assert.throws(()=>normalizeDesktopInput({events:Array.from({length:65},()=>({type:'click'}))}),/desktop_input_invalid_event_count/);
const normalizedAckInput=normalizeDesktopInput({events:[{type:'move',x:120,y:80}],semanticSessionId:'sem_12345678',afterSeq:2,settleMs:25});
assert.equal(normalizedAckInput.semanticSessionId,'sem_12345678');
assert.equal(normalizedAckInput.afterSeq,2);
assert.equal(normalizedAckInput.settleMs,25);
assert.throws(()=>normalizeDesktopInput({events:[{type:'move',x:1,y:1}],semanticSessionId:'bad'}),/desktop_input_invalid_semantic_session/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'move',x:1,y:1}],afterSeq:1}),/desktop_input_semantic_session_required/);
assert.throws(()=>normalizeDesktopInput({events:[{type:'move',x:1,y:1}],semanticSessionId:'sem_12345678',settleMs:251}),/desktop_input_invalid_settle_ms/);


const bridge=new NativeDesktopBridge({command:process.execPath,args:[fake],timeoutMs:1000});
try{
  const status=await bridge.request('status');
  const windows=await bridge.request('windows',{limit:10});
  const frame=await bridge.request('frame',{maxWidth:320,maxHeight:180,quality:40});
  const input=await bridge.request('input',normalizedInput);
  const semanticAttach=await bridge.request('semantic-attach',{scope:'foreground',maxDepth:4,maxNodes:100});
  const semanticSnapshot=await bridge.request('semantic-snapshot',{semanticSessionId:semanticAttach.semanticSessionId});
  const semanticAckInput=await bridge.request('input',{events:[{type:'move',x:120,y:80}],semanticSessionId:semanticAttach.semanticSessionId,afterSeq:semanticSnapshot.stateSeq,settleMs:0});
  const semanticEvents=await bridge.request('semantic-events',{semanticSessionId:semanticAttach.semanticSessionId,afterSeq:semanticAckInput.stateSeq,limit:100});
  const semanticDetach=await bridge.request('semantic-detach',{semanticSessionId:semanticAttach.semanticSessionId});
  assert.equal(status.protocolVersion,1);
  assert.equal(status.interactive,true);
  assert.equal(windows.count,1);
  assert.equal(windows.windows[0].title,'Fake Window');
  assert.equal(frame.mime,'image/jpeg');
  assert.equal(frame.encoding,'base64');
  assert.equal(frame.data,'AQIDBA==');
  assert.equal(frame.width,320);
  assert.equal(frame.height,180);
  assert.equal(status.helperPid,windows.helperPid,'desktop helper must stay persistent across requests');
  assert.equal(status.helperPid,frame.helperPid,'desktop frame must use the same persistent helper');
  assert.equal(input.appliedEvents,6);
  assert.equal(status.helperPid,input.helperPid,'desktop input must use the same persistent helper');
  assert.equal(semanticAttach.provider,'windows-uia');
  assert.equal(semanticAttach.stateSeq,1);
  assert.equal(semanticSnapshot.stateSeq,2);
  assert.equal(semanticSnapshot.semanticSessionId,semanticAttach.semanticSessionId);
  assert.equal(semanticAckInput.inputSeq,1);
  assert.equal(semanticAckInput.semanticSessionId,semanticAttach.semanticSessionId);
  assert.equal(semanticAckInput.afterSeq,semanticSnapshot.stateSeq);
  assert.equal(semanticAckInput.stateSeq,3);
  assert.equal(semanticAckInput.focused.id,'uia_2');
  assert.equal(semanticAckInput.events[0].seq,3);
  assert.equal(semanticAckInput.resyncRecommended,false);
  assert.equal(semanticEvents.stateSeq,4);
  assert.equal(semanticEvents.events.length,1);
  assert.equal(semanticEvents.events[0].seq,4);
  assert.equal(semanticEvents.gap,false);
  assert.equal(semanticEvents.resyncRecommended,false);
  assert.equal(semanticDetach.detached,true);
  assert.equal(status.helperPid,semanticAttach.helperPid,'semantic session must use the same persistent helper');
  await assert.rejects(()=>bridge.request('fail'),/fake_failure/);
  await assert.rejects(()=>bridge.request('hang',{}, {timeoutMs:250}),/real_remote_helper_timeout/);
}finally{
  bridge.close();
  fs.rmSync(tmp,{recursive:true,force:true});
}

const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const core=JSON.parse(read('client/core-files.json'));
assert.ok(core.files.some(row=>row.source==='lib/native-desktop.mjs'&&row.destination==='lib/native-desktop.mjs'),'native desktop bridge not packaged');
assert.ok(core.files.some(row=>row.source==='lib/real-remote-policy.mjs')&&core.files.some(row=>row.source==='lib/real-remote-input.cjs'),'Real Remote policy/input runtime not packaged');

const program=read('client/windows-native/GptOperator.Client/Program.cs');
const helper=read('client/windows-native/GptOperator.Client/RealRemoteHelper.cs');
const inputHelper=read('client/windows-native/GptOperator.Client/RealRemoteInput.cs');
const semanticHelper=read('client/windows-native/GptOperator.Client/RealRemoteSemantic.cs');
const semanticEventsHelper=read('client/windows-native/GptOperator.Client/RealRemoteSemanticEvents.cs');
const inputAckHelper=read('client/windows-native/GptOperator.Client/RealRemoteInputAck.cs');
const browserCdpHelper=read('client/windows-native/GptOperator.Client/RealRemoteBrowserCdp.cs');
const browserSnapshotHelper=read('client/windows-native/GptOperator.Client/RealRemoteBrowserSnapshot.cs');
const browserAcceptance=read('client/windows-native/acceptance/real-remote-browser-os-input.ps1');
const browserCrossOriginServer=read('client/windows-native/acceptance/real-remote-browser-cross-origin-server.cjs');
const uiaAcceptance=read('client/windows-native/acceptance/real-remote-uia-app-switch.ps1');
const uiaFixture=read('client/windows-native/acceptance/real-remote-uia-fixture.ps1');
const uiaModalAcceptance=read('client/windows-native/acceptance/real-remote-uia-modal.ps1');
const uiaModalFixture=read('client/windows-native/acceptance/real-remote-uia-modal-fixture.ps1');
const uiaFilePickerAcceptance=read('client/windows-native/acceptance/real-remote-uia-file-picker.ps1');
const uiaFilePickerFixture=read('client/windows-native/acceptance/real-remote-uia-file-picker-fixture.ps1');
const uiaClipboardAcceptance=read('client/windows-native/acceptance/real-remote-uia-clipboard.ps1');
const uiaClipboardFixture=read('client/windows-native/acceptance/real-remote-uia-clipboard-fixture.ps1');
const uiaDragDropAcceptance=read('client/windows-native/acceptance/real-remote-uia-drag-drop.ps1');
const uiaDragDropFixture=read('client/windows-native/acceptance/real-remote-uia-drag-drop-fixture.ps1');
const uiaMouseButtonsAcceptance=read('client/windows-native/acceptance/real-remote-uia-mouse-buttons.ps1');
const uiaMouseButtonsFixture=read('client/windows-native/acceptance/real-remote-uia-mouse-buttons-fixture.ps1');
const uiaScreenCoordinatesAcceptance=read('client/windows-native/acceptance/real-remote-uia-screen-coordinates.ps1');
const uiaWindowLifecycleAcceptance=read('client/windows-native/acceptance/real-remote-uia-window-lifecycle.ps1');
const uiaWindowLifecycleFixture=read('client/windows-native/acceptance/real-remote-uia-window-lifecycle-fixture.ps1');
const uiaWindowsWorkflow=read('.github/workflows/windows-native-client.yml');
const windowsProject=read('client/windows-native/GptOperator.Client/GptOperator.Client.csproj');
const clientManifest=read('client/windows-native/GptOperator.Client/app.manifest');
const supervisor=read('client/windows-native/GptOperator.Client/AgentSupervisor.cs');
const host=read('client/windows-native/GptOperator.Client/AgentHost.cs');
assert.ok(program.includes('--real-remote-helper')&&program.includes('RealRemoteHelper.Run()'),'Windows app hidden helper mode missing');
for(const token of ['EnumWindows','GetForegroundWindow','GetCursorPos','Screen.AllScreens','CopyFromScreen','ImageFormat.Jpeg','desktop_frame_too_large','Console.OpenStandardInput','Console.OpenStandardOutput'])assert.ok(helper.includes(token),`Windows helper contract missing: ${token}`);
assert.ok(helper.includes('"input" => Input(args)'),'Windows hidden helper input opcode missing');
for(const token of ['"semantic-attach" => SemanticAttach(args)','"semantic-snapshot" => SemanticSnapshot(args)','"semantic-events" => SemanticEvents(args)','"semantic-detach" => SemanticDetach(args)'])assert.ok(helper.includes(token),`Windows semantic opcode missing: ${token}`);
for(const token of ['AutomationElement','TreeWalker.ControlViewWalker','semanticSessionId','epoch','stateSeq','password','MaxNodes'])assert.ok(semanticHelper.includes(token),`Windows semantic contract missing: ${token}`);
for(const token of ['AddAutomationFocusChangedEventHandler','AddStructureChangedEventHandler','AddAutomationPropertyChangedEventHandler','SemanticJournalLimit = 512','SemanticCoalesceMs = 75','droppedBeforeSeq','resyncRecommended'])assert.ok(semanticEventsHelper.includes(token),`Windows semantic event contract missing: ${token}`);
assert.ok(!semanticEventsHelper.includes('ValuePattern.ValueProperty'),'semantic journal must not subscribe textbox Value contents');
assert.ok(!semanticEventsHelper.includes('TextPattern.'),'semantic journal must not subscribe text contents');
assert.ok(windowsProject.includes('<UseWPF>true</UseWPF>'),'Windows UIA reference pack must come from WindowsDesktop/WPF SDK support');
for(const token of ['SendInput(','SetCursorPos(','desktop_input_blocked','desktop_input_invalid_event_count','Keyboard(ushort vk,ushort scan,uint flags)','BeginSemanticInput(args)','CompleteSemanticInput(semanticInput,applied,sent)'])assert.ok(inputHelper.includes(token),`Windows input contract missing: ${token}`);
for(const token of ['ResolvePoint(item,"x","y","screen"','ResolvePoint(item,"toX","toY","toScreen"','desktop_input_screen_out_of_range','desktop_input_invalid_screen_coordinates','ValidateDisplayTopology(args)','desktop_input_stale_topology'])assert.ok(inputHelper.includes(token),`Windows screen-local input contract missing: ${token}`);
assert.ok(helper.includes('allScreens.Select((screen, index) =>')&&helper.includes('int screenIndex')&&helper.includes('index = screenIndex'),'Windows screen topology/frame responses must expose stable screen indexes');
for(const token of ['DisplayTopologyId(Screen[] screens)','GetDpiForMonitor','displayTopologyId','dpiAwareness = "PerMonitorV2"'])assert.ok(helper.includes(token),'Windows DPI/topology contract missing: '+token);
assert.ok(clientManifest.includes('<dpiAwareness')&&clientManifest.includes('PerMonitorV2'),'Windows native helper must run PerMonitorV2 DPI-aware');
assert.ok(inputAckHelper.includes('displayTopologyId = DisplayTopologyId(Screen.AllScreens)'),'Windows input ACK must return the applied display topology');
for(const token of ['case "drag"','private static int Drag(JsonElement item)','MouseButtonPair','IntRequired','finally','Mouse(pair.Up,0)'])assert.ok(inputHelper.includes(token),`Windows atomic drag contract missing: ${token}`);
assert.ok(inputHelper.includes('"right" => (MouseRightDown,MouseRightUp)')&&inputHelper.includes('"middle" => (MouseMiddleDown,MouseMiddleUp)'),'Windows mouse-button mapping must preserve right and middle SendInput pairs');
for(const token of ['SemanticInputContext','InputSeq','afterSeq','settleMs','focusOutsideScope','resyncRecommended','hasMore'])assert.ok(inputAckHelper.includes(token),`Windows closed-loop input ACK missing: ${token}`);
assert.ok(inputAckHelper.includes('RefreshSemanticForegroundRoot(session)'),'Windows UIA input ACK must refresh foreground semantic root after OS input settles');
for(const token of ['BrowserSession','CompleteBrowserSemanticInput','BrowserSemanticSnapshotCore','provider = "browser-cdp"','observation = "cdp-snapshot+journal"'])assert.ok(inputAckHelper.includes(token),'Browser closed-loop input ACK missing: '+token);
assert.ok(inputAckHelper.includes('eventResyncRecommended')&&inputAckHelper.includes('gap || scopeChanged || eventResyncRecommended'),'Browser input ACK must propagate event-level resync to top-level');
assert.ok(browserCdpHelper.includes('eventResyncRecommended')&&browserCdpHelper.includes('gap || session.ScopeChanged || eventResyncRecommended'),'Browser semantic-events must propagate event-level resync to top-level');
assert.ok(browserCdpHelper.includes('TargetId { get; set; }')&&browserCdpHelper.includes('TargetTitle { get; set; }')&&browserCdpHelper.includes('TargetUrl { get; set; }'),'Browser target metadata must refresh and hand off across targets');
for(const token of ['OperationGate','ConnectionGeneration','BrowserMaybeHandoffToForegroundTarget','BrowserForegroundTarget','BrowserEnqueueEvent(session, "target", "targetId"'])assert.ok(browserCdpHelper.includes(token),'Browser target handoff contract missing: '+token);
for(const token of ['KnownTargetIds','TargetHistory','BrowserTargetTitleMatches','BrowserTargetMatchesForegroundWindow','Browser.getWindowForTarget','newlySeen','currentPresent'])assert.ok(browserCdpHelper.includes(token),'Browser target identity hardening missing: '+token);
assert.ok(browserSnapshotHelper.includes('Page.getNavigationHistory')&&browserSnapshotHelper.includes('BrowserRefreshTargetMetadata')&&browserSnapshotHelper.includes('BrowserMaybeHandoffToForegroundTarget'),'Browser snapshot must refresh metadata and hand off foreground targets observation-only');
assert.ok(browserAcceptance.includes('windows-real-remote-new-tab-handoff=PASS')&&browserAcceptance.includes('windows-real-remote-new-tab-continued-input=PASS')&&browserAcceptance.includes('windows-real-remote-new-tab-closed-loop=PASS'),'Real Windows acceptance must prove new-tab handoff and continued OS input');
assert.ok(browserAcceptance.includes('windows-real-remote-close-tab-handoff=PASS')&&browserAcceptance.includes('windows-real-remote-close-tab-continued-input=PASS')&&browserAcceptance.includes('windows-real-remote-close-tab-closed-loop=PASS'),'Real Windows acceptance must prove close-tab recovery and continued OS input');
assert.ok(browserAcceptance.includes('windows-real-remote-popup-window-handoff=PASS')&&browserAcceptance.includes('windows-real-remote-popup-window-continued-input=PASS')&&browserAcceptance.includes('windows-real-remote-popup-window-closed-loop=PASS'),'Real Windows acceptance must prove popup-window handoff and continued OS input');
assert.ok(browserAcceptance.includes('windows-real-remote-target-identity-title-collision=PASS')&&browserAcceptance.includes('FindDifferent'),'Real Windows acceptance must prove same-title cross-window target identity');
assert.ok(browserAcceptance.includes('windows-real-remote-history-back=PASS')&&browserAcceptance.includes('windows-real-remote-history-forward=PASS')&&browserAcceptance.includes('windows-real-remote-reload=PASS')&&browserAcceptance.includes('windows-real-remote-history-reload-closed-loop=PASS'),'Real Windows acceptance must prove browser history and reload through OS input');
assert.ok(browserAcceptance.includes('windows-real-remote-cross-origin-a=PASS')&&browserAcceptance.includes('windows-real-remote-cross-origin-transition=PASS')&&browserAcceptance.includes('windows-real-remote-cross-origin-continued-input=PASS')&&browserAcceptance.includes('windows-real-remote-cross-origin-closed-loop=PASS'),'Real Windows acceptance must prove cross-origin navigation and continued OS input');
assert.ok(browserAcceptance.includes('windows-real-remote-popup-window-close-recovery=PASS')&&browserAcceptance.includes("key='W';modifiers=@('CTRL')"),'Cross-origin acceptance must recover the main browser window after closing the popup with OS input');
assert.ok(browserAcceptance.includes("key='L';modifiers=@('CTRL')")&&browserAcceptance.includes("type='text';text=$originAUrl"),'Cross-origin navigation must use OS address-bar input');
assert.ok(browserAcceptance.includes('windows-real-remote-browser-crash-event=PASS')&&browserAcceptance.includes('windows-real-remote-browser-crash-error=PASS')&&browserAcceptance.includes('windows-real-remote-browser-crash-detach=PASS')&&browserAcceptance.includes('windows-real-remote-browser-restart-attach=PASS')&&browserAcceptance.includes('windows-real-remote-browser-restart-continued-input=PASS')&&browserAcceptance.includes('windows-real-remote-browser-crash-recovery-closed-loop=PASS'),'Real Windows acceptance must prove structured browser crash handling and clean restart recovery');
assert.ok(uiaAcceptance.includes('windows-real-remote-uia-app-a-input=PASS')&&uiaAcceptance.includes('windows-real-remote-uia-alt-tab-handoff=PASS')&&uiaAcceptance.includes('windows-real-remote-uia-app-b-input=PASS')&&uiaAcceptance.includes('windows-real-remote-uia-alt-tab-return=PASS')&&uiaAcceptance.includes('windows-real-remote-uia-app-switch-closed-loop=PASS'),'Real Windows UIA acceptance must prove Alt+Tab foreground handoff and continued OS input');
assert.ok(uiaModalAcceptance.includes('windows-real-remote-uia-modal-open-handoff=PASS')&&uiaModalAcceptance.includes('windows-real-remote-uia-modal-action=PASS')&&uiaModalAcceptance.includes('windows-real-remote-uia-modal-close-handoff=PASS')&&uiaModalAcceptance.includes('windows-real-remote-uia-modal-closed-loop=PASS'),'Real Windows UIA modal acceptance must prove same-process HWND handoff and return');
assert.ok(uiaModalFixture.includes('ShowDialog($main)')&&uiaModalAcceptance.includes('modalPid -ne $parentPid')&&uiaModalAcceptance.includes('modalRootHwnd -eq $parentRootHwnd'),'UIA modal acceptance must prove same-process distinct-HWND behavior');
assert.ok(uiaWindowsWorkflow.includes('Real Windows UIA modal handoff acceptance')&&uiaWindowsWorkflow.includes('real-remote-uia-modal.ps1'),'Windows workflow must run the UIA modal acceptance');
assert.ok(uiaFilePickerAcceptance.includes('windows-real-remote-uia-file-picker-open-handoff=PASS')&&uiaFilePickerAcceptance.includes('windows-real-remote-uia-file-picker-semantic=PASS')&&uiaFilePickerAcceptance.includes('windows-real-remote-uia-file-picker-close-handoff=PASS')&&uiaFilePickerAcceptance.includes('windows-real-remote-uia-file-picker-closed-loop=PASS'),'Real Windows UIA file-picker acceptance must prove native common-dialog handoff and return');
assert.ok(uiaFilePickerFixture.includes('[System.Windows.Forms.OpenFileDialog]::new()')&&uiaFilePickerFixture.includes("$picker.ShowDialog($main)")&&uiaFilePickerAcceptance.includes("key='ESC'"),'UIA file-picker fixture must use native OpenFileDialog and close through OS ESC input');
assert.ok(uiaWindowsWorkflow.includes('Real Windows UIA file picker handoff acceptance')&&uiaWindowsWorkflow.includes('real-remote-uia-file-picker.ps1'),'Windows workflow must run the UIA file-picker acceptance');
assert.ok(uiaClipboardAcceptance.includes('windows-real-remote-uia-clipboard-copy=PASS')&&uiaClipboardAcceptance.includes('windows-real-remote-uia-clipboard-paste=PASS')&&uiaClipboardAcceptance.includes('windows-real-remote-uia-clipboard-closed-loop=PASS'),'Real Windows UIA clipboard acceptance must prove OS copy/paste closed loop');
assert.ok(uiaClipboardAcceptance.includes("key='C';modifiers=@('CTRL')")&&uiaClipboardAcceptance.includes("key='V';modifiers=@('CTRL')")&&uiaClipboardFixture.includes('[System.Windows.Forms.Clipboard]::Clear()'),'UIA clipboard acceptance must use OS Ctrl+C/Ctrl+V and clear test clipboard after proof');
assert.ok(!uiaClipboardAcceptance.includes('.value'),'UIA clipboard acceptance must not read textbox Value contents');
assert.ok(uiaWindowsWorkflow.includes('Real Windows UIA clipboard acceptance')&&uiaWindowsWorkflow.includes('real-remote-uia-clipboard.ps1'),'Windows workflow must run the UIA clipboard acceptance');
assert.ok(uiaDragDropAcceptance.includes('windows-real-remote-uia-drag-drop=PASS')&&uiaDragDropAcceptance.includes('windows-real-remote-uia-drag-drop-closed-loop=PASS'),'Real Windows UIA drag/drop acceptance must prove atomic OS drag closed loop');
assert.ok(uiaDragDropAcceptance.includes("type='drag'")&&uiaDragDropAcceptance.includes('sentInputs -ne 2')&&uiaDragDropFixture.includes('$source.Capture=$true')&&uiaDragDropFixture.includes('$source.Capture=$false'),'UIA drag/drop fixture must prove held-button movement and release');
assert.ok(uiaWindowsWorkflow.includes('Real Windows UIA drag drop acceptance')&&uiaWindowsWorkflow.includes('real-remote-uia-drag-drop.ps1'),'Windows workflow must run the UIA drag/drop acceptance');
assert.ok(uiaMouseButtonsAcceptance.includes('windows-real-remote-uia-right-click-context-open=PASS')&&uiaMouseButtonsAcceptance.includes('windows-real-remote-uia-context-menu-select=PASS')&&uiaMouseButtonsAcceptance.includes('windows-real-remote-uia-middle-click=PASS')&&uiaMouseButtonsAcceptance.includes('windows-real-remote-uia-double-click=PASS')&&uiaMouseButtonsAcceptance.includes('windows-real-remote-uia-mouse-buttons-closed-loop=PASS'),'Real Windows UIA mouse-button acceptance must prove right-click context menu and middle-click closed loop');
assert.ok(uiaMouseButtonsAcceptance.includes("button='right'")&&uiaMouseButtonsAcceptance.includes("button='middle'")&&uiaMouseButtonsAcceptance.includes("count=2")&&uiaMouseButtonsFixture.includes('[System.Windows.Forms.ContextMenuStrip]::new()'),'UIA mouse-button fixture must use native context menu and OS right/middle buttons');
assert.ok(uiaWindowsWorkflow.includes('Real Windows UIA mouse buttons acceptance')&&uiaWindowsWorkflow.includes('real-remote-uia-mouse-buttons.ps1'),'Windows workflow must run the UIA mouse-button acceptance');
assert.ok(uiaScreenCoordinatesAcceptance.includes('windows-real-remote-screen-topology=PASS')&&uiaScreenCoordinatesAcceptance.includes('windows-real-remote-screen-local-click=PASS')&&uiaScreenCoordinatesAcceptance.includes('windows-real-remote-screen-local-drag=PASS')&&uiaScreenCoordinatesAcceptance.includes('windows-real-remote-screen-topology-pin=PASS')&&uiaScreenCoordinatesAcceptance.includes('windows-real-remote-screen-local-negative=PASS')&&uiaScreenCoordinatesAcceptance.includes('windows-real-remote-screen-local-closed-loop=PASS'),'Screen-local acceptance must prove topology translation, DPI/topology pinning, click, drag and rejection paths');
assert.ok(uiaScreenCoordinatesAcceptance.includes('screen=$screenIndex')&&uiaScreenCoordinatesAcceptance.includes('toScreen=$screenIndex')&&uiaScreenCoordinatesAcceptance.includes('desktop_input_screen_out_of_range'),'Screen-local acceptance must exercise explicit screen/toScreen coordinates and native screen bounds');
assert.ok(uiaWindowsWorkflow.includes('Real Windows screen-local coordinates acceptance')&&uiaWindowsWorkflow.includes('real-remote-uia-screen-coordinates.ps1'),'Windows workflow must run screen-local coordinate acceptance');
assert.ok(uiaWindowLifecycleAcceptance.includes('windows-real-remote-uia-window-maximize=PASS')&&uiaWindowLifecycleAcceptance.includes('windows-real-remote-uia-window-restore=PASS')&&uiaWindowLifecycleAcceptance.includes('windows-real-remote-uia-window-close-handoff=PASS')&&uiaWindowLifecycleAcceptance.includes('windows-real-remote-uia-window-close-continued-input=PASS')&&uiaWindowLifecycleAcceptance.includes('windows-real-remote-uia-window-lifecycle-closed-loop=PASS'),'Real Windows UIA window lifecycle acceptance must prove maximize/restore/close handoff and continued input');
assert.ok(uiaWindowLifecycleAcceptance.includes("key='UP';modifiers=@('WIN')")&&uiaWindowLifecycleAcceptance.includes("key='DOWN';modifiers=@('WIN')")&&uiaWindowLifecycleAcceptance.includes("key='F4';modifiers=@('ALT')")&&uiaWindowLifecycleFixture.includes("$form.FormBorderStyle='Sizable'"),'UIA window lifecycle acceptance must use OS window-management keys on a sizable native window');
assert.ok(uiaWindowLifecycleAcceptance.includes("'windows'")&&uiaWindowLifecycleAcceptance.includes('bounds.width')&&uiaWindowLifecycleAcceptance.includes('foreground_handoff:*'),'UIA window lifecycle acceptance must verify actual window bounds and root-handoff journal state');
assert.ok(uiaWindowLifecycleAcceptance.includes('ProcessStartInfo')&&uiaWindowLifecycleAcceptance.includes('ArgumentList.Add'),'UIA window lifecycle fixture launch must preserve spaced path/title arguments');
assert.ok(uiaWindowLifecycleAcceptance.includes('windows-real-remote-uia-window-pre-attach-foreground=PASS')&&uiaWindowLifecycleAcceptance.includes("'status'"),'UIA window lifecycle acceptance must verify helper-observed foreground before semantic attach');
assert.ok(uiaWindowsWorkflow.includes('Real Windows UIA window lifecycle acceptance')&&uiaWindowsWorkflow.includes('real-remote-uia-window-lifecycle.ps1'),'Windows workflow must run the UIA window lifecycle acceptance');
for(const token of ['RootHwnd { get; set; }','RefreshSemanticForegroundRoot','foreground_handoff:0x','session.ScopeChanged = false'])assert.ok(semanticHelper.includes(token),'Windows UIA foreground handoff contract missing: '+token);
assert.ok(uiaAcceptance.includes("key='TAB';modifiers=@('ALT')")&&uiaFixture.includes('[System.Windows.Forms.Application]::Run($form)'),'UIA app-switch acceptance must use OS Alt+Tab between visible WinForms processes');
assert.ok(uiaWindowsWorkflow.includes('Real Windows UIA app switch acceptance')&&uiaWindowsWorkflow.includes('real-remote-uia-app-switch.ps1'),'Windows workflow must run the UIA app-switch acceptance');
assert.ok(browserCrossOriginServer.includes("serverA.listen(0,'127.0.0.1'")&&browserCrossOriginServer.includes("serverB.listen(0,'127.0.0.1'")&&browserCrossOriginServer.includes('/origin-a')&&browserCrossOriginServer.includes('/origin-b'),'Cross-origin fixture must use two distinct loopback origins');
assert.ok(!browserCdpHelper.includes('Input.dispatch')&&!browserSnapshotHelper.includes('Input.dispatch')&&!inputAckHelper.includes('Input.dispatch'),'Browser CDP must remain observation-only for input');
assert.ok(!browserCdpHelper.includes('Runtime.evaluate')&&!browserSnapshotHelper.includes('Runtime.evaluate')&&!inputAckHelper.includes('Runtime.evaluate'),'Browser CDP must not inject page script for ACK');
for(const token of ['SemanticProvider(args)','browser-cdp','BrowserSemanticAttach(args)','BrowserSemanticSnapshot(args)','BrowserSemanticDetach(args)'])assert.ok(semanticHelper.includes(token),`Browser semantic provider routing missing: ${token}`);
for(const token of ['ClientWebSocket','socket.Options.Proxy = null','UseProxy = false','AllowAutoRedirect = false','BrowserLoopbackHost','browser_cdp_endpoint_not_loopback','browser_cdp_websocket_not_loopback','Accessibility.enable','DOM.enable','Page.enable','DevToolsActivePort','BrowserSemanticJournalLimit = 512'])assert.ok(browserCdpHelper.includes(token),`Browser CDP contract missing: ${token}`);
for(const token of ['Accessibility.getFullAXTree','DOMSnapshot.captureSnapshot','includePaintOrder','Page.getLayoutMetrics','Browser.getWindowForTarget','screenBoundsEstimate','paintOrder','chromium-cdp','coordinateSpace'])assert.ok(browserSnapshotHelper.includes(token),`Browser semantic snapshot contract missing: ${token}`);
assert.ok(!browserSnapshotHelper.includes('Runtime.evaluate'),'Browser semantic provider must not inject page script');
assert.ok(!browserCdpHelper.includes('Process.Start('),'Browser semantic provider must not launch Chromium or enable debugging');
assert.ok(!inputHelper.includes('mouse_event('),'legacy mouse_event must not be used');
assert.ok(!read('lib/real-remote-input.cjs').includes("type==='raw'"),'raw arbitrary INPUT packets must not be exposed');
for(const source of [supervisor,host]){
  assert.ok(source.includes('LIGHT_REMOTE_CLIENT_EXE'),'Windows Agent launcher does not expose native client helper path');
  assert.ok(source.includes('LIGHT_REMOTE_REAL_REMOTE'),'Windows Agent launcher does not enable feature branch capability');
}

const agent=read('device-agent/operator-agent.mjs');
assert.ok(agent.includes("import { NativeDesktopBridge, realRemoteAvailable } from '../lib/native-desktop.mjs'"));
assert.ok(agent.includes("withRealRemoteCapabilities(PLATFORM_ADAPTER.discoverCapabilities(),{available:REAL_REMOTE_AVAILABLE})"));
assert.ok(agent.includes("p.type==='desktop'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('status'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('windows'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('frame'"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('input'")&&agent.includes("local capability denied: desktop-input")&&agent.includes("normalizeDesktopInput(request)"));
assert.ok(agent.includes("NATIVE_DESKTOP.request('semantic-attach'")&&agent.includes("NATIVE_DESKTOP.request('semantic-snapshot'")&&agent.includes("NATIVE_DESKTOP.request('semantic-events'")&&agent.includes("NATIVE_DESKTOP.request('semantic-detach'"));
assert.ok(agent.includes("'browser-cdp'")&&agent.includes("semantic.cdpEndpoint")&&agent.includes("semantic.targetId")&&agent.includes("semantic.urlMatch"));

const executor=read('operator-host/executor.mjs');
const routes=read('operator-host/executor-routes-runtime.mjs');
const api=read('api/operator.js');
const toolHelper=read('lib/plus-tool-helper.js');
const wall=read('device-agent/local-wall.mjs');
const windowsWorkflow=read('.github/workflows/windows-native-client.yml');
assert.ok(executor.includes('async function startDesktopOperation(')&&executor.includes("payload:{type:'desktop'")&&executor.includes("op==='input'?['desktop','desktop-input']:['desktop']")&&executor.includes("normalizeDesktopInput(request)")&&executor.includes("'semantic-attach'")&&executor.includes("'semantic-snapshot'")&&executor.includes("'semantic-events'")&&executor.includes("'semantic-detach'"));
assert.ok(routes.includes("'desktop'].includes(payload.action)")&&routes.includes("payload.action==='desktop'?await startDesktopOperation"));
assert.ok(api.includes("action.startsWith('desktop-')")&&api.includes("'status','windows','frame','input','semantic-attach','semantic-snapshot','semantic-events','semantic-detach'")&&api.includes("normalizeDesktopInput")&&api.includes("semanticSessionId:d.semanticSessionId")&&api.includes("afterSeq:d.afterSeq")&&api.includes("settleMs:d.settleMs")&&api.includes("'browser-cdp'")&&api.includes("desktop.cdpEndpoint")&&api.includes("desktop.targetId")&&api.includes("desktop.urlMatch")&&api.includes("action:'desktop'"));
assert.ok(toolHelper.includes("desktop-status")&&toolHelper.includes("desktop-windows")&&toolHelper.includes("desktop-frame")&&toolHelper.includes("desktop-semantic-attach")&&toolHelper.includes("desktop-semantic-snapshot")&&toolHelper.includes("desktop-semantic-events")&&toolHelper.includes("desktop-semantic-detach")&&toolHelper.includes("desktop-input")&&toolHelper.includes("provider?,scope?")&&toolHelper.includes("cdpEndpoint?,targetId?,urlMatch?")&&toolHelper.includes("browser-cdp")&&toolHelper.includes("loopback Chromium DevTools")&&toolHelper.includes("semanticSessionId?,afterSeq?,settleMs?")&&toolHelper.includes("inputSeq")&&toolHelper.includes("capabilities:['desktop','desktop-input']"));
assert.ok(wall.includes("'desktop':['Desktop view'")&&wall.includes("'desktop-input':['Desktop input'")&&wall.includes("locally blocked by default"));
assert.ok(windowsWorkflow.includes('- name: Real Remote hidden helper smoke')&&windowsWorkflow.includes('timeout-minutes: 1')&&windowsWorkflow.includes('--real-remote-helper')&&windowsWorkflow.includes('windows-real-remote-helper=PASS')&&windowsWorkflow.includes('windows-real-remote-input-negative=PASS')&&windowsWorkflow.includes('windows-real-remote-semantic=PASS')&&windowsWorkflow.includes('windows-real-remote-semantic-events=PASS')&&windowsWorkflow.includes('windows-real-remote-input-ack=PASS')&&windowsWorkflow.includes('windows-real-remote-browser-cdp=PASS')&&windowsWorkflow.includes('windows-real-remote-browser-input-ack=PASS'));

console.log('v11-real-remote-jsonl-bridge=PASS');
console.log('v11-real-remote-same-app-windows-helper=PASS');
console.log('v11-real-remote-readonly-routing=PASS');
console.log('v11-real-remote-frame-visual-proof=PASS');
console.log('v11-real-remote-input-default-deny=PASS');
console.log('v11-real-remote-bounded-input=PASS');
console.log('v11-real-remote-semantic-session=PASS');
console.log('v11-real-remote-semantic-event-journal=PASS');
console.log('v11-real-remote-closed-loop-input-ack=PASS');
console.log('v11-real-remote-browser-cdp-semantic=PASS');
console.log('v11-real-remote-browser-input-ack=PASS');
