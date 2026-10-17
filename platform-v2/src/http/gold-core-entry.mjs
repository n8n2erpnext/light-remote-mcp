/**
 * Production-independent Gold Core API launcher. This intentionally runs only
 * the Core API, NOT the complete Light Remote Operator/Fleet/Plugin.
 *
 * Trusted callbacks are owner-provisioned in a private module inside the Gold
 * independent runtime root and must not contain insecure no-op verifiers.
 * No generated verifier keys, account seeds or plaintext passwords.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startGoldCoreApi} from './gold-core-server.mjs';

const required=['verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
 'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof',
 'verifyUsageEvidence','approveWallRequest','verifyAgentIngress',
 'verifyOAuthClient','verifyBillingIngress','verifyUsageIngress',
 'verifyDeviceChannelIngress','verifyChannelEnvelope'];
export function validateGoldVerifierPath(env=process.env){
 if(env.LIGHT_REMOTE_GOLD_INDEPENDENT!=='1')
  throw Error('gold_core_requires_independent_runtime');
 const root=fs.realpathSync(String(env.LIGHT_REMOTE_GOLD_ROOT||''));
 const filename=String(env.LR_GOLD_VERIFIERS_MODULE||'');
 if(!path.isAbsolute(filename))throw Error('gold_core_verifier_path_absolute_required');
 const real=fs.realpathSync(filename);
 if(!real.startsWith(root+path.sep))throw Error('gold_core_verifier_outside_private_root');
 const st=fs.statSync(real),dir=fs.statSync(path.dirname(real));
 if(!real.endsWith('.mjs')||!st.isFile()||st.uid!==process.getuid()||
    (st.mode&0o077)!==0||(st.mode&0o600)!==0o600||
    !dir.isDirectory()||(dir.mode&0o077)!==0)
  throw Error('gold_core_verifier_file_not_private_owner');
 return real;
}
export async function bootGoldCoreFromEnvironment({env=process.env,
 importer=async file=>import(pathToFileURL(file).href),
 start=startGoldCoreApi}={}){
 const file=validateGoldVerifierPath(env);
 const ownerModule=await importer(file);
 const verifiers=ownerModule?.goldCoreVerifiers;
 if(!verifiers||typeof verifiers!=='object')
  throw Error('gold_core_verifier_bundle_missing');
 for(const fn of required)if(typeof verifiers[fn]!=='function')
  throw Error('gold_core_verifier_required_'+fn);
 if(!Buffer.isBuffer(verifiers.pairingEncryptionKey)||
    verifiers.pairingEncryptionKey.length!==32)
  throw Error('gold_core_pairing_encryption_key_missing');
 return start({env,verifiers});
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(
 new URL(import.meta.url).pathname)){
 let closing=false,instance;
 const terminate=async signal=>{
  if(closing)return;
  closing=true;
  try{await instance?.close();process.exit(0)}
  catch(e){console.error('[gold-core] shutdown failed:',e.message);process.exit(1)}
 };
 process.on('SIGTERM',()=>void terminate('SIGTERM'));
 process.on('SIGINT',()=>void terminate('SIGINT'));
 try{
  instance=await bootGoldCoreFromEnvironment();
  // Non-secret local socket reference, never dump credentials or proof tokens.
  console.log('[gold-core] Core API initialized (NOT full cutover)');
 }catch(e){console.error('[gold-core] admission denied:',e.message);process.exit(1)}
}
