/* One feature contract, OS-specific adapters. This lists required boundaries,
 * not an assertion that the not-yet-tested client platforms are supported.
 */
export const CONTINUITY_PLATFORMS=Object.freeze({
 win32:Object.freeze({
  client:'Windows Desktop',focus:'FIRST_WAVE',service:'Windows Service',
  transport:'Windows named pipe',ownerIsolation:'dedicated service SID + explicit pipe DACL + CNG/DPAPI trust anchor',
  dataLocation:'%LOCALAPPDATA%/Light Remote/Continuity',
  brokerStatus:'BLOCKED_DACL_UNVERIFIED',physicalTest:'OPEN'
 }),
 'linux-server':Object.freeze({
  client:'Linux Server',focus:'FIRST_WAVE',service:'systemd system unit',
  transport:'AF_UNIX socket with owner UID and dedicated client group',
  ownerIsolation:'dedicated service UID, signer directory 0700, socket 0660, no group write to parent',
  dataLocation:'$XDG_DATA_HOME/light-remote/continuity or dedicated root',
  brokerStatus:'TRANSIENT_SYSTEMD_TWO_UID_PILOT',physicalTest:'ARM_SYSTEMD_TRANSIENT_LIFECYCLE_PASS'
 }),
 'linux-desktop':Object.freeze({
  client:'Linux Desktop',focus:'SECOND_WAVE',service:'systemd system broker + systemd user Agent',
  transport:'AF_UNIX socket authorized through broker group or OS-auth portal',
  ownerIsolation:'separate system broker UID; never infer owner consent from desktop user UID',
  dataLocation:'$XDG_DATA_HOME/light-remote/continuity',
  brokerStatus:'DESIGN_PENDING',physicalTest:'OPEN'
 }),
 darwin:Object.freeze({
  client:'macOS Desktop',focus:'SECOND_WAVE',service:'launchd privileged daemon + user LaunchAgent',
  transport:'AF_UNIX socket with explicit POSIX ownership and permissions',
  ownerIsolation:'privileged daemon identity / Keychain trust policy, App Sandbox/TCC separation',
  dataLocation:'~/Library/Application Support/Light Remote/Continuity',
  brokerStatus:'DESIGN_PENDING',physicalTest:'OPEN'
 })
});
export function continuityPlatformContract(platform,{desktop=false}={}){
 const id=platform==='linux'?(desktop?'linux-desktop':'linux-server'):platform;
 const contract=CONTINUITY_PLATFORMS[id];
 if(!contract)throw Error('continuity_unsupported_platform');
 return {id,...contract,ownerBrokerRequired:true,optionalModules:['Project Memory','Codex Bridge'],
  defaultModules:{memory:false,codex:false}};
}
