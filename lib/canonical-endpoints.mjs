import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const ORIGIN_ROLES=['owner','operator','deviceChannel','mcp'];
const REQUIRE_ROUTES=['ownerAuthorize','ownerToken','ownerRefresh','ownerSession',
 'ownerSnapshot','ownerLogout','wallHome','wallStatus','wallInstanceProof','wallApprovePage','wallBApprove'];
const ROUTE_ROLES=['owner','operator','deviceChannel','mcp','local.wall','local.fleet'];
const PRODUCTS=['goldabv2-desktop-v4'];
const validOrigin=value=>{
 if(typeof value!=='string')return false;
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&url.origin===value&&!url.username&&
   !url.password&&!url.search&&!url.hash&&url.hostname.endsWith('.thaiduy.digital')&&
   !url.port&&url.hostname.startsWith('goldabv2.');
 }catch{return false;}
};
const requireValid=(yes,reason)=>{if(!yes)throw Error('endpoint_config_'+reason);};
export function validateCanonicalEndpoints(raw,{expectedProfile='goldabv2-lab',
 expectedProduct='goldabv2-desktop-v4'}={}){
 requireValid(raw&&typeof raw==='object'&&!Array.isArray(raw),'format');
 requireValid(raw.schemaVersion===1&&Number.isSafeInteger(raw.configRevision)&&
  raw.configRevision>0,'schema_or_revision');
 requireValid(typeof raw.selectedProfile==='string'&&raw.selectedProfile===expectedProfile,
  'profile_mismatch');
 const profile=raw.profiles?.[expectedProfile];
 requireValid(profile&&PRODUCTS.includes(profile.productId)&&profile.productId===expectedProduct,
  'product_mismatch');
 for(const role of ORIGIN_ROLES)
  requireValid(validOrigin(profile.cloudOrigins?.[role]),'invalid_https_origin_'+role);
 for(const name of ['wall','fleet']){
  const service=profile.localServices?.[name];
  requireValid((service?.host==='127.0.0.1'||service?.host==='::1')&&
   Number.isInteger(service.port)&&service.port>=1024&&service.port<=65535,
   'local_loopback_'+name);
 }
 const updates=profile.updates;
 requireValid(updates?.productId===profile.productId&&updates.channel==='goldabv2-lab',
  'update_profile');
 requireValid(updates?.manifestUrl===null&&updates?.signatureUrl===null&&
  updates?.activationStatus==='HOLD_UNTIL_APPROVED_PRODUCT_FEED_EXISTS',
  'unexpected_update_feed');
 const routes=raw.routeCatalog;
 requireValid(routes&&typeof routes==='object','routes_missing');
 for(const name of REQUIRE_ROUTES)requireValid(Boolean(routes[name]),'route_missing_'+name);
 for(const [name,row] of Object.entries(routes)){
  requireValid(row&&ROUTE_ROLES.includes(row.originRole)&&
   (row.method===undefined||['GET','POST'].includes(row.method)),
   'route_role_or_method_'+name);
  requireValid(typeof row.path==='string'&&/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(row.path)&&
   !row.path.includes('..')&&!row.path.includes('//'),'route_path_'+name);
  if(row.fragment!==undefined)
   requireValid(/^[a-zA-Z0-9_-]+$/.test(row.fragment),'route_fragment_'+name);
 }
 requireValid(raw.releaseIntegrity?.signedManifestRequired===true&&
  raw.releaseIntegrity?.status==='NO_SIGNED_GOLDABV2_FEED_HOLD',
  'release_integrity');
 return Object.freeze({schemaVersion:1,configRevision:raw.configRevision,
  selectedProfile:expectedProfile,productId:profile.productId,
  endpointProfile:profile.endpointProfile,
  cloudOrigins:Object.freeze({...profile.cloudOrigins}),
  localServices:Object.freeze({
   wall:Object.freeze({...profile.localServices.wall}),
   fleet:Object.freeze({...profile.localServices.fleet})}),
  updates:Object.freeze({...updates}),routeCatalog:Object.freeze({...routes})});
}
export function loadCanonicalEndpoints(file,{expectedProfile='goldabv2-lab',
 expectedProduct='goldabv2-desktop-v4'}={}){
 const path=typeof file==='string'?file:fileURLToPath(file);
 return validateCanonicalEndpoints(JSON.parse(fs.readFileSync(path,'utf8')),
  {expectedProfile,expectedProduct});
}
export function canonicalRoute(config,name){
 const row=config.routeCatalog[name];
 requireValid(Boolean(row),'route_unknown');
 const role=row.originRole;
 const base=role==='local.wall'||role==='local.fleet'
  ?(()=>{const s=config.localServices[role.slice(6)];
    return 'http://'+(s.host==='::1'?'[::1]':s.host)+':'+s.port;})()
  :config.cloudOrigins[role];
 requireValid(typeof base==='string','route_origin');
 return base+row.path+(row.fragment?'#'+row.fragment:'');
}
