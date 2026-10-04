import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const account=read('plugin-server/account-portal.mjs');
const home=read('plugin-server/account-portal/index.html');
const login=read('plugin-server/account-portal/login.html');
const register=read('plugin-server/account-portal/register.html');
const reset=read('plugin-server/account-portal/reset.html');
const billing=read('plugin-server/account-portal/billing.html');
const settings=read('plugin-server/account-portal/settings.html');
const admin=read('plugin-server/admin-portal/index.html');
const publicHome=read('plugin-server/public-home.html');
const operator=read('operator-host/executor-routes-account.mjs');
const registry=read('operator-host/account-registry.mjs');
const css=read('plugin-server/account-portal/portal.css');

function need(ok,name){if(!ok)throw new Error(`account_portal_contract_failed:${name}`);console.log(`${name}=PASS`);}

need(home.includes('Your devices')&&home.includes('Add a device')&&home.includes('Official Plugin'),'account-portal-shell');
need(home.includes('Link device')&&home.includes('Re-enroll device')&&home.includes('main-device'),'account-device-lifecycle');
need(register.includes('Create free account')&&!register.includes('Owner proof code')&&!register.includes('ownerCode'),'hosted-public-signup');
need(account.includes("'/v1/plugin/accounts/register'")&&operator.includes('/v1/plugin/accounts/register')&&operator.includes('registerHosted'),'hosted-signup-authority');
need(login.includes('Continue with Google')&&login.includes('one-time sign-in link')&&account.includes('finishGoogleAuth'),'account-modern-auth');
need(reset.includes('password-reset-request')&&reset.includes('password-reset-complete')&&operator.includes('password-reset/consume'),'password-reset-flow');
need(registry.includes('oneTimeTokens')&&registry.includes("password_reset")&&registry.includes("magic_login"),'one-time-token-registry');
need(billing.includes('10,000 tool calls per month')&&billing.includes('Request Pro upgrade')&&billing.includes('No license key required'),'free-and-direct-upgrade-ui');
need(operator.includes('/v1/accounts/upgrade-request')&&registry.includes('requestUpgrade')&&registry.includes('resolveUpgradeRequest'),'direct-upgrade-authority');
need(admin.includes('Upgrade requests')&&admin.includes('Recipient email')&&admin.includes('Verify SMTP'),'admin-commerce-mail');
need(settings.includes('Change password')&&settings.includes('Appearance'),'settings-password-theme');
need(publicHome.includes('Your AI.')&&publicHome.includes('Your machine.')&&publicHome.includes('Your approval.'),'public-home-hero');
need(publicHome.includes('10K')&&publicHome.includes('A/B')&&publicHome.includes('Direct'),'public-home-trust');
need(account.includes('__Host-light_remote_account')&&account.includes('HttpOnly')&&account.includes('Secure')&&account.includes('SameSite=Strict'),'account-cookie-security');
need(css.includes('.sidebar')&&css.includes('.auth-card')&&css.includes('.home-hero'),'account-public-style');
console.log('ACCOUNT_PORTAL_GATE=PASS');
