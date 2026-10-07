import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const expect=(value,message)=>{if(!value)throw new Error(message);};

const oauth=read('plugin-server/oauth.mjs');
const portal=read('plugin-server/account-portal.mjs');
const login=read('plugin-server/account-portal/login.html');
const register=read('plugin-server/account-portal/register.html');
const verify=read('plugin-server/account-portal/verify-email.html');

expect(oauth.includes('Continue with Google')&&oauth.includes('Create a free account'),'oauth_plugin_auth_ctas_missing');
expect(oauth.includes("app.get('/oauth/resume'")&&oauth.includes("usedResume.set(resume.jti,resume.exp)"),'oauth_resume_route_or_one_time_guard_missing');
expect(oauth.includes("token_use:type")&&oauth.includes("'oauth-resume'"),'oauth_resume_signed_token_missing');
expect(oauth.includes("'/v1/accounts/me'")&&oauth.includes("'x-light-account-session'"),'oauth_resume_account_session_missing');
expect(oauth.includes("googleAuthStatus().configured"),'oauth_google_capability_gate_missing');
expect(portal.includes("sendRegistrationVerification(upstream,req.body?.next)")&&portal.includes("sendRegistrationVerification(challenge,req.body?.next)"),'registration_verification_return_path_missing');
expect(portal.includes("'&next='+encodeURIComponent(next)")&&portal.includes("google-signup-intent"),'google_signup_return_path_missing');
expect(portal.includes("safeReturnTo(req.query?.next)")&&portal.includes("req.body?.next"),'magic_login_return_path_missing');
expect(register.includes("nextPath")&&register.includes("googleRegister.href='/account/google?next='")&&register.includes("next:nextPath"),'register_oauth_return_path_missing');
expect(register.includes("'/account/verify-email?next='"),'register_verify_return_path_missing');
expect(login.includes("createAccountLink.href='/account/register?next='")&&login.includes("next:nextPath"),'login_oauth_return_path_missing');
expect(verify.includes("Continue to ChatGPT")&&verify.includes("nextPath.startsWith('/oauth/resume?')"),'verification_chatgpt_resume_missing');
expect(verify.includes("body:JSON.stringify({next:nextPath})"),'verification_resend_return_path_missing');

for(const [name,html] of [['login',login],['register',register],['verify',verify]]){
  const start=html.indexOf('<script>')+'<script>'.length,end=html.lastIndexOf('</script>');
  expect(start>=0&&end>start,name+'_inline_script_missing');
  new vm.Script(html.slice(start,end),{filename:name+'-inline.js'});
}

console.log('oauth-plugin-google-cta=PASS');
console.log('oauth-plugin-registration-cta=PASS');
console.log('oauth-signed-one-time-resume=PASS');
console.log('oauth-signup-google-magic-return-path=PASS');
console.log('oauth-onboarding-inline-js=PASS');
