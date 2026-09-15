const SEMVER_RE=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
export function parseVersion(value){
  const m=String(value||'').trim().match(SEMVER_RE);if(!m)return null;
  return{raw:String(value||'').trim().replace(/^v/,''),core:m.slice(1,4).map(Number),pre:m[4]?m[4].split('.'):[]};
}
function comparePre(a,b){
  if(!a.length&&!b.length)return 0;if(!a.length)return 1;if(!b.length)return-1;
  for(let i=0;i<Math.max(a.length,b.length);i++){
    if(i>=a.length)return-1;if(i>=b.length)return 1;
    const x=a[i],y=b[i],xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn&&yn){const d=Number(x)-Number(y);if(d)return d>0?1:-1;continue;}
    if(xn!==yn)return xn?-1:1;if(x!==y)return x>y?1:-1;
  }return 0;
}
export function compareVersion(a,b){
  const x=parseVersion(a),y=parseVersion(b);if(!x||!y)return null;
  for(let i=0;i<3;i++){if(x.core[i]!==y.core[i])return x.core[i]>y.core[i]?1:-1;}
  return comparePre(x.pre,y.pre);
}
function rcNumber(v){const p=parseVersion(v);return p?.pre?.[0]==='rc'&&/^\d+$/.test(p.pre[1]||'')?Number(p.pre[1]):null;}
export function minimumSupportedVersion(current,{backwardReleases=3,explicit=null}={}){
  if(explicit&&parseVersion(explicit))return parseVersion(explicit).raw;
  const p=parseVersion(current);if(!p)return null;const rc=rcNumber(current);
  if(rc!=null)return `${p.core.join('.')}-rc.${Math.max(1,rc-Math.max(0,Number(backwardReleases)||0))}`;
  return `${p.core[0]}.${p.core[1]}.${Math.max(0,p.core[2]-Math.max(0,Number(backwardReleases)||0))}`;
}
export function clientCompatibility(current,client,options={}){
  const latest=parseVersion(current)?.raw||String(current||''),reported=parseVersion(client)?.raw||String(client||''),minimum=minimumSupportedVersion(current,options);
  const c=parseVersion(client),s=parseVersion(current),min=parseVersion(minimum);
  if(!c||!s||!min)return{supported:false,updateRequired:true,status:'client_update_required',reason:'client_version_invalid',clientVersion:reported,minimumSupportedVersion:minimum,latestVersion:latest};
  const newer=compareVersion(c.raw,s.raw)>0;if(newer)return{supported:false,updateRequired:false,status:'server_update_required',reason:'client_newer_than_server',clientVersion:c.raw,minimumSupportedVersion:minimum,latestVersion:latest};
  const supported=compareVersion(c.raw,min.raw)>=0;
  return{supported,updateRequired:!supported,status:supported?'supported':'client_update_required',reason:supported?'supported_version':'client_version_too_old',clientVersion:c.raw,minimumSupportedVersion:minimum,latestVersion:latest};
}
