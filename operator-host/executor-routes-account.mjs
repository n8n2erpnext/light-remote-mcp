import {verifyTeamMemberAuthorization} from './team-member-auth.mjs';
import {authorizeTrustedTeamDispatch} from './team-dispatch-authority.mjs';
export async function handleAccountRoutes(req,res,url,deps){
  const {ACCOUNT_ID,AccountError,DEVICE_ID,accountSessionToken,accounts,accountNotifications,allDeviceViews,capabilities,clearMainIfMatches,closeRuntimeForAccount,compatibilityFor,devices,enrollments,fleetAuthority,licenses,planEntitlements,proTeams,teamSessions,requestTeamMemberApproval,operationalAccount,accessGrants,connections,targetRoute,verifyTeamPrincipal,queueHelperUpdate,readJson,removeRuntimeForDevice,requireAccount,revokeRuntimeForDevice,sendJson,usage,wakeDeviceChannelForDevice}=deps;
    if (req.method === 'GET' && url.pathname === '/v1/admin/overview') {
      const accountRows=accounts.list(),deviceRows=allDeviceViews(),current=accountRows.map(account=>({account,entitlements:planEntitlements(account),usage:usage.summary(account.accountId,{months:1})}));
      const toolCallsThisMonth=current.reduce((sum,row)=>sum+(Number(row.usage.toolCallsThisMonth)||0),0),plans=current.reduce((out,row)=>{const key=String(row.account.plan||'free');out[key]=(out[key]||0)+1;return out;},{}),statuses=current.reduce((out,row)=>{const key=String(row.account.status||'active');out[key]=(out[key]||0)+1;return out;},{});
      return sendJson(res,200,{ok:true,overview:{accounts:accountRows.length,pendingRegistrations:accounts.listPendingRegistrations().length,groups:accounts.listGroups().length,devices:deviceRows.length,onlineDevices:deviceRows.filter(d=>d.state==='online').length,toolCallsThisMonth,plans,statuses}});
    }
    if (req.method === 'GET' && url.pathname === '/v1/admin/accounts') {
      const deviceRows=allDeviceViews();
      return sendJson(res,200,{ok:true,accounts:accounts.list().map(account=>({account,entitlements:planEntitlements(account),usage:usage.summary(account.accountId,{months:1}),devices:deviceRows.filter(d=>d.accountId===account.accountId).map(d=>({deviceId:d.deviceId,displayName:d.displayName,state:d.state,platform:d.platform,architecture:d.architecture}))}))});
    }
    if (req.method === 'GET' && url.pathname === '/v1/admin/pending-registrations') {
      return sendJson(res,200,{ok:true,pending:accounts.listPendingRegistrations()});
    }
    const adminPendingCancel=url.pathname.match(/^\/v1\/admin\/pending-registrations\/(preg_[A-Za-z0-9-]+)\/cancel$/);
    if(req.method==='POST'&&adminPendingCancel){
      const body=await readJson(req),pending=accounts.cancelPendingRegistration(adminPendingCancel[1],{reason:body.reason||'web_admin'});
      return sendJson(res,200,{ok:true,pending});
    }
    if (req.method === 'GET' && url.pathname === '/v1/admin/groups') {
      return sendJson(res,200,{ok:true,groups:accounts.listGroups()});
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/groups') {
      const body=await readJson(req),group=accounts.createGroup(body.name);return sendJson(res,201,{ok:true,group});
    }
    const adminGroupMatch=url.pathname.match(/^\/v1\/admin\/groups\/(grp_[A-Za-z0-9-]+)$/);
    if(req.method==='POST'&&adminGroupMatch){
      const body=await readJson(req),group=accounts.renameGroup(adminGroupMatch[1],body.name);return sendJson(res,200,{ok:true,group});
    }
    if(req.method==='DELETE'&&adminGroupMatch){
      const body=await readJson(req),result=accounts.deleteGroup(adminGroupMatch[1],{moveTo:body.moveTo||'grp_default'});return sendJson(res,200,{ok:true,result});
    }
    if (req.method === 'GET' && url.pathname === '/v1/admin/licenses') {
      return sendJson(res,200,{ok:true,licenses:licenses.list()});
    }
    if (req.method === 'GET' && url.pathname === '/v1/admin/upgrades') {
      return sendJson(res,200,{ok:true,upgrades:accounts.listUpgradeRequests().map(request=>({request,account:accounts.account(request.accountId)}))});
    }
    const adminUpgradeResolve=url.pathname.match(/^\/v1\/admin\/upgrades\/(upg_[A-Za-z0-9-]+)\/resolve$/);
    if(req.method==='POST'&&adminUpgradeResolve){
      const body=await readJson(req),durationMs=body.durationDays==null?null:Number(body.durationDays)*86400000;
      const out=accounts.resolveUpgradeRequest(adminUpgradeResolve[1],{decision:body.decision||'approve',durationMs,sourceRef:String(body.sourceRef||'web-admin')});
      return sendJson(res,200,{ok:true,...out,entitlements:planEntitlements(out.account)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/licenses/issue') {
      const body=await readJson(req),issued=licenses.issue(body);
      return sendJson(res,201,{ok:true,...issued});
    }
    const adminLicenseRevoke=url.pathname.match(/^\/v1\/admin\/licenses\/(lic_[A-Za-z0-9-]+)\/revoke$/);
    if (req.method === 'POST' && adminLicenseRevoke) {
      const body=await readJson(req),license=licenses.revoke(adminLicenseRevoke[1],body.reason||'admin_revoked');
      return sendJson(res,200,{ok:true,license});
    }
    if(req.method==='POST'&&url.pathname==='/v1/admin/dormancy/scan'){
      const deviceRows=allDeviceViews(),facts={};
      for(const account of accounts.list()){
        const owned=deviceRows.filter(d=>d.accountId===account.accountId&&d.state!=='revoked'),summary=usage.summary(account.accountId,{months:6});
        facts[account.accountId]={deviceCount:owned.length,lastToolCallAt:summary.lastToolCallAt||null,lastDeviceAddedAt:owned.reduce((m,d)=>Math.max(m,Number(d.firstSeenAt)||0),0)||account.lastDeviceAddedAt||null};
      }
      const result=accounts.evaluateDormancy(facts);
      for(const item of result.transitions||[]){closeRuntimeForAccount(item.account.accountId,'account_auto_dormant');fleetAuthority.invalidateAccount(item.account.accountId,'account_auto_dormant');}
      return sendJson(res,200,{ok:true,...result});
    }
    const adminDormancyAck=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/dormancy-notice\/(14d|3d)\/ack$/);
    if(req.method==='POST'&&adminDormancyAck){const account=accounts.acknowledgeDormancyNotice(adminDormancyAck[1],adminDormancyAck[2]);return sendJson(res,200,{ok:true,account});}
    const adminStatusMatch=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/status$/);
    if(req.method==='POST'&&adminStatusMatch){
      const body=await readJson(req),accountId=adminStatusMatch[1],account=accounts.setAdminStatus(accountId,{status:body.status,by:String(body.by||'web_admin'),reason:String(body.reason||'')});
      let closedDevices=[];if(account.status==='admin_disabled'){closedDevices=closeRuntimeForAccount(accountId,'account_admin_disabled');fleetAuthority.invalidateAccount(accountId,'account_admin_disabled');}
      return sendJson(res,200,{ok:true,account,closedDevices});
    }
    const adminAccountMatch=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)$/);
    if (req.method === 'GET' && adminAccountMatch) return sendJson(res,200,{ok:true,account:accounts.account(adminAccountMatch[1])});
    const adminPasswordReset=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/password-reset$/);
    if(req.method==='POST'&&adminPasswordReset){
      const body=await readJson(req),account=accounts.resetPassword(adminPasswordReset[1],body.password,{invalidateSessions:true});
      return sendJson(res,200,{ok:true,account});
    }
    const adminGroupAssign=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/group$/);
    if(req.method==='POST'&&adminGroupAssign){
      const body=await readJson(req),account=accounts.setAccountGroup(adminGroupAssign[1],body.groupId);return sendJson(res,200,{ok:true,account});
    }
    const adminEntitlementMatch=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/entitlement$/);
    if (req.method === 'POST' && adminEntitlementMatch) {
      const body=await readJson(req),durationMs=body.durationDays==null?null:Number(body.durationDays)*86400000,source=body.source==='paddle'?'paddle':'admin';
      const account=accounts.applyEntitlement(adminEntitlementMatch[1],{plan:body.plan,durationMs,source,sourceRef:String(body.sourceRef||'license-admin-cli'),allowDowngrade:source==='admin'||body.allowDowngrade===true}),entitlements=planEntitlements(account);
      if(!entitlements.fleetWall)fleetAuthority.invalidateAccount(account.accountId,'fleet_entitlement_removed');
      return sendJson(res,200,{ok:true,account,entitlements});
    }
    const adminMainMatch=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/main-device$/);
    if(req.method==='POST'&&adminMainMatch){
      const body=await readJson(req),accountId=adminMainMatch[1],device=devices.get(body.deviceId);
      if(device.accountId!==accountId)throw new AccountError('account_device_mismatch',403);
      if(device.state==='revoked')throw new AccountError('main_device_revoked',409);
      if(device.state!=='online')throw new AccountError('main_device_offline',409);
      const compatibility=compatibilityFor(device);if(!compatibility.supported)throw new AccountError(compatibility.status,409);
      const prior=accounts.account(accountId).mainDeviceId||null;if(prior&&prior!==device.deviceId)fleetAuthority.invalidateDevice(prior,'main_device_changed');
      fleetAuthority.invalidateDevice(device.deviceId,'main_device_changed');let account=accounts.setMainDevice(accountId,device.deviceId),entitlements=planEntitlements(account);
      account=accounts.setFleetProvisioning(accountId,{deviceId:device.deviceId,state:entitlements.fleetWall&&entitlements.multiDeviceConsole?'starting':'failed',reason:entitlements.fleetWall&&entitlements.multiDeviceConsole?'main_device_selected':'fleet_entitlement_required',port:5492});
      if(prior&&prior!==device.deviceId)wakeDeviceChannelForDevice(prior);wakeDeviceChannelForDevice(device.deviceId);
      return sendJson(res,200,{ok:true,account,entitlements,mainDevice:device});
    }
    const adminEntitlementRevoke=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/entitlement\/revoke$/);
    if (req.method === 'POST' && adminEntitlementRevoke) {
      const body=await readJson(req),accountId=adminEntitlementRevoke[1],source=body.source==='paddle'?'paddle_revoke':'admin_revoke';
      const account=accounts.applyEntitlement(accountId,{plan:'free',durationMs:null,source,sourceRef:String(body.reason||'license-admin-cli'),allowDowngrade:true});
      const closedDevices=closeRuntimeForAccount(accountId,'account_entitlement_revoked');
      fleetAuthority.invalidateAccount(accountId,'fleet_entitlement_revoked');
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account),closedDevices});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/owner-proof') {
      const body=await readJson(req);
      if(body.ownerProofVerified!==true) throw new AccountError('owner_migration_proof_required',403);
      const proof=accounts.issueOwnerProof({accountId:ACCOUNT_ID,deviceId:DEVICE_ID});
      return sendJson(res,200,{ok:true,proof});
    }
    if (req.method === 'POST' && url.pathname === '/v1/plugin/accounts/register') {
      const body=await readJson(req),pending=accounts.beginPendingRegistration({email:body.email,password:body.password,googleSignupToken:body.googleSignupToken||''});
      return sendJson(res,201,{ok:true,...pending});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/accounts/registration/status'){
      const body=await readJson(req),pending=accounts.pendingRegistration(body.pendingId);return sendJson(res,200,{ok:true,pending});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/accounts/registration/resend'){
      const body=await readJson(req),challenge=accounts.resendPendingVerification(body.pendingId);return sendJson(res,200,{ok:true,...challenge});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/accounts/registration/verify'){
      const body=await readJson(req),logged=accounts.verifyPendingRegistration({pendingId:body.pendingId||'',pin:body.pin||'',token:body.token||'',issueSession:body.issueSession!==false});return sendJson(res,200,{ok:true,...logged,entitlements:planEntitlements(logged.account)});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/auth/google-signup/inspect'){
      const body=await readJson(req),intent=accounts.googleSignupIntent(body.token);return sendJson(res,200,{ok:true,intent});
    }
    if (req.method === 'POST' && url.pathname === '/v1/plugin/auth/verify') {
      const body=await readJson(req),account=accounts.verifyCredentials({email:body.email,password:body.password},{recordLogin:false});
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account)});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/accounts/password-reset/request'){
      const body=await readJson(req),issued=accounts.issueOneTimeToken('password_reset',body.email,{ttlMs:30*60_000});
      return sendJson(res,200,{ok:true,...issued});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/accounts/magic/request'){
      const body=await readJson(req),issued=accounts.issueOneTimeToken('magic_login',body.email,{ttlMs:20*60_000});
      return sendJson(res,200,{ok:true,...issued});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/accounts/password-reset/consume'){
      const body=await readJson(req),password=String(body.password||'');if(password.length<10||password.length>1024)throw new AccountError('invalid_password');
      const account=accounts.consumeOneTimeToken('password_reset',body.token);accounts.resetPassword(account.accountId,password,{invalidateSessions:true});const logged=accounts.login({email:account.email,password});
      return sendJson(res,200,{ok:true,...logged,entitlements:planEntitlements(logged.account)});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/accounts/magic/consume'){
      const body=await readJson(req),logged=accounts.loginWithOneTimeToken(body.token);return sendJson(res,200,{ok:true,...logged,entitlements:planEntitlements(logged.account)});
    }
    if(req.method==='POST'&&url.pathname==='/v1/plugin/auth/google'){
      const body=await readJson(req),out=accounts.googleLoginOrSignupIntent({sub:body.sub,email:body.email,emailVerified:body.emailVerified===true});
      if(out.registrationRequired)return sendJson(res,200,{ok:true,...out});
      return sendJson(res,200,{ok:true,...out,entitlements:planEntitlements(out.account)});
    }
    const pluginAccountMatch=url.pathname.match(/^\/v1\/plugin\/accounts\/([A-Za-z0-9._:-]+)$/);
    if(req.method==='GET'&&pluginAccountMatch){
      const account=accounts.account(pluginAccountMatch[1]);
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account)});
    }
    const pluginDevicesMatch=url.pathname.match(/^\/v1\/plugin\/accounts\/([A-Za-z0-9._:-]+)\/devices$/);
    if(req.method==='GET'&&pluginDevicesMatch){
      const accountId=pluginDevicesMatch[1],account=accounts.assertOperational(accountId),owned=allDeviceViews().filter(device=>device.accountId===accountId);
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account),devices:owned});
    }
    const pluginMainMatch=url.pathname.match(/^\/v1\/plugin\/accounts\/([A-Za-z0-9._:-]+)\/main-device$/);
    if(req.method==='POST'&&pluginMainMatch){
      const body=await readJson(req),accountId=pluginMainMatch[1];accounts.assertOperational(accountId);const device=devices.get(body.deviceId);
      if(device.accountId!==accountId)throw new AccountError('account_device_mismatch',403);
      if(device.state==='revoked')throw new AccountError('main_device_revoked',409);
      if(device.state!=='online')throw new AccountError('main_device_offline',409);
      const compatibility=compatibilityFor(device);if(!compatibility.supported)throw new AccountError(compatibility.status,409);
      const prior=accounts.account(accountId).mainDeviceId||null;if(prior&&prior!==device.deviceId)fleetAuthority.invalidateDevice(prior,'main_device_changed');
      fleetAuthority.invalidateDevice(device.deviceId,'main_device_changed');
      let account=accounts.setMainDevice(accountId,device.deviceId),entitlements=planEntitlements(account);
      account=accounts.setFleetProvisioning(accountId,{deviceId:device.deviceId,state:entitlements.fleetWall&&entitlements.multiDeviceConsole?'starting':'failed',reason:entitlements.fleetWall&&entitlements.multiDeviceConsole?'main_device_selected':'fleet_entitlement_required',port:5492});
      if(prior&&prior!==device.deviceId)wakeDeviceChannelForDevice(prior);wakeDeviceChannelForDevice(device.deviceId);
      return sendJson(res,200,{ok:true,account,entitlements,mainDevice:device});
    }
    const pluginDeviceAction=url.pathname.match(/^\/v1\/plugin\/accounts\/([A-Za-z0-9._:-]+)\/devices\/([A-Za-z0-9._:-]+)\/(revoke|remove)$/);
    if(req.method==='POST'&&pluginDeviceAction){
      const body=await readJson(req),accountId=pluginDeviceAction[1];accounts.assertOperational(accountId);const device=devices.get(pluginDeviceAction[2]),action=pluginDeviceAction[3];
      if(device.accountId!==accountId)throw new AccountError('account_device_mismatch',403);
      if(device.deviceId===DEVICE_ID)throw new AccountError(action==='remove'?'integrated_hub_device_not_removable':'integrated_hub_device_not_revocable',409);
      const reason=String(body.reason||('plugin_owner_'+action+'d')).slice(0,120);
      if(action==='revoke'){
        const binding=enrollments.revoke({deviceId:device.deviceId,accountId,reason}),revoked=devices.revoke(device.deviceId,reason);
        revokeRuntimeForDevice(device.deviceId,reason);
        const account=clearMainIfMatches(accountId,device.deviceId,'main_device_revoked')||accounts.account(accountId);
        return sendJson(res,200,{ok:true,binding,device:revoked,account,entitlements:planEntitlements(account)});
      }
      const account=clearMainIfMatches(accountId,device.deviceId,'main_device_removed')||accounts.account(accountId);
      removeRuntimeForDevice(device.deviceId,reason);
      let binding={deviceId:device.deviceId,removed:false};try{binding=enrollments.remove({deviceId:device.deviceId,accountId,reason});}catch(error){if(error.message!=='device_binding_not_found')throw error;}
      const removed=devices.remove(device.deviceId,reason);wakeDeviceChannelForDevice(device.deviceId);
      return sendJson(res,200,{ok:true,removed,binding,account,entitlements:planEntitlements(account)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/register') {
      const body=await readJson(req);
      if(body.ownerCode) accounts.consumeOwnerProof(body.ownerCode);
      else if(body.ownerProofVerified!==true) throw new AccountError('owner_migration_proof_required',403);
      const created=accounts.register({email:body.email,password:body.password});
      return sendJson(res,201,{ok:true,account:created.account,session:created.session,token:created.token});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/login') {
      const body=await readJson(req),logged=accounts.login(body);
      return sendJson(res,200,{ok:true,account:logged.account,session:logged.session,token:logged.token});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/password-verify') {
      const body=await readJson(req),account=accounts.verifyCredentials(body,{recordLogin:true,eventType:'account_wall_login'});
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account)});
    }
    if (req.method === 'GET' && url.pathname === '/v1/accounts/me') {
      const identity=requireAccount(req);
      return sendJson(res,200,{ok:true,...identity,entitlements:planEntitlements(identity.account)});
    }
    if(req.method==='POST'&&url.pathname==='/v1/accounts/reactivate'){
      const identity=requireAccount(req),account=accounts.reactivateDormant(identity.account.accountId,{source:'self'});
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/logout') {
      return sendJson(res,200,{ok:true,...accounts.logout(accountSessionToken(req))});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/password') {
      const identity=requireAccount(req),body=await readJson(req),currentPassword=String(body.currentPassword||''),newPassword=String(body.newPassword||'');
      accounts.verifyCredentials({email:identity.account.email,password:currentPassword},{recordLogin:false});
      accounts.resetPassword(identity.account.accountId,newPassword,{invalidateSessions:true});
      const logged=accounts.login({email:identity.account.email,password:newPassword});
      return sendJson(res,200,{ok:true,account:logged.account,session:logged.session,token:logged.token});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/password/setup') {
      const identity=requireAccount(req),providers=Array.isArray(identity.account.authProviders)?identity.account.authProviders:[];
      if(providers.includes('password'))throw new AccountError('account_password_already_enabled',409);
      if(!providers.includes('google'))throw new AccountError('account_password_setup_unavailable',409);
      const body=await readJson(req),newPassword=String(body.newPassword||'');
      accounts.resetPassword(identity.account.accountId,newPassword,{invalidateSessions:true});
      const logged=accounts.login({email:identity.account.email,password:newPassword});
      return sendJson(res,200,{ok:true,account:logged.account,session:logged.session,token:logged.token});
    }
    // Account notifications are resolved by authenticated identity; clients
    // cannot choose recipient, type, or broadcast audience.
    if(url.pathname==='/v1/accounts/notifications'&&req.method==='GET'){
      const accountId=requireAccount(req).account.accountId;
      return sendJson(res,200,{ok:true,...accountNotifications.inbox(accountId)});
    }
    if(url.pathname==='/v1/accounts/notifications/read'&&req.method==='POST'){
      const accountId=requireAccount(req).account.accountId,body=await readJson(req);
      return sendJson(res,200,accountNotifications.markRead(accountId,body.notificationId));
    }
    if(url.pathname==='/v1/admin/notifications/publish'&&req.method==='POST'){
      const body=await readJson(req);
      // This path is reachable only on the private Operator socket.
      if(body.targetAccountId)accounts.assertOperational(body.targetAccountId);
      const notification=accountNotifications.publish(body);
      return sendJson(res,201,{ok:true,notification});
    }
    // Pro Team management is authenticated by a REAL account session.
    // It only manages membership/device sharing; cross-account job routes remain
    // disabled until independent per-actor local A/B grants are implemented.
    if(url.pathname==='/v1/accounts/team/entitlement'&&req.method==='GET'){
      const ownerAccountId=requireAccount(req).account.accountId;
      return sendJson(res,200,{ok:true,teamEntitlement:proTeams.teamEntitlement(ownerAccountId)});
    }
    if(url.pathname==='/v1/accounts/team/inbox'&&req.method==='GET'){
      const accountId=requireAccount(req).account.accountId;
      return sendJson(res,200,{ok:true,...proTeams.inbox({memberAccountId:accountId})});
    }
    if(url.pathname==='/v1/accounts/team/inbox/read'&&req.method==='POST'){
      const accountId=requireAccount(req).account.accountId,body=await readJson(req);
      const result=proTeams.readInbox({memberAccountId:accountId,notificationId:body.notificationId});
      return sendJson(res,200,result);
    }
    if(url.pathname==='/v1/accounts/team/inbox/accept'&&req.method==='POST'){
      const accountId=requireAccount(req).account.accountId,body=await readJson(req);
      const team=proTeams.acceptInbox({memberAccountId:accountId,notificationId:body.notificationId});
      return sendJson(res,200,{ok:true,team,crossAccountExecutionEnabled:false});
    }
    // Team entitlements are administered only over the private Operator socket.
    // A normal PRO subscription cannot acquire Team via account self-service.
    const teamGrant=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/team-entitlement$/);
    if(teamGrant&&req.method==='POST'){
      const body=await readJson(req);
      const grant=proTeams.grantTeamAccess({ownerAccountId:teamGrant[1],validUntil:body.validUntil,
        monthlyMemberCallBudget:body.monthlyMemberCallBudget,source:body.source||'admin'});
      return sendJson(res,200,{ok:true,grant});
    }
    if(teamGrant&&req.method==='DELETE'){
      const revoked=proTeams.revokeTeamAccess(teamGrant[1]);
      return sendJson(res,200,{ok:true,revoked});
    }
    if(url.pathname==='/v1/accounts/team/memberships' && req.method==='GET'){
      const memberAccountId=requireAccount(req).account.accountId;
      return sendJson(res,200,{ok:true,memberships:proTeams.memberships(memberAccountId)});
    }
    if(url.pathname==='/v1/accounts/team' && req.method==='GET'){
      const ownerAccountId=requireAccount(req).account.accountId;
      return sendJson(res,200,{ok:true,team:proTeams.view(ownerAccountId),teamEntitlement:proTeams.teamEntitlement(ownerAccountId),crossAccountExecutionEnabled:false});
    }
    if(url.pathname==='/v1/accounts/team' && req.method==='POST'){
      const ownerAccountId=requireAccount(req).account.accountId;
      const team=proTeams.create({ownerAccountId});
      return sendJson(res,201,{ok:true,team,crossAccountExecutionEnabled:false});
    }
    if(url.pathname==='/v1/accounts/team/invite' && req.method==='POST'){
      const ownerAccountId=requireAccount(req).account.accountId;
      const body=await readJson(req);
      // Email invites are opaque, do not disclose whether the address is registered.
      // A recipient must authenticate and have verified the invited email to accept.
      if(body.memberEmail&&body.memberAccountId)throw new AccountError('invalid_team_invitee',400);
      const invite=body.memberEmail
        ?proTeams.inviteEmail({ownerAccountId,memberEmail:body.memberEmail})
        :proTeams.invite({ownerAccountId,
          memberAccountId:accounts.assertOperational(String(body.memberAccountId||'')).accountId});
      return sendJson(res,201,{ok:true,invite});
    }
    // Team A/B is separate from the owner's existing approval. This endpoint
    // is account-session authenticated; it only creates a pending Local Wall request.
    if(url.pathname==='/v1/accounts/team/access/request' && req.method==='POST'){
      // Account cookies cannot prove a ChatGPT OAuth client identity.
      requireAccount(req);
      throw new AccountError('team_approval_requires_oauth_plugin',409);
    }
    // Only the OAuth-authenticated MCP adapter calls these local Operator APIs.
    // No browser-supplied agent identity, no cross-account device execution.
    if(url.pathname==='/v1/plugin/team/access/request' && req.method==='POST'){
      const body=await readJson(req),
        proof=verifyTeamPrincipal(req,url,body);
      const actorAccountId=operationalAccount(proof.accountId).accountId;
      const approval=requestTeamMemberApproval({
        actorAccountId,deviceId:body.deviceId,agentId:proof.agentId,label:body.label,
        devices,connections,accessGrants,teamRegistry:proTeams,
        planFor:id=>operationalAccount(id).plan
      });
      return sendJson(res,201,{ok:true,approval});
    }
    if(url.pathname==='/v1/plugin/team/access/poll' && req.method==='POST'){
      const body=await readJson(req),
        proof=verifyTeamPrincipal(req,url,body);
      const actorAccountId=operationalAccount(proof.accountId).accountId;
      const agentId=proof.agentId,request=accessGrants.requestInfo(body.requestId);
      if(request.purpose!=='team-member'||request.accountId!==actorAccountId||request.agentId!==agentId)
        throw new AccountError('team_oauth_agent_mismatch',403);
      const device=devices.get(request.deviceId),connection=connections.assertConnected(request.deviceId);
      if(connection.connectionId!==request.connectionId)
        throw new AccountError('team_device_connection_changed',409);
      if(device.accountId===actorAccountId||
         !proTeams.authorize({deviceOwnerAccountId:device.accountId,actorAccountId,deviceId:device.deviceId})||
         !['pro','vip'].includes(String(operationalAccount(device.accountId).plan||'').toLowerCase()))
        throw new AccountError('pro_team_membership_required',403);
      const polled=accessGrants.poll({requestId:body.requestId,pollToken:body.pollToken});
      if(polled.state!=='approved')
        return sendJson(res,200,{ok:true,approval:{state:'pending',deviceId:device.deviceId,
          expiresAt:request.expiresAt,crossAccountExecutionEnabled:false}});
      verifyTeamMemberAuthorization({
        device,connection,actorAccountId,agentId,accessGrantId:polled.grant.grantId,
        accessGrants,teamRegistry:proTeams,planFor:id=>operationalAccount(id).plan
      });
      return sendJson(res,200,{ok:true,approval:{state:'approved',deviceId:device.deviceId,
        accessExpiresAt:Math.min(polled.grant.expiresAt,polled.grant.absoluteExpiresAt),
        crossAccountExecutionEnabled:false}});
    }
    // OFF by default. Local Operator UAT-only decision preview: NO session,
    // no Fleet enqueue, no metering, no command and no grant ID in response.
    if(url.pathname==='/v1/plugin/team/dispatch/preflight' && req.method==='POST'){
      if(process.env.LIGHT_REMOTE_PRO_TEAM_DISPATCH_UAT!=='1')
        throw new AccountError('team_dispatch_preflight_not_enabled',404);
      const body=await readJson(req),
        proof=verifyTeamPrincipal(req,url,body);
      if(!Array.isArray(body.requiredCapabilities)||!body.requiredCapabilities.length)
        throw new AccountError('team_dispatch_capabilities_required',400);
      const actorAccountId=operationalAccount(proof.accountId).accountId,
        agentId=proof.agentId,
        device=devices.get(String(body.deviceId||'')),
        connection=connections.assertConnected(device.deviceId);
      // All actual owner/device routing facts come from authoritative
      // registry lookups, NOT member-supplied owner or billing identifiers.
      const ownerRoute=targetRoute(device.nodeId,{accountId:device.accountId});
      const enrollment=enrollments.binding(device.deviceId);
      const decision=authorizeTrustedTeamDispatch({
        authenticatedActorAccountId:actorAccountId,authenticatedAgentId:agentId,
        device,connection,accessGrants,teamRegistry:proTeams,
        planFor:id=>operationalAccount(id).plan,
        approvedCapabilities:enrollment.approvedCapabilities,
        routeCapabilities:ownerRoute.capabilities,operation:body.operation,
        requiredCapabilities:body.requiredCapabilities
      });
      return sendJson(res,200,{ok:true,preflight:{
        actorAccountId:decision.actorAccountId,
        deviceOwnerAccountId:decision.deviceOwnerAccountId,
        billedAccountId:decision.billedAccountId,
        deviceId:decision.deviceId,
        operation:decision.operation,
        maxWorkers:decision.maxWorkers,
        expiresAt:decision.accessExpiresAt,
        previewOnly:true,crossAccountExecutionEnabled:false
      }});
    }
    // Internal Operator UAT route only; not registered as an MCP tool, not
    // connected to the real session/job plane, and absent when the UAT flag
    // is disabled. Caller identity MUST be derived by a trusted OAuth
    // adapter before this is exposed beyond local test transport.
    if(req.method==='POST'&&url.pathname==='/v1/plugin/team/sessions/uat/open'){
      if(!teamSessions)throw new AccountError('team_session_uat_disabled',404);
      const body=await readJson(req),proof=verifyTeamPrincipal(req,url,body);
      const session=teamSessions.open({
        authenticatedActorAccountId:operationalAccount(proof.accountId).accountId,
        authenticatedAgentId:proof.agentId,
        deviceId:String(body.deviceId||''),
        operation:String(body.operation||''),
        requiredCapabilities:body.requiredCapabilities,
        openId:body.openId,label:body.label,
        workspace:body.workspace,gracePreset:body.gracePreset
      });
      return sendJson(res,200,{ok:true,session,previewOnly:true,
        crossAccountExecutionEnabled:false});
    }
    const teamUatSessionMatch=url.pathname.match(
      /^\/v1\/plugin\/team\/sessions\/uat\/([A-Za-z0-9._:-]+)\/(get|resume|hold|touch|close)$/
    );
    if(req.method==='POST'&&teamUatSessionMatch){
      if(!teamSessions)throw new AccountError('team_session_uat_disabled',404);
      const body=await readJson(req),
        proof=verifyTeamPrincipal(req,url,body),
        sessionId=teamUatSessionMatch[1],action=teamUatSessionMatch[2],
        identity={
          authenticatedActorAccountId:operationalAccount(proof.accountId).accountId,
          authenticatedAgentId:proof.agentId
        };
      const session=action==='get'?teamSessions.get(sessionId,identity)
        :action==='resume'?teamSessions.resume(sessionId,identity)
        :action==='hold'?teamSessions.hold(sessionId,identity,body.reason||'agent_inactive')
        :action==='touch'?teamSessions.touch(sessionId,identity,body.action||'uat-preview')
        :teamSessions.close(sessionId,identity);
      return sendJson(res,200,{ok:true,session,previewOnly:true,
        crossAccountExecutionEnabled:false});
    }
    if(url.pathname==='/v1/accounts/team/accept' && req.method==='POST'){
      const memberAccountId=requireAccount(req).account.accountId;
      const body=await readJson(req);
      const team=proTeams.accept({memberAccountId,inviteCode:body.inviteCode});
      return sendJson(res,200,{ok:true,team});
    }
    if(url.pathname==='/v1/accounts/team/member/remove' && req.method==='POST'){
      const ownerAccountId=requireAccount(req).account.accountId;
      const body=await readJson(req);
      const team=proTeams.remove({ownerAccountId,memberAccountId:body.memberAccountId});
      return sendJson(res,200,{ok:true,team});
    }
    if(url.pathname==='/v1/accounts/team/device/share' && req.method==='POST'){
      const ownerAccountId=requireAccount(req).account.accountId;
      const body=await readJson(req);
      const device=devices.get(String(body.deviceId||''));
      if(device.accountId!==ownerAccountId)throw new AccountError('team_device_not_owned',403);
      if(device.state==='revoked')throw new AccountError('team_device_revoked',409);
      const team=proTeams.shareDevice({ownerAccountId,deviceId:device.deviceId,deviceOwnerAccountId:device.accountId});
      return sendJson(res,200,{ok:true,team,crossAccountExecutionEnabled:false});
    }
    if(url.pathname==='/v1/accounts/team/device/unshare' && req.method==='POST'){
      const ownerAccountId=requireAccount(req).account.accountId;
      const body=await readJson(req);
      const team=proTeams.unshareDevice({ownerAccountId,deviceId:body.deviceId});
      return sendJson(res,200,{ok:true,team});
    }
    if (req.method === 'GET' && url.pathname === '/v1/accounts/devices') {
      const identity=requireAccount(req),owned=allDeviceViews().filter(device=>device.accountId===identity.account.accountId).map(device=>({...device,removable:device.deviceId!==DEVICE_ID,revocable:device.deviceId!==DEVICE_ID&&device.state!=='revoked',helperUpdatable:device.deviceId!==DEVICE_ID&&device.state!=='revoked'}));
      return sendJson(res,200,{ok:true,account:identity.account,entitlements:planEntitlements(identity.account),devices:owned});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/main-device') {
      const identity=requireAccount(req),body=await readJson(req),device=devices.get(body.deviceId);
      if(device.accountId!==identity.account.accountId)throw new AccountError('account_device_mismatch',403);
      if(device.state==='revoked')throw new AccountError('main_device_revoked',409);
      if(device.state!=='online')throw new AccountError('main_device_offline',409);
      const compatibility=compatibilityFor(device);if(!compatibility.supported)throw new AccountError(compatibility.status,409);
      const priorMain=identity.account.mainDeviceId||null;if(priorMain&&priorMain!==device.deviceId)fleetAuthority.invalidateDevice(priorMain,'main_device_changed');
      fleetAuthority.invalidateDevice(device.deviceId,'main_device_changed');
      let account=accounts.setMainDevice(identity.account.accountId,device.deviceId),entitlements=planEntitlements(account);
      account=accounts.setFleetProvisioning(account.accountId,{deviceId:device.deviceId,state:entitlements.fleetWall&&entitlements.multiDeviceConsole?'starting':'failed',reason:entitlements.fleetWall&&entitlements.multiDeviceConsole?'main_device_selected':'fleet_entitlement_required',port:5492});
      if(priorMain&&priorMain!==device.deviceId)wakeDeviceChannelForDevice(priorMain);wakeDeviceChannelForDevice(device.deviceId);
      return sendJson(res,200,{ok:true,account,entitlements,mainDevice:device});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/main-device/clear') {
      const identity=requireAccount(req),priorMain=identity.account.mainDeviceId||null;fleetAuthority.invalidateAccount(identity.account.accountId,'main_device_cleared');
      const account=accounts.clearMainDevice(identity.account.accountId,{reason:'account_owner_cleared'});if(priorMain)wakeDeviceChannelForDevice(priorMain);
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account)});
    }
    if (req.method === 'GET' && url.pathname === '/v1/accounts/usage') {
      const identity=requireAccount(req,{touch:false}),months=Math.max(1,Math.min(Number(url.searchParams.get('months'))||6,24));
      return sendJson(res,200,{ok:true,account:identity.account,entitlements:planEntitlements(identity.account),usage:usage.summary(identity.account.accountId,{months})});
    }
    if(req.method==='GET'&&url.pathname==='/v1/accounts/upgrade-request'){
      const identity=requireAccount(req,{touch:false});return sendJson(res,200,{ok:true,requests:accounts.listUpgradeRequests({accountId:identity.account.accountId}),account:identity.account,entitlements:planEntitlements(identity.account)});
    }
    if(req.method==='POST'&&url.pathname==='/v1/accounts/upgrade-request'){
      const identity=requireAccount(req),body=await readJson(req),request=accounts.requestUpgrade(identity.account.accountId,body.plan||'pro'),account=accounts.account(identity.account.accountId);
      return sendJson(res,201,{ok:true,request,account,entitlements:planEntitlements(account)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/redeem-license') {
      const identity=requireAccount(req),body=await readJson(req),candidate=licenses.inspect(body.key);
      const account=accounts.applyEntitlement(identity.account.accountId,{plan:candidate.plan,durationMs:candidate.durationMs,source:'redeem_key',sourceRef:candidate.licenseId});
      const consumed=licenses.consume(candidate.licenseId,identity.account.accountId);
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account),license:consumed.license});
    }
    if(req.method==='POST'&&url.pathname==='/v1/accounts/enrollments/approve'){
      const identity=requireAccount(req);accounts.assertOperational(identity.account.accountId);const body=await readJson(req),approval=enrollments.approve({...body,accountId:identity.account.accountId});
      const binding=enrollments.binding(approval.deviceId),device=devices.enroll({accountId:binding.accountId,deviceId:binding.deviceId,nodeId:binding.deviceId,displayName:binding.displayName,platform:binding.platform,architecture:binding.architecture,agentVersion:binding.agentVersion,publicIdentityKey:binding.publicIdentityKey,capabilities:binding.approvedCapabilities,policyProfile:binding.policyProfile});
      accounts.recordDeviceAdded(identity.account.accountId,device.firstSeenAt||Date.now());
      return sendJson(res,200,{ok:true,approval,device});
    }
    const accountUpdateMatch=url.pathname.match(/^\/v1\/accounts\/devices\/([A-Za-z0-9._:-]+)\/update$/);
    if(req.method==='POST'&&accountUpdateMatch){
      const identity=requireAccount(req),body=await readJson(req),device=devices.get(accountUpdateMatch[1]);
      if(device.accountId!==identity.account.accountId)throw new AccountError('account_device_mismatch',403);
      if(device.deviceId===DEVICE_ID)throw new AccountError('helper_update_hub_not_client',409);
      if(device.state==='revoked')throw new AccountError('device_revoked',409);
      if(device.state!=='online')throw new AccountError('client_update_offline',409);
      if(body.force!==true)throw new AccountError('force_update_confirmation_required',428);
      const compatibility=compatibilityFor(device),maintenance=queueHelperUpdate(device.deviceId,{source:'account-portal'});
      return sendJson(res,200,{ok:true,forced:true,compatibility,maintenance});
    }
    const accountRevokeMatch=url.pathname.match(/^\/v1\/accounts\/devices\/([A-Za-z0-9._:-]+)\/revoke$/);
    if(req.method==='POST'&&accountRevokeMatch){
      const identity=requireAccount(req),device=devices.get(accountRevokeMatch[1]);
      if(device.accountId!==identity.account.accountId)throw new AccountError('account_device_mismatch',403);
      if(device.deviceId===DEVICE_ID)throw new AccountError('integrated_hub_device_not_revocable',409);
      const binding=enrollments.revoke({deviceId:device.deviceId,accountId:identity.account.accountId,reason:'account_owner_revoked'}),revoked=devices.revoke(device.deviceId,'account_owner_revoked');
      revokeRuntimeForDevice(device.deviceId,'account_owner_revoked');
      const account=clearMainIfMatches(identity.account.accountId,device.deviceId,'main_device_revoked')||accounts.account(identity.account.accountId);
      return sendJson(res,200,{ok:true,binding,device:revoked,account,entitlements:planEntitlements(account)});
    }
    const accountRemoveMatch=url.pathname.match(/^\/v1\/accounts\/devices\/([A-Za-z0-9._:-]+)\/remove$/);
    if(req.method==='POST'&&accountRemoveMatch){
      const identity=requireAccount(req),device=devices.get(accountRemoveMatch[1]);
      if(device.accountId!==identity.account.accountId)throw new AccountError('account_device_mismatch',403);
      if(device.deviceId===DEVICE_ID)throw new AccountError('integrated_hub_device_not_removable',409);
      const account=clearMainIfMatches(identity.account.accountId,device.deviceId,'main_device_removed')||accounts.account(identity.account.accountId);
      removeRuntimeForDevice(device.deviceId,'account_owner_removed');
      let binding={deviceId:device.deviceId,removed:false};try{binding=enrollments.remove({deviceId:device.deviceId,accountId:identity.account.accountId,reason:'account_owner_removed'});}catch(error){if(error.message!=='device_binding_not_found')throw error;}
      const removed=devices.remove(device.deviceId,'account_owner_removed');wakeDeviceChannelForDevice(device.deviceId);
      return sendJson(res,200,{ok:true,removed,binding,account,entitlements:planEntitlements(account)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/devices/revoke-all') {
      const identity=requireAccount(req),rows=devices.list().filter(device=>device.accountId===identity.account.accountId&&device.state!=='revoked'&&device.deviceId!==DEVICE_ID),revoked=[];
      for(const device of rows){
        try{enrollments.revoke({deviceId:device.deviceId,accountId:identity.account.accountId,reason:'account_owner_revoke_all'});}catch{}
        try{revoked.push(devices.revoke(device.deviceId,'account_owner_revoke_all'));}catch{}
        revokeRuntimeForDevice(device.deviceId,'account_owner_revoke_all');
      }
      const account=accounts.clearMainDevice(identity.account.accountId,{reason:'account_owner_revoke_all'});
      return sendJson(res,200,{ok:true,revoked,preserved:[DEVICE_ID],account,entitlements:planEntitlements(account)});
    }

}
