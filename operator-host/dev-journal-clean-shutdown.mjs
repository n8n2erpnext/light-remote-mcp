/**
 * rc.50 DEV-only final shutdown census.
 * This checks actual Operator objects, never untrusted caller-reported counts.
 * Not a remote Agent proof, cross-host writer fence or production cutover gate.
 */
function nonnegative(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw Error('DEV_REMOTE_JOURNAL_SHUTDOWN_CENSUS_INVALID');
  return n;
}
function activeNative(registry) {
  if (!registry || typeof registry.list !== 'function')
    throw Error('DEV_REMOTE_JOURNAL_SHUTDOWN_CENSUS_INVALID');
  const rows = registry.list();
  if (!Array.isArray(rows) || rows.some(row=>!row || typeof row!=='object'))
    throw Error('DEV_REMOTE_JOURNAL_SHUTDOWN_CENSUS_INVALID');
  return rows.filter(row=>!row.finishedAt).length;
}
export function assertDevJournalCleanShutdown({
  localFreezeGate, fleet, jobs, unreconciledRemoteEffects,
  remoteEffectJournal, nativeProcesses, nativeTerminals
}={}) {
  if (!localFreezeGate || !fleet || !jobs || !unreconciledRemoteEffects ||
      !remoteEffectJournal || !nativeProcesses || !nativeTerminals)
    throw Error('DEV_REMOTE_JOURNAL_SHUTDOWN_CENSUS_INVALID');
  if (typeof jobs.values!=='function')
    throw Error('DEV_REMOTE_JOURNAL_SHUTDOWN_CENSUS_INVALID');
  let unfinishedJobs=0;
  for (const job of jobs.values()) {
    if (!job || typeof job!=='object')
      throw Error('DEV_REMOTE_JOURNAL_SHUTDOWN_CENSUS_INVALID');
    if (!job.finishedAt) unfinishedJobs++;
  }
  const gate=localFreezeGate.snapshot();
  if (gate.phase!=='open' || gate.sealFailed || gate.inflight!==0 ||
      nonnegative(fleet.commands?.size)!==0 ||
      nonnegative(unreconciledRemoteEffects.size)!==0 ||
      nonnegative(remoteEffectJournal.pending)!==0 ||
      unfinishedJobs!==0 ||
      activeNative(nativeProcesses)!==0 ||
      activeNative(nativeTerminals)!==0)
    throw Error('DEV_REMOTE_EFFECT_JOURNAL_UNCLEAN_SHUTDOWN');
  return true;
}
