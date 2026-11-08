import crypto from 'node:crypto';

/**
 * Synthetic UAT-only OAuth replay gate for horizontally scaled Node.js ESM APIs.
 * verifyJwt MUST validate actual JWT signature, iss/aud, JWT time claims and
 * token type, e.g. via the existing jose verifier. Never trust a raw decoded JWT.
 * This is not installed in live /oauth routes, nor does it authorize devices.
 */
const ORIGIN='https://rc50-mcp.thaiduy.digital';
const USAGES={
  authorization_code:{tokenUse:'code',maxSeconds:120,audience:ORIGIN+'/mcp'},
  refresh:{tokenUse:'refresh',maxSeconds:30*24*3600,audience:ORIGIN+'/mcp'},
  resume:{tokenUse:'oauth-resume',maxSeconds:24*3600,audience:ORIGIN+'/oauth/resume'},
};
const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=code=>{throw new Error(code)};
const validJti=x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(x);
const validClientId=x=>typeof x==='string'&&x.length>0&&x.length<=4096;
const pkce=x=>crypto.createHash('sha256').update(x).digest('base64url');

export class OAuthReplayGateUat {
  #ready=false;
  constructor({store,verifyJwt,now=()=>Date.now(),allowUat=false}={}){
    if(allowUat!==true)fail('oauth_replay_uat_only');
    if(typeof store?.verifyTarget!=='function'||typeof store?.consume!=='function')
      fail('trusted_oauth_replay_store_required');
    if(typeof verifyJwt!=='function')fail('trusted_signed_jwt_verifier_required');
    this.store=store;this.verifyJwt=verifyJwt;this.now=now;
  }
  async initialize(){
    this.#ready=false;
    const row=await this.store.verifyTarget();
    if(row?.database!=='light_remote_rc50_uat'||row?.role!=='lr_rc50_oauth_replay'
      ||row?.superuser!==false)fail('oauth_replay_unapproved_db_identity');
    this.#ready=true;
  }
  async consume({token,purpose,clientId,resource,redirectUri,codeVerifier}={}){
    if(!this.#ready)fail('oauth_replay_not_initialized');
    const options=USAGES[purpose];
    if(!options)fail('invalid_oauth_replay_purpose');
    if(typeof token!=='string'||token.length<16||token.length>20000)
      fail('invalid_oauth_replay_token');
    if(!validClientId(clientId))fail('invalid_oauth_replay_client');
    // Contract: verifyJwt accepts a REAL signed token and MUST reject
    // bad signature, expired token, wrong JWT issuer/audience or type.
    const claims=await this.verifyJwt(token,{
      issuer:ORIGIN,audience:options.audience,tokenUse:options.tokenUse
    });
    const now=Math.floor(this.now()/1000);
    if(claims?.iss!==ORIGIN||claims?.aud!==options.audience||
      claims?.token_use!==options.tokenUse||claims?.client_id!==clientId||
      !validJti(claims?.jti)||
      !Number.isSafeInteger(claims?.exp)||claims.exp<=now||
      claims.exp>now+options.maxSeconds+30)
      fail('oauth_verified_claim_mismatch');
    if(purpose==='resume'){
      if(claims.sub!=null||claims.response_type!=='code'||
        claims.code_challenge_method!=='S256'||claims.resource!==ORIGIN+'/mcp')
        fail('oauth_resume_claim_mismatch');
    }else{
      if(typeof claims.sub!=='string'||claims.sub.length<1||claims.sub.length>128||
        claims.resource!==ORIGIN+'/mcp')
        fail('oauth_token_binding_mismatch');
      if(purpose==='authorization_code'){
        if(typeof redirectUri!=='string'||redirectUri!==claims.redirect_uri||
          typeof codeVerifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)||
          typeof claims.code_challenge!=='string'||
          pkce(codeVerifier)!==claims.code_challenge)
          fail('oauth_pkce_or_redirect_mismatch');
      }
    }
    if(resource!==undefined&&resource!==ORIGIN+'/mcp')
      fail('oauth_resource_mismatch');
    // Never write the JWT or raw JTI to storage. Bind the issuer+purpose to
    // the JTI so independent instances derive the exact same irreversible key.
    const tokenSha256=sha256(['LightRemoteOAuthOneTime/v1',ORIGIN,purpose,claims.jti].join('\n')+'\n');
    const accepted=await this.store.consume({
      tokenSha256,purpose,accountId:purpose==='resume'?null:claims.sub,
      clientId,expiresEpoch:claims.exp
    });
    if(typeof accepted!=='boolean')fail('oauth_replay_invalid_store_result');
    return accepted;
  }
}

export class PgOAuthReplayStoreUat {
  #ready=false;
  constructor({pool,allowUat=false}={}){
    if(allowUat!==true)fail('oauth_pg_uat_only');
    if(typeof pool?.query!=='function')fail('oauth_pg_pool_required');
    this.pool=pool;
  }
  async verifyTarget(){
    this.#ready=false;
    const {rows}=await this.pool.query(
      "SELECT current_database() AS database,current_user AS role,"+
      "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser");
    const row=rows?.[0];
    if(row?.database!=='light_remote_rc50_uat'||row?.role!=='lr_rc50_oauth_replay'
      ||row?.superuser!==false)fail('oauth_replay_unapproved_db_identity');
    this.#ready=true;return row;
  }
  async consume({tokenSha256,purpose,accountId,clientId,expiresEpoch}={}){
    if(!this.#ready)fail('oauth_pg_not_initialized');
    if(typeof tokenSha256!=='string'||!/^[0-9a-f]{64}$/.test(tokenSha256)
      ||!USAGES[purpose]||!validClientId(clientId)
      ||(accountId!==null&&(typeof accountId!=='string'||accountId.length>128))
      ||!Number.isSafeInteger(expiresEpoch))
      fail('invalid_oauth_replay_db_arguments');
    const {rows}=await this.pool.query(
      'SELECT lr_consume_oauth_once_uat($1,$2,$3,$4,$5) AS consumed',
      [tokenSha256,purpose,accountId,clientId,expiresEpoch]);
    if(typeof rows?.[0]?.consumed!=='boolean')
      fail('oauth_replay_invalid_db_result');
    return rows[0].consumed;
  }
}
