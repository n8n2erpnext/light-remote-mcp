import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function renderLinuxStatus(data, {host = '127.0.0.1', port = '5491', service = 'unknown'} = {}) {
  const text = (value, fallback = 'Unknown') => String(value ?? fallback).replace(/[\r\n\t]/g, ' ').trim();
  const state = text(data.cloudState, 'offline');
  const online = state === 'connected';
  const plan = online && data.connectionPlan ? ' · ' + text(data.connectionPlan).toUpperCase() : '';
  const type = host === '127.0.0.1' ? 'Local only'
    : /^100\.(6[4-9]|[789][0-9]|1[01][0-9]|12[0-7])\./.test(host) ? 'NetBird'
    : 'LAN';
  const fleet = data.fleetWall?.healthy ? 'Online' : 'Not running';
  const version = text(data.version, 'not installed');
  const update = text(data.update?.state, 'idle');
  const lines = [
    '',
    'Light Remote  ' + version,
    '---------------------------------------',
    'Device    : ' + text(data.deviceName, 'Linux Server'),
    'Service   : ' + text(service),
    'Cloud     : ' + (online ? 'Connected' : state.charAt(0).toUpperCase() + state.slice(1)) + plan,
    'Local Wall: http://' + host + ':' + port + '/',
    'Bind      : ' + type + ' (' + host + ')',
    'Fleet     : ' + fleet,
  ];
  if (update !== 'idle') lines.push('Update    : ' + update);
  lines.push(
    '',
    'Commands',
    '  light-remote status          Show this summary',
    '  light-remote up / down       Connect or disconnect',
    '  light-remote bind            Change Wall bind address',
    '  light-remote wall            Print Wall URL',
    '  light-remote status --json   Technical details',
    '  light-remote help            All commands',
  );
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const status = JSON.parse(readFileSync(0, 'utf8'));
    process.stdout.write(renderLinuxStatus(status, {
      host: process.argv[2],
      port: process.argv[3],
      service: process.argv[4],
    }));
  } catch {
    console.error('Light Remote: unable to read device status. Try light-remote status --json.');
    process.exitCode = 1;
  }
}
