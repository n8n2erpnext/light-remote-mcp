import assert from 'node:assert/strict';
import path from 'node:path';
import {resolveGoldCodexBinary} from '../../device-agent/gold-codex-plus.mjs';
const env={APPDATA:'C:\\Users\\Test\\AppData\\Roaming',LOCALAPPDATA:'C:\\Users\\Test\\AppData\\Local'};
const official=path.win32.join(env.LOCALAPPDATA,'Programs','OpenAI','Codex','bin','codex.exe');
const npm=path.win32.join(env.APPDATA,'npm','node_modules','@openai','codex','node_modules',
  '@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin','codex.exe');
assert.equal(resolveGoldCodexBinary({platform:'win32',env,exists:x=>x===official}),official);
assert.equal(resolveGoldCodexBinary({platform:'win32',env,exists:x=>x===npm}),npm);
assert.equal(resolveGoldCodexBinary({platform:'win32',env,exists:()=>false}),official);
assert.equal(resolveGoldCodexBinary({platform:'win32',env:{...env,CODEX_CLI_PATH:npm},exists:()=>false}),npm);
assert.throws(()=>resolveGoldCodexBinary({platform:'win32',env:{...env,CODEX_CLI_PATH:'codex.cmd'},exists:()=>true}),/codex_native_binary_path_invalid/);
assert.throws(()=>resolveGoldCodexBinary({platform:'win32',env:{...env,CODEX_CLI_PATH:'C:\\Apps\\codex.cmd'},exists:()=>true}),/codex_native_binary_path_invalid/);
assert.equal(resolveGoldCodexBinary({platform:'linux',env:{},exists:()=>false}),
  '/opt/light-remote-gold-codex-runtime/node_modules/.bin/codex');
console.log('GOLD_CODEX_NATIVE_BINARY_WINDOWS_INSTALL_AND_OVERRIDE_DISCOVERY_PASS');
