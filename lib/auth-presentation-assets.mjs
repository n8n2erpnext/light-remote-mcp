// Fixed distribution assets; never selected by browser/request input.
import fs from 'node:fs';
import {brandMarkSvg} from './brand.mjs';
import {WEB_FONT_FACE_CSS} from './web-typography.mjs';
export const AUTH_PRESENTATION=Object.freeze({logo:brandMarkSvg(44),css:WEB_FONT_FACE_CSS+fs.readFileSync(new URL('../assets/branding/auth-pages.css',import.meta.url),'utf8')});
