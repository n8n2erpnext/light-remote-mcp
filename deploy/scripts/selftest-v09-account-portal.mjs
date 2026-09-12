import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('../..',import.meta.url).pathname);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const home=read('index.html'),login=read('login/index.html'),register=read('register/index.html');
const auth=read('api/auth.js'),web=read('lib/account-web.js'),css=read('assets/light-remote-portal.css');
function need(ok,name){if(!ok)throw new Error(`account_portal_contract_failed:${name}`);console.log(`${name}=PASS`);}
need(home.includes('Light Remote')&&home.includes('Devices')&&home.includes('Usage')&&home.includes('Settings'),'account-portal-shell');
need(home.includes('Add a device')&&home.includes('Revoke all')&&home.includes('Where you use it'),'account-portal-device-actions');
need(home.includes('ChatGPT')&&home.includes('Claude')&&home.includes('Any MCP client'),'account-portal-client-lanes');
need(login.includes('/api/auth?action=login')&&register.includes('/api/auth?action=register')&&register.includes('Owner proof code')&&register.includes('ownerCode'),'account-portal-auth-actions');
need(home.includes('/api/auth?action=devices')&&home.includes('/api/auth?action=enrollment-approve'),'account-portal-device-api');
need(!home.includes('/api/account-')&&!login.includes('/api/account-')&&!register.includes('/api/account-'),'account-portal-single-function-budget');
need(auth.includes("action==='register'")&&auth.includes('ownerCode')&&auth.includes('ownerPassword')&&auth.includes("action==='device-revoke'")&&auth.includes("action==='devices-revoke-all'"),'account-auth-router');
const gateway=read('gateway/server.mjs');need(gateway.includes('ownerCode')&&gateway.includes('owner_migration_proof_required')&&gateway.includes('wallAuth.verifyCredentials'),'account-owner-migration-proof');
need(web.includes('__Host-light_remote_account')&&web.includes('HttpOnly')&&web.includes('Secure')&&web.includes('SameSite=Strict'),'account-cookie-security');
need(css.includes('.sidebar')&&css.includes('.device-row')&&css.includes('.auth-card'),'account-portal-style');
console.log('ACCOUNT_PORTAL_GATE=PASS');

if(!register.includes('Owner proof code')||!register.includes('ownerCode'))throw new Error('account_owner_code_ui_missing');
if(!auth.includes('ownerCode:req.body?.ownerCode'))throw new Error('account_owner_code_forward_missing');
console.log('account-owner-proof-code-ui=PASS');
