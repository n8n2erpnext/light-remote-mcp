import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {NativeDesktopBridge,realRemoteAvailable} from '../../lib/native-desktop.mjs';
const app=process.env.HOME+'/Applications/LightRemoteRobotDev.app';
const env={...process.env,LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_MACOS_GUI_SIDECAR:'1',LIGHT_REMOTE_MACOS_GUI_APP:app};
const b=new NativeDesktopBridge({platform:'darwin',env,command:'',timeoutMs:16000});
let visual=null,semantic=null;
try{
 assert.equal(realRemoteAvailable({platform:'darwin',env}),true);
 assert.equal(realRemoteAvailable({platform:'darwin',env:{...env,LIGHT_REMOTE_MACOS_GUI_APP:'/tmp/fake.app'}}),false);
 const st=await b.request('status');
 assert.equal(st.screenRecording,true);
 assert.equal(st.accessibility,true);
 assert.equal(b.running,true);
 console.log('operator_bridge_gui_status=PASS');
 const windows=await b.request('windows');
 assert.ok(Array.isArray(windows));
 const frame=await b.request('frame',{screen:0,maxWidth:700,maxHeight:400,quality:40},{timeoutMs:16000});
 const bytes=Buffer.from(frame.data,'base64');
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),frame.frameSha256);
 console.log('operator_bridge_gui_frame=PASS bytes='+bytes.length);
 visual=await b.request('visual-attach',{screen:0,leaseMs:15000});
 assert.ok(visual.visualSessionId);
 assert.equal(visual.cursorOverlayActive,true);
 const vf=await b.request('visual-frame',{visualSessionId:visual.visualSessionId,leaseToken:visual.leaseToken},{timeoutMs:16000});
 assert.ok(vf.frame.frameSha256);
 await b.request('visual-detach',visual);
 visual=null;
 console.log('operator_bridge_gui_visual=PASS');
 semantic=await b.request('semantic-attach',{scope:'foreground',maxDepth:4,maxNodes:100});
 const snap=await b.request('semantic-snapshot',{semanticSessionId:semantic.semanticSessionId});
 assert.ok(Array.isArray(snap.snapshot.nodes));
 await b.request('semantic-detach',{semanticSessionId:semantic.semanticSessionId});
 semantic=null;
 console.log('operator_bridge_gui_ax=PASS');
 console.log('MAC_OPERATOR_NATIVE_BRIDGE_E2E=PASS');
}catch(e){
 console.error('MAC_OPERATOR_NATIVE_BRIDGE_E2E=FAIL '+e.message);process.exitCode=1;
}finally{
 if(visual)try{await b.request('visual-detach',visual)}catch{}
 if(semantic)try{await b.request('semantic-detach',{semanticSessionId:semantic.semanticSessionId})}catch{}
 b.close();
}
