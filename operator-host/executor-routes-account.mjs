export async function handleAccountRoutes(req,res,url,deps){
  const {ACCOUNT_ID,AccountError,DEVICE_ID,accountSessionToken,accounts,allDeviceViews,capabilities,clearMainIfMatches,closeRuntimeForAccount,compatibilityFor,devices,enrollments,fleetAuthority,licenses,planEntitlements,queueHelperUpdate,readJson,removeRuntimeForDevice,requireAccount,revokeRuntimeForDevice,sendJson,usage,wakeDeviceChannelForDevice}=deps;
    if (req.method === 'GET' && url.pathname === '/v1/admin/licenses') {
      return sendJson(res,200,{ok:true,licenses:licenses.list()});
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/accounts/provision') {
      const body=await readJson(req),account=accounts.provision(body);
      return sendJson(res,201,{ok:true,account});
    }
    if (req.method === 'POST' && url.pathname === '/v1/plugin/auth/verify') {
      const body=await readJson(req),account=accounts.verifyCredentials(body,{recordLogin:true,eventType:'plugin_oauth_login'});
      return sendJson(res,200,{ok:true,account});
    }
    const pluginRemoveMatch=url.pathname.match(/^\/v1\/plugin\/accounts\/([A-Za-z0-9._:-]+)\/devices\/([A-Za-z0-9._:-]+)\/remove$/);
    if(req.method==='POST'&&pluginRemoveMatch){
      const body=await readJson(req),accountId=pluginRemoveMatch[1],deviceId=pluginRemoveMatch[2],device=devices.get(deviceId);
      if(device.accountId!==accountId)throw new AccountError('account_device_mismatch',403);
      if(device.deviceId===DEVICE_ID)throw new AccountError('integrated_hub_device_not_removable',409);
      const account=clearMainIfMatches(accountId,device.deviceId,'main_device_removed')||accounts.account(accountId);
      removeRuntimeForDevice(device.deviceId,'plugin_owner_removed');
      let binding={deviceId:device.deviceId,removed:false};try{binding=enrollments.remove({deviceId:device.deviceId,accountId,reason:String(body.reason||'plugin_owner_removed').slice(0,120)});}catch(error){if(error.message!=='device_binding_not_found')throw error;}
      const removed=devices.remove(device.deviceId,'plugin_owner_removed');wakeDeviceChannelForDevice(device.deviceId);
      return sendJson(res,200,{ok:true,removed,binding,account,entitlements:planEntitlements(account)});
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
    const adminAccountMatch=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)$/);
    if (req.method === 'GET' && adminAccountMatch) return sendJson(res,200,{ok:true,account:accounts.account(adminAccountMatch[1])});
    const adminEntitlementMatch=url.pathname.match(/^\/v1\/admin\/accounts\/([A-Za-z0-9._:-]+)\/entitlement$/);
    if (req.method === 'POST' && adminEntitlementMatch) {
      const body=await readJson(req),durationMs=body.durationDays==null?null:Number(body.durationDays)*86400000;
      const account=accounts.applyEntitlement(adminEntitlementMatch[1],{plan:body.plan,durationMs,source:'admin',sourceRef:String(body.sourceRef||'license-admin-cli'),allowDowngrade:true}),entitlements=planEntitlements(account);
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
      const body=await readJson(req),accountId=adminEntitlementRevoke[1];
      const account=accounts.applyEntitlement(accountId,{plan:'free',durationMs:null,source:'admin_revoke',sourceRef:String(body.reason||'license-admin-cli'),allowDowngrade:true});
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
    if (req.method === 'GET' && url.pathname === '/v1/accounts/me') {
      const identity=requireAccount(req);
      return sendJson(res,200,{ok:true,...identity,entitlements:planEntitlements(identity.account)});
    }
    if (req.method === 'POST' && url.pathname === '/v1/accounts/logout') {
      return sendJson(res,200,{ok:true,...accounts.logout(accountSessionToken(req))});
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
    if (req.method === 'POST' && url.pathname === '/v1/accounts/redeem-license') {
      const identity=requireAccount(req),body=await readJson(req),candidate=licenses.inspect(body.key);
      const account=accounts.applyEntitlement(identity.account.accountId,{plan:candidate.plan,durationMs:candidate.durationMs,source:'redeem_key',sourceRef:candidate.licenseId});
      const consumed=licenses.consume(candidate.licenseId,identity.account.accountId);
      return sendJson(res,200,{ok:true,account,entitlements:planEntitlements(account),license:consumed.license});
    }
    if(req.method==='POST'&&url.pathname==='/v1/accounts/enrollments/approve'){
      const identity=requireAccount(req),body=await readJson(req),approval=enrollments.approve({...body,accountId:identity.account.accountId});
      const binding=enrollments.binding(approval.deviceId),device=devices.enroll({accountId:binding.accountId,deviceId:binding.deviceId,nodeId:binding.deviceId,displayName:binding.displayName,platform:binding.platform,architecture:binding.architecture,agentVersion:binding.agentVersion,publicIdentityKey:binding.publicIdentityKey,capabilities:binding.approvedCapabilities,policyProfile:binding.policyProfile});
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
