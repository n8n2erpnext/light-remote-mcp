import assert from 'node:assert/strict';
import fs from 'node:fs';
import {migrateLegacyEndpoint,STABLE_PUBLIC_ENDPOINT} from '../../lib/public-endpoint.mjs';

assert.equal(migrateLegacyEndpoint('https://light-remote-mcp.vercel.app',{kind:'base'}),STABLE_PUBLIC_ENDPOINT);
assert.equal(migrateLegacyEndpoint('https://light-remote-mcp.vercel.app/',{kind:'base'}),STABLE_PUBLIC_ENDPOINT);
assert.equal(migrateLegacyEndpoint('https://lightremote.thaiduy.digital',{kind:'base'}),STABLE_PUBLIC_ENDPOINT);
assert.equal(migrateLegacyEndpoint('https://lightremote.thaiduy.digital',{kind:'hub'}),STABLE_PUBLIC_ENDPOINT);
assert.equal(migrateLegacyEndpoint('https://mcp.dashboard.thaiduy.store',{kind:'hub'}),STABLE_PUBLIC_ENDPOINT);
assert.equal(migrateLegacyEndpoint('https://mcp.dashboard.thaiduy.store/',{kind:'hub'}),STABLE_PUBLIC_ENDPOINT);
assert.equal(migrateLegacyEndpoint(STABLE_PUBLIC_ENDPOINT,{kind:'base'}),STABLE_PUBLIC_ENDPOINT);
assert.equal(migrateLegacyEndpoint('',{kind:'hub'}),STABLE_PUBLIC_ENDPOINT);
assert.equal(migrateLegacyEndpoint('https://custom.example.net',{kind:'base'}),'https://custom.example.net');
assert.equal(migrateLegacyEndpoint('https://custom.example.net/path/',{kind:'hub'}),'https://custom.example.net/path');

const win=fs.readFileSync(new URL('../../client/windows-native/GptOperator.Client/ConnectionConfig.cs',import.meta.url),'utf8');
const linux=fs.readFileSync(new URL('../../client/linux/install.sh',import.meta.url),'utf8');
const service=fs.readFileSync(new URL('../../client/linux-debian/systemd/light-remote-agent.service',import.meta.url),'utf8');
const plist=fs.readFileSync(new URL('../../client/macos/launchd/com.lightremote.agent.plist',import.meta.url),'utf8');
const tray=fs.readFileSync(new URL('../../client/macos/tray/main.swift',import.meta.url),'utf8');
const agent=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');

assert.match(win,/StablePublicEndpoint = "https:\/\/light-remote\.thaiduy\.digital"/);
assert.match(win,/LegacyBridgeUrls/);
assert.match(win,/LegacyHubUrls/);
assert.match(win,/MigrateKnownDefault/);
assert.match(linux,/OPERATOR_AGENT_BASE_URL:-https:\/\/light-remote\.thaiduy\.digital/);
assert.match(linux,/BASE_URL="https:\/\/light-remote\.thaiduy\.digital"/);
assert.match(linux,/HUB_URL="https:\/\/light-remote\.thaiduy\.digital"/);
assert.match(service,/OPERATOR_AGENT_BASE_URL=https:\/\/light-remote\.thaiduy\.digital/);
assert.match(service,/OPERATOR_AGENT_HUB_URL=https:\/\/light-remote\.thaiduy\.digital/);
assert.match(plist,/https:\/\/light-remote\.thaiduy\.digital/);
assert.match(tray,/https:\/\/light-remote\.thaiduy\.digital\/account/);
assert.match(agent,/migrateLegacyEndpoint\(process\.env\.OPERATOR_AGENT_BASE_URL/);
assert.match(agent,/migrateLegacyEndpoint\(process\.env\.OPERATOR_AGENT_HUB_URL/);

console.log('public-endpoint-known-default-migration=PASS');
console.log('public-endpoint-custom-preservation=PASS');
console.log('public-endpoint-cross-platform-defaults=PASS');
