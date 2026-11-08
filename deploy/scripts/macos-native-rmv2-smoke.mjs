import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeDesktopBridge} from '../../lib/native-desktop.mjs';

const helper=process.argv[2];
assert.ok(helper&&fs.existsSync(helper),'compiled macOS helper required');
const bridge=new NativeDesktopBridge({command:helper,platform:'darwin',timeoutMs:10000});
try {
  const status=await bridge.request('status');
  assert.equal(status.runtime,'real-remote-v2-macos');
  assert.ok(Array.isArray(status.topology?.screens),'macOS display topology');
  console.log('macos-native-rmv2-rpc-duplex=PASS screens='+status.topology.screenCount);
  const windows=await bridge.request('windows');
  assert.ok(Array.isArray(windows),'windows array');
  console.log('macos-native-rmv2-windows=PASS count='+windows.length);
  // The CI runner should not obtain TCC silently. If permissions are not
  // granted, asserting fail-closed behavior is part of the acceptance gate.
  if(status.screenRecording===false){
    await assert.rejects(bridge.request('frame'),/macos_screen_recording_permission_required/);
    await assert.rejects(bridge.request('visual-attach'),/macos_screen_recording_permission_required/);
    console.log('macos-native-rmv2-screen-tcc-deny=PASS');
  }
  if(status.accessibility===false){
    await assert.rejects(bridge.request('semantic-attach'),/macos_accessibility_permission_required/);
    console.log('macos-native-rmv2-semantic-tcc-deny=PASS');
  }
  console.log('MACOS_NATIVE_RMV2_CI_SMOKE=PASS');
}finally{bridge.close();}
