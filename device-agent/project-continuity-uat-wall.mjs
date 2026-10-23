/* UAT entrypoint into the SAME Local Wall used by Light Remote.
 * Only the Project Continuity feature is connected in this disposable LXD;
 * no pretend device enrollment, cloud connection or remote job capabilities.
 */
import {startLocalWall} from './local-wall.mjs';
import {loadLocalWallAuth} from './local-wall-auth.mjs';
import {projectContinuityRequest,projectContinuityOwnerConsent} from './project-continuity-client.mjs';

if(process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER!=='1')
 throw Error('continuity_uat_requires_isolated_broker');
const auth=loadLocalWallAuth(process.env.LIGHT_REMOTE_CONTINUITY_UAT_AUTH_FILE,{required:true});
if(!auth.enabled||auth.mode!=='local')throw Error('continuity_uat_wall_owner_auth_required');
const port=Number(process.env.LIGHT_REMOTE_CONTINUITY_UAT_WEB_PORT||5587);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('continuity_uat_port_invalid');

const localStatus=()=>({
 cloudState:'disconnected',cloudDesiredConnected:false,
 deviceId:null,deviceName:'Continuity isolated LXD UAT (no enrolled device)',
 platform:'linux',agentVersion:'Continuity UAT only',uatMode:'continuity_broker_only',
 connectionReady:false,remoteControlAvailable:false
});
const wall=startLocalWall({
 host:'127.0.0.1',port,auth,
 getLocalStatus:localStatus,getLocalPolicyStatus:localStatus,
 continuity:{
  request:(action,data)=>projectContinuityRequest(action,data),
  ownerConsent:({principal,password,projectId,enabled,expectedRevision})=>
    projectContinuityOwnerConsent({principal,password,projectId,enabled,expectedRevision})
 }
});
if(!wall?.server)throw Error('continuity_uat_wall_server_not_ready');
console.log('CONTINUITY_SHARED_WALL_READY 127.0.0.1:'+port);
