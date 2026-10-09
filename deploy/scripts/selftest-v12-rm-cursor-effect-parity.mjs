import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const winInput=read('client/windows-native/GptOperator.RealRemoteV2/NativeInput.cs');
const winGlow=read('client/windows-native/GptOperator.RealRemoteV2/CursorGlowOverlay.cs');
const winContext=read('client/windows-native/GptOperator.RealRemoteV2/RobotContext.cs');
const mac=read('client/macos/real-remote/RobotCursorOverlay.swift');
const macBuilder=read('client/macos/real-remote/canary/build-dev-app.sh');

assert.match(winInput,/SetCursorPos\(x,y\)/,'Windows must move native OS cursor directly');
assert.match(winInput,/Stopwatch\.StartNew\(\)/,'Windows cursor pacing uses monotonic timing');
assert.match(winInput,/SmoothPoint\(start\.X,start\.Y,x,y,i,frameCount\)/);
assert.doesNotMatch(winInput,/var delay=Math\.Max\(0,durationMs\/steps\)/);
assert.match(winGlow,/WS_EX_TRANSPARENT\|WS_EX_TOOLWINDOW\|WS_EX_NOACTIVATE/);
assert.match(winGlow,/AllowsTransparency=true/);
assert.match(winGlow,/ShowActivated=false/);
assert.doesNotMatch(winGlow,/TransparencyKey=/,'no GDI transparency-key bullseye');
assert.match(winGlow,/new RadialGradientBrush/);
assert.match(winGlow,/System\.Windows\.Forms\.Cursor\.Position/);
assert.match(winGlow,/ClickPulse/);
assert.match(winGlow,/Small warm light/,'glow must be a small offset tail');
assert.doesNotMatch(winGlow,/SolidBrush\(Color\.FromArgb\(\(int\)\(32\*breathe/,
  'old cyan-violet bullseye must not return');
const cursorSource=read('client/windows-native/GptOperator.RealRemoteV2/SystemCursorOverride.cs');
assert.match(cursorSource,/CursorIds = \{ OCR_NORMAL \}/,
  'must not replace I-beam or Paint crosshair with AI arrow');
assert.doesNotMatch(cursorSource,/DrawString\("AI"/,
  'badge cannot remain legible after Win32 system cursor downscale');
assert.match(winContext,/"text.type" => WriteText\(request,true\)/,
  'Windows must support macOS-like physical paced typing');
assert.match(winContext,/win32-unicode-key-events-per-character/);

assert.doesNotMatch(winGlow,/\b(?:SetCursorPos|SendInput|SetSystemCursor|SystemParametersInfo)\s*\(/);
assert.match(winContext,/LIGHT_REMOTE_RM_ANIMATED_GLOW/);
assert.match(winContext,/\_ambientGlow\?\.Dispose\(\)/);
assert.match(winContext,/SystemCursorOverride\.Release\(\)/);
// An observational status or frame must never install an OS-wide cursor.
const winCtor=winContext.split('public RobotContext(string pipeName)')[1]?.split('private async Task<object?> HandleAsync')[0]||'';
assert.doesNotMatch(winCtor,/SystemCursorOverride\.Acquire\(\)/,
  'read-only helper startup must not replace the system cursor');
assert.doesNotMatch(winCtor,/_ambientGlow\.Show\(\)/,
  'read-only helper startup must not show the animated glow');
assert.match(winContext,/CursorActivityLeaseMs=5_000/);
assert.match(winContext,/HoldCursorForPhysicalInput\(\)/);
assert.match(winContext,/ReleaseCursorActivity\(\)/);
for(const action of ['MarkMove','MarkClick','MarkScroll','MarkDrag']){
  assert.match(winContext,new RegExp('HoldCursorForPhysicalInput\\(\\);\\s*_cursorState\\.'+action+'\\('),
    'physical cursor lease missing for '+action);
}

assert.match(mac,/NSStatusBar\.system\.statusItem/);
assert.match(mac,/url\(forResource:"LightRemoteRM",withExtension:"icns"\)/);
assert.match(mac,/NSStatusBar\.system\.removeStatusItem\(rmStatusItem\)/);
assert.match(mac,/LightRemoteRM-256\.png/,'bare macOS helper must support a packaged RM icon');
const macWorkflow=read('.github/workflows/macos-client-build.yml');
assert.match(macWorkflow,/install -m 0644 client\/macos\/real-remote\/Resources\/LightRemoteRM-256\.png/);
assert.match(macBuilder,/LightRemoteRM\.icns/);
console.log('RM48_WINDOWS_NATIVE_POINTER_MONOTONIC_PACING=PASS');
console.log('RM48_WINDOWS_CLICKTHROUGH_ANIMATED_GLOW_CONTRACT=PASS');
console.log('RM48_MACOS_ACTIVE_MENU_BAR_RM_ICON_CONTRACT=PASS');
