import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const text=path=>fs.readFileSync(new URL(path,root),'utf8');
const exists=path=>fs.existsSync(new URL(path,root));
const expect=(ok,msg)=>{if(!ok)throw new Error(msg);};

expect(exists('assets/branding/light-remote-mark.svg'),'brand_mark_svg_missing');
expect(exists('assets/branding/light-remote-lockup.svg'),'brand_lockup_svg_missing');
expect(exists('assets/branding/light-remote-mark-256.png'),'brand_mark_png_missing');
expect(exists('assets/branding/light-remote.ico'),'brand_icon_missing');
expect(text('README.md').includes('assets/branding/light-remote-mark.svg'),'readme_brand_missing');
expect(text('gateway/dashboard.mjs').includes('brandTitleSvg'),'wall_brand_missing');
expect(text('gateway/wall-auth.mjs').includes('brandTitleSvg'),'wall_login_brand_missing');
expect(text('gateway/enrollment-page.mjs').includes('brandTitleSvg'),'enrollment_brand_missing');
expect(text('gateway/device-policy-page.mjs').includes('brandTitleSvg'),'policy_brand_missing');
expect(text('gateway/Dockerfile').includes('brand.mjs'),'gateway_brand_package_missing');
expect(text('deploy/scripts/sync-gateway.sh').includes('brand.mjs'),'gateway_brand_sync_missing');
console.log('v09-light-remote-branding=PASS');
