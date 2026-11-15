import { describe, expect, it } from 'vitest';
import { parseRoute, navRoutes, routeHref } from './routes';

describe('navigation', () => {
  it('has exactly the nine canonical sidebar items', () => {
    expect(navRoutes.map(x => x.label)).toEqual([
      'Overview', 'AI Access', 'Sessions', 'Live Monitor', 'Devices',
      'Long Memory', 'API Worker', 'Account', 'Settings'
    ]);
  });
  it('never interprets unknown/untrusted hashes as a privileged route', () => {
    expect(parseRoute('#/ai-access')).toBe('ai-access');
    expect(parseRoute('#/settings?x=1')).toBe('settings');
    expect(parseRoute('#/admin/retire-all')).toBe('overview');
    expect(routeHref('ai-access')).toBe('#/ai-access');
    expect(routeHref('codex-bridge')).toBe('#/api-worker');
    expect(parseRoute('#/api-worker')).toBe('codex-bridge');
    expect(parseRoute('#/codex-bridge')).toBe('codex-bridge');
  });
});
