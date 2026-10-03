export const STABLE_PUBLIC_ENDPOINT='https://light-remote.thaiduy.digital';

export const LEGACY_DEFAULT_BASE_ENDPOINTS=Object.freeze([
  'https://light-remote-mcp.vercel.app'
]);

export const LEGACY_DEFAULT_HUB_ENDPOINTS=Object.freeze([
  'https://mcp.dashboard.thaiduy.store'
]);

function normalize(value){
  return String(value||'').trim().replace(/\/+$/,'');
}

export function migrateLegacyEndpoint(value,{kind='base',fallback=STABLE_PUBLIC_ENDPOINT}={}){
  const clean=normalize(value)||normalize(fallback)||STABLE_PUBLIC_ENDPOINT;
  const legacy=kind==='hub'?LEGACY_DEFAULT_HUB_ENDPOINTS:LEGACY_DEFAULT_BASE_ENDPOINTS;
  return legacy.includes(clean)?STABLE_PUBLIC_ENDPOINT:clean;
}
