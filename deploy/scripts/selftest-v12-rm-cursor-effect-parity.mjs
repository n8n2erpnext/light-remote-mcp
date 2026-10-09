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
assert.match(winInput,/Thread.Sleep\(35\)/,
  'native cursor click requires a short hover settle to select Paint tools');
assert.match(winInput,/SendMouseFlag\(flags.Down\);\s*Thread.Sleep\(40\);\s*SendMouseFlag\(flags.Up\);/,
  'native cursor click must use distinct physical down/up events');

assert.match(winInput,/Stopwatch\.StartNew\(\)/,'Windows cursor pacing uses monotonic timing');
assert.match(winInput,/SmoothPoint\(start\.X,start\.Y,x,y,i,frameCount\)/);
assert.doesNotMatch(winInput,/var delay=Math\.Max\(0,durationMs\/steps\)/);
assert.match(winGlow,/WS_EX_TRANSPARENT\|WS_EX_TOOLWINDOW\|WS_EX_NOACTIVATE/);
assert.match(winGlow,/AllowsTransparency=true/);
assert.match(winGlow,/ShowActivated=false/);
assert.doesNotMatch(winGlow,/TransparencyKey=/,'no GDI transparency-key bullseye');
assert.match(winGlow,/new RadialGradientBrush/);
assert.match(winGlow,/Volatile.Read\(ref _lastScreenLeft\)/);
assert.match(winGlow,/Volatile.Read\(ref _lastScreenTop\)/);
assert.doesNotMatch(winGlow,/Bounds => new\(\(int\)Math.Round\(Left\)/,
  'RPC status must never read WPF Window.Left from worker thread');

assert.match(winGlow,/System\.Windows\.Forms\.Cursor\.Position/);
assert.match(winGlow,/ClickPulse/);
assert.match(winGlow,/Three superposed continuous radial blooms/);
for(const circle of [
  'AddCenteredBloom(root,40,255,210,62,',
  'AddCenteredBloom(root,30,57,119,246,',
  'AddCenteredBloom(root,20,35,232,249,'
]) assert.ok(winGlow.includes(circle),'missing glow palette '+circle);
assert.ok(winGlow.includes('Canvas.SetLeft(layer,Anchor-diameter/2)'));
assert.ok(winGlow.includes('Canvas.SetTop(layer,Anchor-diameter/2)'));
assert.match(winGlow,/private const int SizePx=56;/);
assert.match(winGlow,/private const int Anchor=28;/);
assert.match(winGlow,/Left=cursor.X\/dpi.DpiScaleX-Anchor;/,
  'hotspot must first convert physical cursor coords to WPF DIPs');
assert.match(winGlow,/Top=cursor.Y\/dpi.DpiScaleY-Anchor;/);
assert.doesNotMatch(winGlow,/Left=\(cursor.X-Anchor\)\/dpi/,
  'do not subtract DIP offset before converting from physical pixels');
assert.doesNotMatch(winGlow,/Top=\(cursor.Y-Anchor\)\/dpi/);
// DPI parity: WPF positions in DIPs; live cursor hotspot in physical pixels.
for(const dpi of [1,1.25,1.5,2]){
  const anchor=28,physicalX=764,physicalY=772;
  const winLeft=physicalX/dpi-anchor,winTop=physicalY/dpi-anchor;
  assert.ok(Math.abs((winLeft+anchor)*dpi-physicalX)<1e-7);
  assert.ok(Math.abs((winTop+anchor)*dpi-physicalY)<1e-7);
}


assert.ok(!winGlow.includes('Canvas.SetLeft(_halo,Anchor+'),
  'old asymmetrical tail may not return');
assert.ok(winGlow.includes('Interval=TimeSpan.FromMilliseconds(16)'));
assert.doesNotMatch(winGlow,/SolidBrush\(Color\.FromArgb\(\(int\)\(32\*breathe/,
  'old cyan-violet bullseye must not return');
const cursorSource=read('client/windows-native/GptOperator.RealRemoteV2/SystemCursorOverride.cs');
assert.ok(cursorSource.includes('new SolidBrush(Color.FromArgb(255,16,21,28))'),
  'approved arrow must have a BLACK fill, never white');
assert.ok(cursorSource.includes('new Pen(Color.FromArgb(255,243,246,251),1.55f)'),
  'approved black pointer must keep its narrow light outline');
assert.match(cursorSource,/CursorIds = \{ OCR_NORMAL \}/,
  'must not replace I-beam or Paint crosshair with AI arrow');
assert.doesNotMatch(cursorSource,/DrawString\("AI"/,
  'badge cannot remain legible after Win32 system cursor downscale');
assert.match(winContext,/"text.type" => WriteText\(request,true\)/,
  'Windows must support macOS-like physical paced typing');
assert.match(winContext,/win32-unicode-key-events-per-character/);
assert.ok(winContext.includes('"cursor.preview.start" => StartPassivePreview(request)'));
assert.ok(winContext.includes('"cursor.preview.stop" => StopPassivePreview()'));
assert.ok(winContext.includes('passivePreviewRemainingMs'));
const passivePreviewMethod=winContext.split('private object StartPassivePreview(JsonElement request)')[1]?.split('private object StopPassivePreview()')[0]||'';
assert.ok(passivePreviewMethod.includes('Math.Clamp(Int(request,"durationSeconds",20),5,30)'));
assert.ok(passivePreviewMethod.includes('_passivePreviewTimer.Change(seconds*1000,Timeout.Infinite)'));
for(const forbidden of ['NativeInput.Move','NativeInput.Click','NativeInput.Drag',
'NativeInput.Wheel','SystemCursorOverride.Acquire','SendInput(','SetCursorPos(']){
  assert.ok(!passivePreviewMethod.includes(forbidden),
    'passive preview must never touch the owner pointer: '+forbidden);
}
assert.ok(winContext.includes('_cursorLeaseActive || _passivePreviewActive || _visualAttachCursorActive'));
assert.ok(winContext.includes('"desktop.visual.attach" or "desktop-visual-attach" => AttachVisualWithCursor(request)'));
assert.ok(winContext.includes('"desktop.visual.detach" or "desktop-visual-detach" => DetachVisualWithCursor(request)'));
const attachedCursorMethod=winContext.split('private object AttachVisualWithCursor(JsonElement request)')[1]?.split('private object DetachVisualWithCursor(JsonElement request)')[0]||'';
assert.ok(attachedCursorMethod.includes('SystemCursorOverride.Acquire()'),
  'attach must install the approved BLACK RM arrow');
assert.ok(attachedCursorMethod.includes('_visualAttachCursorTimer.Change(VisualAttachCursorLeaseMs,Timeout.Infinite)'));
const detachCursorMethod=winContext.split('private void StopVisualAttachCursor()')[1]?.split('// Owner-controlled passive inspection')[0]||'';
assert.ok(detachCursorMethod.includes('SystemCursorOverride.Release()'),
  'detach must restore the Windows arrow');
for(const forbidden of ['NativeInput.Move(','NativeInput.Click(','NativeInput.Drag(','SetCursorPos(','SendInput(']){
 assert.ok(!attachedCursorMethod.includes(forbidden),'attach may not inject pointer action '+forbidden);
}
assert.ok(winContext.includes('if(_visual.ActiveSessions==0)StopVisualAttachCursor();'));
assert.ok(winContext.includes('_visualAttachCursorTimer.Dispose()'));

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
