const COOKIE='__Host-light_remote_account';
function parseCookies(header=''){
  const out={};for(const part of String(header).split(';')){const i=part.indexOf('=');if(i<1)continue;out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}return out;
}
function sessionToken(req){return String(parseCookies(req.headers?.cookie||'')[COOKIE]||'');}
function setSessionCookie(res,token,expiresAt){
  const maxAge=Math.max(60,Math.floor((Number(expiresAt)-Date.now())/1000));
  res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict; Priority=High`);
}
function clearSessionCookie(res){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Priority=High`);}
function sameOriginMutation(req){
  const site=String(req.headers?.['sec-fetch-site']||'').toLowerCase();if(site==='cross-site')return false;
  const origin=String(req.headers?.origin||'');if(!origin)return true;
  try{const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'').split(',')[0].trim();return new URL(origin).host===host;}catch{return false;}
}
function noStore(res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');}
module.exports={sessionToken,setSessionCookie,clearSessionCookie,sameOriginMutation,noStore};
