import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),need=(v,m)=>{if(!v)throw new Error(m);};
const canonical=fs.readFileSync(path.join(root,'client/update-public.pem'),'utf8'),canonicalKey=crypto.createPublicKey(canonical),fingerprint=crypto.createHash('sha256').update(canonicalKey.export({format:'der',type:'spki'})).digest('hex');
const installer=fs.readFileSync(path.join(root,'client/linux/install.sh'),'utf8'),match=installer.match(/cat > "\$TMP\/update-public\.pem" <<'PEM'\n(-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----)\nPEM/);need(match,'linux_installer_embedded_update_key_missing');
const embeddedKey=crypto.createPublicKey(`${match[1]}\n`),embeddedFingerprint=crypto.createHash('sha256').update(embeddedKey.export({format:'der',type:'spki'})).digest('hex');need(embeddedFingerprint===fingerprint,'linux_installer_update_key_drift');
const expectedManifest='https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json',expectedSig=`${expectedManifest}.sig`;
for(const file of ['client/linux/updater.mjs','client/macos/updater.mjs','client/windows-native/LightRemote.Updater/UpdateClient.cs','client/windows-native/GptOperator.Client/ClientVersion.cs']){
 const text=fs.readFileSync(path.join(root,file),'utf8');need(text.includes(expectedManifest),`update_manifest_url_drift:${file}`);need(text.includes(expectedSig),`update_signature_url_drift:${file}`);
}
for(const wf of ['linux-client-build.yml','macos-client-build.yml','windows-native-client.yml']){const text=fs.readFileSync(path.join(root,'.github/workflows',wf),'utf8');need(text.includes('client/update-public.pem')||text.includes('stage-client-core.mjs'),`canonical_update_key_not_packaged:${wf}`);}
console.log(`v10-update-trust-public-key-parity=PASS sha256=${fingerprint}`);console.log('v10-update-trust-channel-url-parity=PASS');
