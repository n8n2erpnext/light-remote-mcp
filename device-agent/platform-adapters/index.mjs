import { defaultCommandExists } from './shared.mjs';
import { createLinuxAdapter } from './linux.mjs';
import { createWindowsAdapter } from './windows.mjs';
import { createMacOSAdapter } from './macos.mjs';

export function createPlatformAdapter({platform=process.platform,commandExists}={}) {
  const exists=commandExists || (name => defaultCommandExists(platform,name));
  if(platform==='linux')return createLinuxAdapter({commandExists:exists});
  if(platform==='win32')return createWindowsAdapter({commandExists:exists});
  if(platform==='darwin')return createMacOSAdapter({commandExists:exists});
  throw new Error(`unsupported_platform:${platform}`);
}
