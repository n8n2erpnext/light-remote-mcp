/**
 * T04b9c3a — two-sided, browser-safe Desktop -> Local Wall SSO handoff.
 *
 * Browser sees ONLY a public challenge (not an Owner ticket, signed proof,
 * refresh token, account identity, or capability). Its separate opaque,
 * HttpOnly SameSite=Strict bootstrap cookie is needed to finish.
 *
 * The TRUSTED Device Agent only calls approveTrustedNative() after it has
 * obtained the native one-use ticket over a private, user-initiated channel.
 * This function is intentionally NOT an HTTP endpoint or a React IPC.
 * It calls the already signed Agent redemption and stores only a temporary
 * Wall-local session cookie, not a bearer token to send to the browser JS.
 *
 * The browser's finish request receives the Wall cookie through Set-Cookie,
 * after the server independently rechecks live Owner-family authorization.
 * This cannot bypass the Local Wall's Owner auth, Agent A/B, or B approval.
 */
import crypto from 'node:crypto';

export const WALL_SSO_BOOTSTRAP_COOKIE_V4='lr_wall_sso_bootstrap_v4';
export const WALL_SSO_BOOTSTRAP_MAX_AGE_MS_V4=60_000;
const TTL=WALL_SSO_BOOTSTRAP_MAX_AGE_MS_V4;
const CHALLENGE=/^[A-Za-z0-9_-]{43}$/;
const TICKET=/^[A-Za-z0-9_-]{43}$/;
const COOKIE=/^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;
const COOKIE_PATH='/auth/desktop/sso/browser';
const deny=()=>Object.assign(new Error('desktop_wall_sso_bootstrap_denied'),{
  code:'desktop_wall_sso_bootstrap_denied'
});
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>{
  const left=Buffer.from(String(a)),right=Buffer.from(String(b));
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
};
function browserCookie(req){
  const h=String(req?.headers?.cookie||'');
  for(const item of h.split(';')){
    const [name,value]=item.trim().split('=',2);
    if(name===WALL_SSO_BOOTSTRAP_COOKIE_V4)return value||'';
  }
  return '';
}
function cookie(name,value,age,secure){
  return name+'='+value+'; Path='+COOKIE_PATH+'; Max-Age='+age+
    '; HttpOnly; '+(secure?'Secure; ':'')+
    'SameSite=Strict; Priority=High';
}
export function createDesktopWallSsoBrowserBootstrapV4({
  wallSession,clock=Date.now,random=crypto.randomBytes
}={}){
  if(typeof wallSession?.redeem!=='function'||
     typeof wallSession?.identity!=='function'||
     typeof clock!=='function'||typeof random!=='function')
    throw deny();
  const key=random(32);
  if(!Buffer.isBuffer(key)||key.length!==32)throw deny();
  const handoffs=new Map();
  const MAX_HANDOFFS=32;
  const mac=n=>crypto.createHmac('sha256',key)
    .update('wall-sso-browser-v4:'+n).digest('base64url');
  const prune=()=>{
    const now=clock();
    for(const [id,row] of handoffs)if(row.expiresAt<=now)handoffs.delete(id);
    while(handoffs.size>MAX_HANDOFFS)handoffs.delete(handoffs.keys().next().value);
  };
  function parseBrowser(req){
    const value=browserCookie(req);
    if(!COOKIE.test(value))return null;
    const [,nonce,sig]=value.split('.');
    if(!equal(sig,mac(nonce)))return null;
    return sha(value);
  }
  function begin({secure=false}={}){
    prune();
    const nonce=random(32);
    if(!Buffer.isBuffer(nonce)||nonce.length!==32)throw deny();
    const value='v1.'+nonce.toString('base64url')+'.'+
      mac(nonce.toString('base64url'));
    const challenge=crypto.createHash('sha256')
      .update('wall-sso-challenge-v4:'+value).digest('base64url');
    const expiresAt=clock()+TTL;
    if(!Number.isSafeInteger(expiresAt))throw deny();
    const keyHash=sha(value);
    while(handoffs.size>=MAX_HANDOFFS)handoffs.delete(handoffs.keys().next().value);
    handoffs.set(keyHash,{challenge,expiresAt,state:'pending',sessionCookie:null});
    return Object.freeze({
      challenge,expiresAt,
      setCookie:cookie(WALL_SSO_BOOTSTRAP_COOKIE_V4,value,60,secure===true)
    });
  }
  // Read-only local Owner candidate lookup through OS-private Agent IPC.
  // Never return the browser cookie or Wall session. Ambiguous requests
  // fail closed: the Owner must not approve the wrong browser tab.
  function pendingForNative(){
    prune();
    const waiting=[...handoffs.values()].filter(row=>row.state==='pending');
    if(waiting.length!==1)return null;
    const row=waiting[0];
    return Object.freeze({challenge:row.challenge,expiresAt:row.expiresAt});
  }
  // A public challenge alone is NOT enough to acquire a browser session:
  // approval must come from native Owner+enrolled Agent AND finish requires
  // the separate HttpOnly browser cookie minted in begin().
  async function approveTrustedNative({challenge,ticket,secure=false}={}){
    if(typeof challenge!=='string'||!CHALLENGE.test(challenge)||
       typeof ticket!=='string'||!TICKET.test(ticket))throw deny();
    prune();
    const entry=[...handoffs.entries()].find(
      ([,row])=>row.challenge===challenge&&row.state==='pending'
    );
    if(!entry)throw deny();
    const [keyHash,row]=entry;
    // Lock before awaiting remote signed Operator redemption; a concurrent
    // native attempt cannot consume the same one-time ticket twice.
    row.state='redeeming';
    try{
      const session=await wallSession.redeem(ticket,{secure:secure===true});
      if(handoffs.get(keyHash)!==row||row.expiresAt<=clock())
        throw deny();
      if(typeof session?.cookie!=='string'||
         !session.cookie.startsWith('lr_wall_desktop_sso_v4=v1.'))
        throw deny();
      row.sessionCookie=session.cookie;
      row.state='ready';
      return Object.freeze({ready:true});
    }catch{
      handoffs.delete(keyHash);
      throw deny();
    }
  }
  async function finish(req){
    prune();
    const keyHash=parseBrowser(req),row=keyHash&&handoffs.get(keyHash);
    if(!row||row.state!=='ready'||row.expiresAt<=clock()||
       typeof row.sessionCookie!=='string')throw deny();
    // Mark as consumed before async Owner-family verification to prevent
    // parallel browser responses from receiving a second cookie.
    handoffs.delete(keyHash);
    const ssoCookie=row.sessionCookie;
    const boundIdentity=await wallSession.identity({
      headers:{cookie:ssoCookie.split(';',1)[0]}
    });
    if(!boundIdentity?.desktopOwnerSso)throw deny();
    return Object.freeze({
      setCookie:ssoCookie,
      clearBootstrapCookie:cookie(WALL_SSO_BOOTSTRAP_COOKIE_V4,'',0,
        ssoCookie.includes('; Secure;')),
      expiresAt:boundIdentity.expiresAt
    });
  }
  return Object.freeze({begin,pendingForNative,approveTrustedNative,finish,
    clearBootstrapCookie:secure=>cookie(
      WALL_SSO_BOOTSTRAP_COOKIE_V4,'',0,secure===true
    )});
}
