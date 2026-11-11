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

// Windows requirements supersede the historical custom-arrow reference.
const recovery=read('client/windows-native/GptOperator.RealRemoteV2/SystemCursorOverride.cs');
const program=read('client/windows-native/GptOperator.RealRemoteV2/Program.cs');
const control=read('client/windows-native/GptOperator.RealRemoteV2/ControlActivity.cs');
assert.doesNotMatch(recovery,/SetSystemCursor|CreateIconIndirect/);
assert.doesNotMatch(winContext,/SystemCursorOverride\.(?:Acquire|Release)/);
assert.doesNotMatch(program,/StartCursorGuardian\(/);
assert.match(recovery,/bool ForceRestore\(\) => SystemParametersInfo/);
assert.match(winInput,/dwExtraInfo=ControlActivity.InputMarker/);
assert.match(winInput,/AbsoluteCoordinate/);
assert.match(winInput,/ReleaseOwnedInputs/);
assert.match(winInput,/InterruptibleDelay\(35\)/,'retain Paint-compatible hover by default');
assert.match(winInput,/InterruptibleDelay\(40\)/);
assert.match(control,/input_interrupted_local_activity_do_not_replay/);
assert.match(control,/CallNextHookEx/);
assert.doesNotMatch(control,/BlockInput|return \(nint\)1/);
assert.match(winGlow,/Text="AI"/);
assert.match(winGlow,/WS_EX_TRANSPARENT\|WS_EX_TOOLWINDOW\|WS_EX_NOACTIVATE/);
assert.match(winGlow,/ShowActivated=false/);
assert.match(winGlow,/_timer.Stop\(\); base.Hide\(\)/);
assert.match(winGlow,/SetWindowPos/);
assert.match(winGlow,/GetIconInfo/);
assert.doesNotMatch(winGlow,/SetCursorPos|SendInput|SetSystemCursor/);
const attach=winContext.split('private object AttachVisualWithCursor')[1].split('private object DetachVisualWithCursor')[0];
assert.doesNotMatch(attach,/_activity\.|glow|Acquire/,'view attach is observation only');
assert.match(winContext,/contentVerification="unverified",verifiedInsertedUnits=\(int\?\)null/);
assert.match(winContext,/"cursor.restore" => RestoreCursors\(\)/);
assert.match(winContext,/remaining=_passivePreviewDeadline-Environment.TickCount64/);

assert.match(mac,/NSStatusBar\.system\.statusItem/);
assert.match(mac,/url\(forResource:"LightRemoteRM",withExtension:"icns"\)/);
assert.match(mac,/NSStatusBar\.system\.removeStatusItem\(rmStatusItem\)/);
assert.match(mac,/LightRemoteRM-256\.png/,'bare macOS helper must support a packaged RM icon');
// Historical macOS packaging recipe is retained; this is not a claim of a new macOS installer.
const macWorkflow=read('docs/history/pre-reconstruction/workflows/macos-client-build.yml');
assert.match(macWorkflow,/install -m 0644 client\/macos\/real-remote\/Resources\/LightRemoteRM-256\.png/);
assert.match(macBuilder,/LightRemoteRM\.icns/);
console.log('RM48_WINDOWS_NATIVE_POINTER_MONOTONIC_PACING=PASS');
console.log('RMV2_WINDOWS_NATIVE_CURSOR_AI_BADGE_CONTROL_CONTRACT=PASS');
console.log('RM48_MACOS_ACTIVE_MENU_BAR_RM_ICON_SOURCE=PASS; UNIFIED_MACOS_PACKAGE=NOT_BUILT');
