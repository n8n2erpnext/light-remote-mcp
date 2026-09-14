import fs from 'node:fs';

const canonicalMark = fs.readFileSync(new URL('./brand-mark.svg', import.meta.url), 'utf8').trim();
export const BRANDING_VERSION = '0.9.0-rc.6.brand1';

export function brandMarkSvg(size = 42) {
  const px = Math.max(24, Math.min(Number(size) || 42, 160));
  return canonicalMark
    .replace('width="128"', 'class="brand-mark" role="img" aria-label="Light Remote" width="' + px + '"')
    .replace('height="128"', 'height="' + px + '"');
}

export function brandTitleSvg(size = 42) {
  return '<span class="brand-title">' + brandMarkSvg(size) + '<span><strong>Light Remote</strong><small>MCP</small></span></span>';
}

export function brandFaviconSvg() {
  return '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,' + Buffer.from(canonicalMark).toString('base64') + '">';
}
