/**
 * Gold P2-B review-only release gate.
 * It deliberately has no deploy, service restart, migration or rollback
 * implementation. Its output is an auditable HOLD, never live authorization.
 */
export const GOLD_P2B_FOUR_UNITS=Object.freeze([
 'light-remote-gold-operator',
 'light-remote-gold-process-supervisor',
 'light-remote-gold-plugin',
 'light-remote-gold-wall',
]);
const positive=(n)=>Number.isSafeInteger(n)&&n>=0;
const check=(name,pass)=>({gate:name,status:pass===true?'PASS':'HOLD'});

export function evaluateGoldP2BRelease(observation={}){
 const db=observation.database||{};
 const units=observation.units||{};
 const markers=[];
 const add=(name,ok)=>markers.push(check(name,ok));
 add('gold_isolated_host',observation.hostname==='light-remote-gold-uat');
 add('gold_schema039_contiguous',db.maxVersion===39&&db.migrationCount===39);
 add('gold_no_active_jobs',positive(db.activeJobs)&&db.activeJobs===0);
 add('gold_no_unclassified_unknown_work',positive(db.unknownWork)&&db.unknownWork===0);
 add('gold_no_unproved_resource_claims',positive(db.resourceClaims)&&db.resourceClaims===0);
 add('gold_supervisor_aware_inventory',GOLD_P2B_FOUR_UNITS.every(s=>
   units[s]?.active===true&&
   /^\/opt\/light-remote-gold-uat-candidates\/[a-f0-9]{40}$/.test(units[s].workingDirectory||'')));
 const roots=new Set(GOLD_P2B_FOUR_UNITS.map(s=>units[s]?.workingDirectory));
 add('gold_all_four_services_same_runtime',roots.size===1&&!roots.has(undefined));
 add('gold_fleet_signed_idle',observation.fleet?.signedIdle===true);
 add('gold_fresh_verified_pg039_dump',observation.backup?.freshVerifiedPgDump===true);
 add('gold_verified_four_unit_preimage',observation.backup?.fourUnitPreimage===true);
 add('gold_fresh_lxd_snapshot',observation.backup?.freshLxdSnapshot===true);
 add('gold_candidate_sha_and_parity',observation.candidate?.trackedShaVerified===true);
 add('gold_redis_namespace_ttl_proof',observation.redis?.authenticatedTtlReadback===true);
 add('gold_all_new_feature_flags_disabled',observation.featureFlags?.verifiedDisabled===true);
 add('gold_signed_effects_fenced',observation.signedEffects?.provenQuiescent===true);
 add('gold_device_allowlist_signed',observation.devices?.explicitlyAllowlisted===true);
 // A read-only status report is NEVER itself evidence of owner approval.
 // Dedicated execution tooling must obtain independent approval in its own
 // authorization channel before deploying or applying SQL 040..042.
 const status=markers.every(g=>g.status==='PASS')?'READINESS_REVIEW_REQUIRED':'HOLD';
 return Object.freeze({phase:'P2-B',operation:'READ_ONLY',status,
  passed:markers.filter(g=>g.status==='PASS').length,
  total:markers.length,
  gates:markers,
  blocked:markers.filter(g=>g.status==='HOLD').map(g=>g.gate),
  liveMutationAuthorized:false});
}

/**
 * Immutable transaction blueprint for a future independently approved runner.
 * This is structured REVIEW DATA, not a list of executable commands.
 * All phase transitions require a fresh signed evidence receipt.
 */
export function buildGoldP2BTransactionPlan(){
 const stage=(id,requires)=>Object.freeze({id,requires:Object.freeze(requires),action:'NOT_IMPLEMENTED'});
 return Object.freeze({
  version:1,mode:'SOURCE_ONLY_REVIEW',schemaBefore:39,schemaAfter:42,
  fourServices:GOLD_P2B_FOUR_UNITS,
  advance:Object.freeze([
   stage('authorize_owner_and_device_allowlist',['independent_owner_approval','exact_gold_target']),
   stage('quiesce_and_fence',['signed_effects_idle','no_unclassified_unknown_work','m4_claim_preserved']),
   stage('capture_four_unit_pg_redis_preimage',['verified_pg039_dump','independent_pg_restore','fresh_lxd_snapshot','four_unit_archive','redis_ttl_inventory']),
   stage('stage_immutable_candidate',['source_sha_tracked_manifest','dependency_parity','service_user_access','all_feature_flags_off']),
   stage('apply_040_041_042',['approved_migrator','immutable_42_sql_manifest','schema039_ledger','signed_quiescence']),
   stage('switch_four_services',['operator','process_supervisor','plugin','wall']),
   stage('verify_canary',['15_stable_checks','postgres_schema042','redis_ttl','wall_http_and_auth','signed_agent_canary']),
  ]),
  rollback:Object.freeze([
   stage('freeze_dispatch_and_capture_forensic_dump',['no_unfenced_effects','preserve_claims']),
   stage('stop_all_four',['wall','plugin','process_supervisor','operator']),
   stage('restore_paired_pg039',['validated_precutover_dump','accepted_rollback_rpo']),
   stage('restore_four_original_unit_files',['four_unit_archive','immutable_previous_runtime']),
   stage('reconcile_gold_only_redis_ttls',['no_global_flush','historical_lease_policy']),
   stage('restart_and_verify_all',['operator','process_supervisor','plugin','wall','schema039','claim_preserved','15_stable_checks']),
  ]),
  liveApplyAvailable:false,
 });
}
