import fs from 'node:fs';
import crypto from 'node:crypto';
import { hashWallPassword } from '../../gateway/wall-auth.mjs';

const dir=process.argv[2] || '/home/ubuntu/.config/gpt-vps-operator';
const configFile=`${dir}/wall-auth.json`;
const bootstrapFile=`${dir}/wall-bootstrap-password`;
if (fs.existsSync(configFile) || fs.existsSync(bootstrapFile)) {
  console.error('wall auth secret already exists; refusing to overwrite');
  process.exit(2);
}
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const password=crypto.randomBytes(24).toString('base64url');
const config={
  mode:'local',
  username:'operator',
  passwordHash:hashWallPassword(password),
  cookieSecret:crypto.randomBytes(32).toString('base64url'),
  sessionTtlSeconds:43200
};
fs.writeFileSync(configFile,JSON.stringify(config,null,2)+'\n',{mode:0o600});
fs.writeFileSync(bootstrapFile,password+'\n',{mode:0o600});
fs.chmodSync(configFile,0o600); fs.chmodSync(bootstrapFile,0o600);
console.log(`wall-auth-config-created=${configFile}`);
console.log(`bootstrap-password-file-created=${bootstrapFile}`);
console.log('bootstrap-password-content-not-printed=PASS');
