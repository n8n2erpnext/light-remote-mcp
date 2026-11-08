import { createPlatformAdapter } from '../device-agent/platform-adapters/index.mjs';

// Read-only admission preflight for outbound EXEC only. It mirrors the same
// platform inference shared with the Agent, without probing the Operator's
// OS or invoking any target executable. The Agent remains final authority.
const ADAPTERS=new Map();
export function inferOutboundExecCapabilities(script,{platform,shell='default',declared=[]}={}){
  const required=new Set(Array.isArray(declared)?declared:[]);
  // Unknown/new platforms retain the old declared-only behavior; never
  // mistake host Linux capabilities for a Windows/macOS leaf.
  if(!['linux','darwin','win32'].includes(platform))return [...required].sort();
  let adapter=ADAPTERS.get(platform);
  if(!adapter){adapter=createPlatformAdapter({platform,commandExists:()=>false});ADAPTERS.set(platform,adapter);}
  for(const cap of adapter.inferRequiredCapabilities(script,{shell}))required.add(cap);
  return [...required].sort();
}
