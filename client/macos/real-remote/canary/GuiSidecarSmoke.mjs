#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MacGuiRobotSidecar} from './GuiSidecarBroker.mjs';

const app=process.argv[2];
if(!app){console.error('experimental GUI canary app path required');process.exit(2)}
const broker=new MacGuiRobotSidecar({appPath:app});
try{
 await broker.start();
 const result=await broker.request('desktop.status');
 if(result.runtime!=='real-remote-v2-macos')throw new Error('wrong_native_runtime');
 console.log(JSON.stringify({
   guiSidecar:'PASS',runtime:result.runtime,
   screenRecording:result.screenRecording,accessibility:result.accessibility,
   visualSessions:result.visualSessions
 }));
}catch(e){console.error('GUI_SIDECAR_SMOKE=FAIL '+e.message);process.exitCode=1}
finally{broker.close()}
