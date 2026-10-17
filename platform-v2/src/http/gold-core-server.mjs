/**
 * Independently runnable Gold Core Unix-socket API component.
 *
 * This is not the complete Light Remote Operator/Fleet. Production must not
 * be replaced with this partial service until the full cutover gate passes.
 * No legacy file business-state stores, no open TCP port, no insecure
 * verifier defaults. Caller MUST supply audited ingress identity verifiers.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {openGoldDataPlane} from '../storage/gold-data-plane.mjs';
import {GoldPgCoreAuthority} from '../storage/gold-core-authority.mjs';
import {GoldPgTeamUsageAuthority} from '../storage/gold-team-usage-authority.mjs';
import {GoldPgAgentClientAuthority} from '../storage/gold-agent-client-authority.mjs';
import {GoldPgRemoteSessionAuthority} from '../storage/gold-remote-session-authority.mjs';
import {GoldPgDeviceChannelAuthority} from '../storage/gold-device-channel-authority.mjs';
import {GoldPgNotificationRepository} from '../storage/notifications-pg.mjs';
import {createGoldCoreHttpHandler} from './gold-core-http.mjs';

const requiredVerifiers=[
 'verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
 'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof',
 'verifyUsageEvidence','approveWallRequest','verifyAgentIngress',
 'verifyOAuthClient','verifyBillingIngress','verifyUsageIngress',
 'verifyDeviceChannelIngress','verifyChannelEnvelope'
];
const strict=(v,message)=>{if(!v)throw Error(message)};
const underRoot=(root,socket)=>{
 const dir=fs.realpathSync(path.dirname(socket)),base=fs.realpathSync(root);
 strict(dir.startsWith(base+path.sep),'gold_core_socket_outside_isolated_root');
 const info=fs.statSync(dir);
 strict(info.isDirectory()&&(info.mode&0o077)===0,
  'gold_core_socket_parent_must_be_private');
 strict(!fs.existsSync(socket),'gold_core_socket_path_exists');
};
const verifyAll=verifiers=>{
 for(const name of requiredVerifiers)
  strict(typeof verifiers?.[name]==='function','gold_core_ingress_verifier_required_'+name);
};
export async function startGoldCoreApi({env=process.env,verifiers,
 openPlane=openGoldDataPlane,socketPath,openCore,openTeam,openAgent,openRemoteSessions,openDeviceChannel,openNotifications}={}){
 verifyAll(verifiers);
 strict(env.LIGHT_REMOTE_GOLD_INDEPENDENT==='1','gold_core_independent_runtime_required');
 const pathName=socketPath||env.LR_GOLD_CORE_SOCKET;
 strict(path.isAbsolute(String(pathName||'')),'gold_core_socket_path_absolute_required');
 const root=String(env.LIGHT_REMOTE_GOLD_ROOT||'');
 strict(root,'gold_core_isolated_root_required');
 underRoot(root,pathName);
 let dataPlane,server,opened=false;
 try{
  dataPlane=await openPlane({env,role:'operator'});
  strict(dataPlane?.pool&&dataPlane.redis&&dataPlane.postgres&&dataPlane.cache,
   'gold_core_verified_data_plane_required');
  const core=openCore?openCore({
   pool:dataPlane.pool,verifiers
  }):new GoldPgCoreAuthority({
   pool:dataPlane.pool,
   pairingEncryptionKey:verifiers.pairingEncryptionKey,
   verifyIdentityProof:verifiers.verifyIdentityProof,
   verifyDeviceProof:verifiers.verifyDeviceProof,
   verifyAgentPrincipal:verifiers.verifyAgentPrincipal,
   verifyWallApproval:verifiers.verifyWallApproval,
   verifyPaddleSignature:verifiers.verifyPaddleSignature
  });
  const team=openTeam?openTeam({pool:dataPlane.pool,core,verifiers}):
   new GoldPgTeamUsageAuthority({
    pool:dataPlane.pool,core,
    verifyOwnerProof:verifiers.verifyOwnerProof,
    verifyUsageEvidence:verifiers.verifyUsageEvidence
   });
  const agentClients=openAgent?openAgent({pool:dataPlane.pool,verifiers}):
   new GoldPgAgentClientAuthority({pool:dataPlane.pool,
    verifyAgentPrincipal:verifiers.verifyAgentPrincipal});
  const remoteSessions=openRemoteSessions?
   openRemoteSessions({pool:dataPlane.pool,agentClients,verifiers}):
   new GoldPgRemoteSessionAuthority({pool:dataPlane.pool,agentClients});
  const deviceChannel=openDeviceChannel?openDeviceChannel({pool:dataPlane.pool,verifiers}):
   new GoldPgDeviceChannelAuthority({pool:dataPlane.pool,
    verifyChannelEnvelope:verifiers.verifyChannelEnvelope});
  const notifications=openNotifications?openNotifications({pool:dataPlane.pool,core,verifiers}):
   new GoldPgNotificationRepository({pool:dataPlane.pool});
  const route=createGoldCoreHttpHandler({
   core,team,agentClients,remoteSessions,deviceChannel,notifications,
   verifyNotificationAdmin:verifiers.verifyNotificationAdmin,
   approveWallRequest:verifiers.approveWallRequest,
   verifyAgentIngress:verifiers.verifyAgentIngress,
   verifyOAuthClient:verifiers.verifyOAuthClient,
   verifyBillingIngress:verifiers.verifyBillingIngress,
   verifyUsageIngress:verifiers.verifyUsageIngress,
   verifyDeviceChannelIngress:verifiers.verifyDeviceChannelIngress
  });
  server=http.createServer(async(req,res)=>{
   try{
    if(req.method==='GET'&&(req.url==='/healthz'||req.url==='/readyz')){
     // A successful startup check is insufficient: report readiness only
     // while the actual PostgreSQL + Redis clients remain responsive.
     try{
      const [database,redis]=await Promise.all([
       dataPlane.pool.query('SELECT 1 AS gold_ready'),
       dataPlane.redis.ping()
      ]);
      if(Number(database?.rows?.[0]?.gold_ready)!==1||redis!=='PONG')
       throw Error('gold_core_dependency_unavailable');
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({ok:true,role:'gold-core-only',
       database:dataPlane.postgres.database,schemaVersion:dataPlane.postgres.schemaVersion,
       redis:true,cutoverComplete:false}));
     }catch(error){
      res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({ok:false,error:'gold_core_dependency_unavailable',
       cutoverComplete:false}));
     }
     return;
    }
    if(req.url?.startsWith('/v1/')){
     // Do not accept authorization or payment work based on a stale startup
     // healthcheck. Redis coordination failure must block mutations too.
     const [db,redis]=await Promise.all([
      dataPlane.pool.query('SELECT 1 AS gold_ready'),
      dataPlane.redis.ping()
     ]);
     if(Number(db?.rows?.[0]?.gold_ready)!==1||redis!=='PONG')
      throw Error('gold_core_dependency_unavailable');
    }
    if(!(await route(req,res))){
     res.statusCode=404;res.end();
    }
   }catch{
    if(!res.headersSent){res.statusCode=503;res.end('service_unavailable')}
    else res.destroy();
   }
  });
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(pathName,()=>{
    server.off('error',reject);resolve();
   });
  });
  opened=true;
  fs.chmodSync(pathName,0o600);
  const boundSocket=fs.statSync(pathName);
  return{
   socketPath:pathName,
   async close(){
    await new Promise(resolve=>server.close(resolve));
    // Don't unlink a path someone replaced while the service ran.
    const actual=fs.statSync(pathName,{throwIfNoEntry:false});
    if(actual?.isSocket()&&actual.dev===boundSocket.dev&&
       actual.ino===boundSocket.ino)fs.unlinkSync(pathName);
    await dataPlane.close();
   }
  };
 }catch(error){
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
  if(opened&&fs.existsSync(pathName))fs.unlinkSync(pathName);
  if(dataPlane)await dataPlane.close();
  throw error;
 }
}
