#!/usr/bin/env node
// UAT-only, LOOPBACK-only visual smoke instance. Synthetic notifications;
// deliberately cannot read account PostgreSQL or impersonate Agent sessions.
import {loadLocalWallAuth} from '../../device-agent/local-wall-auth.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const HOST='127.0.0.1',PORT=5593;
const auth=loadLocalWallAuth('/var/lib/light-remote-gold-uat/wall/auth.json',{required:true});
if(!auth.enabled)throw Error('uat_notification_canary_owner_auth_required');
const inbox='https://gold.light-remote.thaiduy.digital/account/inbox';
const sampleId='sys_11111111-2222-3333-4444-555555555555';
const wall=startLocalWall({
 host:HOST,port:PORT,auth,
 getLocalStatus:async()=>({deviceName:'Gold Notification Canary (Synthetic)',cloudState:'dormant',cloudDesiredConnected:false}),
 getAccountNotifications:async()=>({
  ok:true,accountInboxUrl:inbox,unreadCount:1,
  notifications:[{
   notificationId:sampleId,type:'feature',title:'UAT Preview — notification bell',
   body:'Synthetic preview only. No real customer notification or account data is loaded.',
   createdAt:Date.now(),readAt:null
  }]
 })
});
const done=()=>{wall.close().finally(()=>process.exit(0));};
process.once('SIGINT',done);process.once('SIGTERM',done);
console.log('GOLD_WALL_NOTIFICATION_CANARY_READY=LOOPBACK_ONLY SYNTHETIC=TRUE PORT='+PORT);
