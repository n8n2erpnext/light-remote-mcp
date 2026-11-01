export const navRoutes = [
  { key: 'overview', label: 'Overview', icon: 'house' },
  { key: 'ai-access', label: 'AI Access', icon: 'shield' },
  { key: 'sessions', label: 'Sessions', icon: 'users' },
  { key: 'live-monitor', label: 'Live Monitor', icon: 'activity' },
  { key: 'devices', label: 'Devices', icon: 'monitor' },
  { key: 'long-memory', label: 'Long Memory', icon: 'database' },
  { key: 'codex-bridge', label: 'Codex Bridge', icon: 'terminal' },
  { key: 'account', label: 'Account', icon: 'user' },
  { key: 'settings', label: 'Settings', icon: 'settings' }
] as const;

export type RouteKey = (typeof navRoutes)[number]['key'];

const aliases: Record<string, RouteKey> = {
  '/': 'overview', '/overview': 'overview', '/ai-access': 'ai-access',
  '/sessions': 'sessions', '/live-monitor': 'live-monitor',
  '/devices': 'devices', '/long-memory': 'long-memory',
  '/codex-bridge': 'codex-bridge', '/account': 'account', '/settings': 'settings'
};

export function parseRoute(hash: string): RouteKey {
  const route = hash.replace(/^#/, '').split(/[?#]/, 1)[0] || '/';
  return aliases[route] ?? 'overview';
}

export function routeHref(route: RouteKey): string {
  return '#/' + route;
}
