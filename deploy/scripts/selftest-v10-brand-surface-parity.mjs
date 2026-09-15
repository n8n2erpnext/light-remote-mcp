import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('../..',import.meta.url).pathname);
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const need=(v,m)=>{if(!v)throw new Error(m)};
const canonical=read('assets/branding/light-remote-mark.svg');
need(canonical.includes('<svg')&&canonical.includes('viewBox=')&&canonical.length>200,'canonical_brand_asset_invalid');
const brand=read('lib/brand.mjs');
for(const token of ['brandMarkSvg','brandTitleSvg','brandFaviconSvg'])need(brand.includes(token),`brand_helper_missing:${token}`);
const surfaces=[
 ['gateway/wall-auth.mjs',true,true],['gateway/oauth.mjs',true,true],['gateway/plus-auth.mjs',true,true],
 ['gateway/dashboard.mjs',true,true],['gateway/device-policy-page.mjs',true,true],['gateway/enrollment-page.mjs',true,true],
 ['device-agent/fleet-wall-runtime.mjs',true,true],['device-agent/update-settings-page.mjs',true,true],['device-agent/local-wall.mjs',true,true]
];
for(const [file,favicon,logo] of surfaces){const t=read(file);if(favicon)need(t.includes('brandFaviconSvg'),'surface_favicon_missing:'+file);if(logo)need(t.includes('brandTitleSvg')||t.includes('brandMarkSvg')||t.includes('${brandSvg}')||t.includes('${brandHtml}'),'surface_logo_missing:'+file);}
const fleet=read('device-agent/fleet-wall-runtime.mjs');need(fleet.includes('${brandTitleSvg(48)}')&&fleet.includes('${brandFaviconSvg()}'),'fleet_login_brand_missing');
const local=read('device-agent/local-wall.mjs');need((local.match(/brandFaviconSvg\(\)/g)||[]).length>=4,'local_wall_favicon_surface_gap');
const index=read('index.html');need(index.includes('/assets/branding/light-remote-mark.svg')&&index.includes('/assets/branding/light-remote.ico'),'portal_favicon_missing');
const docker=read('gateway/Dockerfile');need(docker.includes('assets/branding/light-remote-mark.svg')&&docker.includes('lib/brand.mjs'),'gateway_canonical_brand_package_missing');
console.log('v10-brand-surface-logo-parity=PASS');
console.log('v10-brand-surface-favicon-parity=PASS');
console.log('v10-brand-single-source=PASS');
