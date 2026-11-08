/**
 * T04b9c3c — browser-only, same-origin Owner-initiated Wall SSO challenge.
 * This page never receives Owner access/refresh, a ticket, Device identity,
 * signed proof or an A/B grant. The code displayed is an 8-character
 * non-bearer prefix of the public browser challenge. It does NOT authorize
 * a login without the separate HttpOnly browser cookie and private native
 * Owner verification.
 */
export const WALL_SSO_BROWSER_PAGE_V4='/auth/desktop/sso/browser';
export const WALL_SSO_BROWSER_SCRIPT_V4='/auth/desktop/sso/browser/app.js';
export const WALL_SSO_BROWSER_CSP_V4=
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; "+
  "connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";
export function desktopWallSsoBrowserPageV4(){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Light Remote · Desktop Wall sign-in</title>
<style>
:root{color-scheme:dark;font-family:system-ui,Arial,sans-serif;
 background:#080a0c;color:#dce3eb}body{margin:0;min-height:100vh;
 display:grid;place-items:center;padding:16px;box-sizing:border-box}
main{width:min(440px,100%);background:#0a0e12;border:1px solid #29333f;
 border-radius:14px;padding:24px;box-sizing:border-box}
.brand{font-size:13px;font-weight:700;letter-spacing:.12em;color:#8b9aae}
h1{font-size:24px;line-height:1.25;margin:16px 0}
p{color:#a9b6c5;font-size:14px;line-height:1.6}
button,a{font:inherit;border:1px solid #3c546c;border-radius:8px;
 padding:11px 15px;background:#132131;color:#eef3f9;cursor:pointer}
button{width:100%;margin-top:14px}button:disabled{opacity:.5;cursor:not-allowed}
a{display:inline-block;text-decoration:none;background:transparent;margin-top:16px}
#code{display:block;text-align:center;font:700 32px ui-monospace,monospace;
 letter-spacing:.18em;padding:16px 0;border:1px solid #344a63;
 border-radius:8px;user-select:all;overflow-wrap:anywhere}
#code[hidden],#pending[hidden]{display:none}
#message{min-height:24px}strong{color:#e6edf4}
</style><script defer src="/auth/desktop/sso/browser/app.js"></script>
</head><body><main>
<div class="brand">LIGHT REMOTE · LOCAL WALL</div>
<h1>Sign in with Desktop V4</h1>
<p>Start a request here, then enter the matching code in your already-signed-in Desktop V4 app and confirm. This does not approve any Agent A/B access.</p>
<button id="begin" type="button">Generate verification code</button>
<div id="pending" hidden>
  <p>Enter this code <strong>exactly as shown</strong> in Desktop V4:</p>
  <output id="code" aria-label="Wall sign-in verification code"></output>
  <p>Valid for 60 seconds. Keep this browser tab open until Desktop confirms.</p>
</div>
<p id="message" role="status" aria-live="polite">Waiting to start.</p>
<a href="/login">Sign in with password instead</a>
</main></body></html>`;
}
export const WALL_SSO_BROWSER_SCRIPT_SOURCE_V4=String.raw`(function(){
'use strict';
const button=document.getElementById('begin');
const container=document.getElementById('pending');
const code=document.getElementById('code');
const message=document.getElementById('message');
let expiresAt=0,started=false,active=false;
const POST={method:'POST',headers:{'content-type':'application/json'},
 body:'{}',credentials:'same-origin',cache:'no-store',redirect:'error'};
async function call(path){
  return fetch(path,POST);
}
async function poll(){
  if(!active)return;
  if(Date.now()>=expiresAt){
    active=false;button.disabled=false;
    message.textContent='Code expired. Start again to create a new request.';
    return;
  }
  try{
    const response=await call('/auth/desktop/sso/browser/finish');
    if(response.status===200){
      const value=await response.json();
      if(value&&value.ok===true){
        active=false;message.textContent='Owner verified. Opening Local Wall.';
        window.location.replace('/');
        return;
      }
    }else if(response.status!==403){
      active=false;button.disabled=false;
      message.textContent='Local Wall is unavailable. Try again.';
      return;
    }
  }catch{
    active=false;button.disabled=false;
    message.textContent='Could not contact Local Wall. Try again.';
    return;
  }
  window.setTimeout(poll,1500);
}
button.addEventListener('click',async()=>{
  if(started&&active)return;
  button.disabled=true;message.textContent='Creating a one-time request...';
  try{
    const response=await call('/auth/desktop/sso/browser/begin');
    if(response.status!==200)throw Error('no_response');
    const value=await response.json();
    if(value.ok!==true||
       typeof value.challenge!=='string'||
       !/^[A-Za-z0-9_-]{43}$/.test(value.challenge)||
       !Number.isSafeInteger(value.expiresAt))
      throw Error('bad_response');
    expiresAt=value.expiresAt;started=true;active=true;
    code.textContent=value.challenge.slice(0,8);
    container.hidden=false;
    message.textContent='Open Desktop V4 and approve this exact code.';
    window.setTimeout(poll,1200);
  }catch{
    active=false;button.disabled=false;
    message.textContent='Unable to create a request. Try again.';
  }
});
})();`;
