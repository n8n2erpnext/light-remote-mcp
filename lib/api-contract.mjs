import fs from 'node:fs';
const project=JSON.parse(fs.readFileSync(new URL('../project.manifest.json',import.meta.url),'utf8'));
const contract=JSON.parse(fs.readFileSync(new URL('../contracts/api.v1.json',import.meta.url),'utf8'));
const catalog=JSON.parse(fs.readFileSync(new URL('../config/endpoints.json',import.meta.url),'utf8'));
if(project.apiContractVersion!==contract.contractVersion||contract.schemaVersion!==1)
 throw Error('unified_api_contract_version_mismatch');
export const API_CONTRACT_VERSION=contract.contractVersion;
export const API_VERSION_HEADER='X-Light-Remote-API-Version';
const routes=new Map(Object.entries({...catalog.routeCatalog,...catalog.internalRoutes}).map(([name,row])=>[name,Object.freeze({...row})]));
for(const name of Object.keys(contract.routes)){
 const route=routes.get(name);
 if(!route||!['GET','POST'].includes(route.method)||!/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(route.path)||route.path.includes('..'))
  throw Error('unified_api_contract_route_invalid:'+name);
}
export function apiPath(name){
 const route=routes.get(name);
 if(!route)throw Error('unified_api_contract_unknown_route');
 return route.path;
}
export function apiRoute(name){
 const route=routes.get(name);
 if(!route)throw Error('unified_api_contract_unknown_route');
 return route;
}
export function assertApiVersion(value){
 if(value!==API_CONTRACT_VERSION)throw Error('unified_api_contract_mismatch');
 return true;
}
