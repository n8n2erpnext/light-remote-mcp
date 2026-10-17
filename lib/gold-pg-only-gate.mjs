/**
 * Gold full cutover gate: diagnostic + necessary startup safety check.
 * No runtime shall be branded Gold PostgreSQL-only while even one mandatory
 * business-state domain still uses a JSON file, SQLite, or volatile Map as
 * its exclusive authoritative record.
 *
 * This is NOT a substitute for PostgreSQL integration tests, data restore,
 * cross-process correctness, client builds, or the full acceptance suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const domain=(role,name,file,legacy,modern)=>({role,name,file,legacy,modern});
export const GOLD_DOMAINS=Object.freeze([
 domain('operator','accounts','operator-host/executor.mjs',
  'new AccountRegistry({ stateFile:ACCOUNT_STATE_FILE','new GoldPgAccountRepository('),
 domain('operator','account_sessions','operator-host/account-registry.mjs',
  'this.sessions=new Map()','GoldPgAccountSessions'),
 domain('operator','device_inventory','operator-host/executor.mjs',
  'new DeviceRegistry({ stateFile:DEVICE_STATE_FILE','new GoldPgDeviceRepository('),
 domain('operator','enrollments','operator-host/executor.mjs',
  'new EnrollmentRegistry({ stateFile:ENROLLMENT_STATE_FILE','new GoldPgEnrollmentRepository('),
 domain('operator','connection_leases','operator-host/executor.mjs',
  'new DeviceConnectionRegistry({ stateFile:CONNECTION_STATE_FILE','new GoldPgConnectionRepository('),
 domain('operator','ab_grants','operator-host/executor.mjs',
  'new DeviceAccessGrantRegistry({ stateFile:ACCESS_STATE_FILE','new GoldPgAccessGrantRepository('),
 domain('operator','ab_pairing_requests','operator-host/executor.mjs',
  'new DevicePairingRegistry({ emit:event','new GoldPgPairingRepository('),
 domain('operator','agent_clients','operator-host/executor.mjs',
  'new AgentClientRegistry({ stateFile:AGENT_CLIENT_STATE_FILE','new GoldPgAgentClientRepository('),
 domain('operator','sessions','operator-host/executor.mjs',
  'new SessionRegistry({ idleMs','new GoldPgSessionRepository('),
 domain('operator','pro_team','operator-host/executor.mjs',
  'new ProTeamRegistry({stateFile:TEAM_STATE_FILE','new GoldPgTeamRepository('),
 domain('operator','usage','operator-host/executor.mjs',
  'new UsageRegistry({ stateFile:USAGE_STATE_FILE','new GoldPgUsageRepository('),
 domain('operator','licenses','operator-host/executor.mjs',
  'new LicenseKeyRegistry({ stateFile:LICENSE_STATE_FILE','new GoldPgLicenseRepository('),
 domain('operator','notifications','operator-host/executor.mjs',
  'new AccountNotificationRegistry({stateFile:NOTIFICATIONS_STATE_FILE','new GoldPgNotificationRepository({pool:goldNotificationPlane.pool})'),
 domain('operator','host_companion_binding','operator-host/executor.mjs',
  'ensureHostCompanionState(HOST_COMPANION_STATE_FILE','GoldPgHostBindingRepository('),
 domain('plugin','oauth_authorization','plugin-server/server.mjs',
  'registerOAuth(app)','registerGoldPgOAuth('),
 domain('plugin','account_recovery','plugin-server/server.mjs',
  'registerAccountPortal(app)','registerGoldPgAccountPortal('),
 domain('plugin','paddle_billing','plugin-server/server.mjs',
  'registerPaddleWebhook(app)','registerGoldPgPaddle('),
 domain('plugin','support_outbox','plugin-server/server.mjs',
  "new GoldPgSupportOutbox({pool:goldSitePlane.pool,deliveryEnabled:false})",
  'GoldPgSupportOutboxDeliveryReady'),
 domain('plugin','site_announcements','plugin-server/server.mjs',
  "process.env.LR_GOLD_SITE_ANNOUNCEMENTS_PG==='1'",
  "GoldPgSiteAnnouncementsRepository({pool:goldSitePlane.pool})"),
 domain('plugin','site_analytics','plugin-server/server.mjs',
  "process.env.LR_GOLD_SITE_ANALYTICS_PG==='1'",
  "GoldPgSiteAnalyticsRepository({pool:goldSitePlane.pool})"),
 domain('plugin','distribution_publication','plugin-server/server.mjs',
  'registerDistributionPortal(app)','registerGoldPgDistribution('),
 domain('plugin','google_oauth','plugin-server/server.mjs',
  'registerOAuth(app)','registerGoldPgGoogleIdentity('),
 domain('plugin','admin_content_and_support','plugin-server/server.mjs',
  'registerAdminPortal(app)','registerGoldPgAdminState('),
]);
const read=(cwd,file)=>fs.readFileSync(path.join(cwd,file),'utf8');
export function inspectGoldPgOnlyCutover({cwd=root}={}){
 const items=GOLD_DOMAINS.map(d=>{
  const code=read(cwd,d.file);
  const legacyPresent=code.includes(d.legacy);
  const pgWired=code.includes(d.modern);
  // Code-source evidence is a NECESSARY but never sufficient test. An
  // existing opt-in mode with legacy fallback cannot count as complete.
  const complete=pgWired&&!legacyPresent;
  return {name:d.name,role:d.role,complete,legacyPresent,pgWired,file:d.file};
 });
 const unresolved=items.filter(i=>!i.complete);
 return {ok:unresolved.length===0,required:items.length,
  complete:items.length-unresolved.length,unresolved:unresolved.length,
  domains:items};
}
export function assertGoldPgOnlyBoot({role,env=process.env,cwd=root}={}){
 if(env.LR_GOLD_PG_ONLY!=='1')return {active:false};
 if(env.LIGHT_REMOTE_GOLD_INDEPENDENT!=='1')
  throw Error('gold_pg_only_independent_mode_required');
 const scan=inspectGoldPgOnlyCutover({cwd});
 // Even when one process' local domain is complete, Gold cannot claim
 // independent end-to-end readiness if another critical domain is not.
 if(!scan.ok){
  const names=scan.domains.filter(d=>!d.complete).map(d=>d.name);
  const error=new Error('gold_pg_only_cutover_incomplete:'+names.join(','));
  error.code='GOLD_PG_ONLY_NOT_READY';
  error.pending=names;
  throw error;
 }
 if(role!=='operator'&&role!=='plugin')throw Error('gold_pg_only_invalid_role');
 return {active:true,checkedDomains:scan.required};
}
