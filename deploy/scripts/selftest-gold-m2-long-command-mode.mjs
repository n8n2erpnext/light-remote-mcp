import assert from 'node:assert/strict';
import {longExecHint,resolveExecMode,LONG_EXEC_GROUPS} from '../../operator-host/long-running-exec-policy.mjs';
const cases=[
  ['curl -fSL https://example.invalid/a -o a','internet-download'],
  ['& curl.exe -L --output a.zip https://example.invalid/a','internet-download'],
  ['sudo -n wget -O /tmp/a https://example.invalid/a','internet-download'],
  ['wget.exe https://example.invalid/a','internet-download'],
  ['Invoke-WebRequest -Uri https://example.invalid/a -OutFile a','internet-download'],
  ['Start-BitsTransfer -Source https://example.invalid/a','internet-download'],
  ['$ErrorActionPreference = "Stop"; & curl.exe --max-time 45 -o x url','internet-download'],
  ['git clone https://example.invalid/repo','source-fetch'],
  ['git lfs pull','source-fetch'],
  ['npm ci','package-install'],
  ['pnpm install','package-install'],
  ['python -m pip install x','package-install'],
  ['uv sync','package-install'],
  ['dotnet build','build-and-test'],
  ['cargo build --release','build-and-test'],
  ['go test ./...','build-and-test'],
  ['cmake --build build','build-and-test'],
  ['./gradlew build','build-and-test'],
  ['docker compose build','build-and-test'],
  ['npm run build','build-and-test'],
  ['make -j2','build-and-test'],
  ['rsync -a a b','archive-transfer-media'],
  ['robocopy a b /E','archive-transfer-media'],
  ['pg_dump -Fc database','archive-transfer-media'],
  ['ffmpeg -i a.mp4 b.mp4','archive-transfer-media'],
  ['npm run dev','build-and-test'],
  ['docker logs -f test','persistent-stream']
];
for(const [s,expected] of cases){
  assert.equal(longExecHint(s),expected,s);
  assert.equal(resolveExecMode({script:s,enabled:true}).effective,'background',s);
}
for(const script of ['printf curl','echo wget','Write-Output "curl.exe -o y"','git status','npm --version','Get-Date','curlish https://example.invalid','## wget','cat somefile']){
  assert.equal(longExecHint(script),null,script);
  assert.equal(resolveExecMode({script,enabled:true}).effective,'foreground',script);
}
assert.equal(resolveExecMode({script:'curl --fail x',enabled:false}).effective,'foreground');
assert.equal(resolveExecMode({script:'curl --fail x',enabled:true,mode:'foreground'}).effective,'foreground');
assert.equal(resolveExecMode({script:'printf hello',enabled:true,mode:'background'}).effective,'background');
assert.throws(()=>resolveExecMode({script:'curl x',enabled:false,mode:'background'}),/exec_background_not_enabled/);
assert.throws(()=>resolveExecMode({script:'curl x',enabled:true,mode:'autonomous'}),/invalid_execution_mode/);
assert.equal(LONG_EXEC_GROUPS.length,6);
console.log('M2_LONG_COMMAND_CURL_WGET_POWERSHELL_GIT_PACKAGE_BUILD_TRANSFER=PASS');
console.log('M2_EXEC_MODE_EXPLICIT_OVERRIDE_FAIL_CLOSED_FLAG=PASS');
console.log('M2_NON_COMMAND_FALSE_POSITIVE_GUARD=PASS');
