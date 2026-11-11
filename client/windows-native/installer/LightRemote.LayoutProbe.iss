; CI-only welcome layout probe. No payload, app directory, uninstaller,
; registry registration or runnable product. Never click Install in this probe.
#ifndef OutputDir
  #define OutputDir "..\..\..\dist\windows\layout-probe"
#endif
[Setup]
AppId=LightRemote-CI-Layout-Probe
AppName=Light Remote Layout Probe
AppVersion=0
DefaultDirName={localappdata}\LightRemote-CI-Layout-Probe
PrivilegesRequired=lowest
CreateAppDir=no
Uninstallable=no
CreateUninstallRegKey=no
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
WizardStyle=modern
OutputDir={#OutputDir}
OutputBaseFilename=LAYOUT-PROBE-DO-NOT-INSTALL
Compression=lzma2/fast
SolidCompression=yes
[Files]
Source: "{#SourcePath}\..\..\..\assets\fonts\web\GoogleSans-Variable.ttf"; DestName: "LightRemote.Setup.GoogleSans.ttf"; Flags: dontcopy
Source: "{#SourcePath}\..\..\..\assets\branding\light-remote-mark-512.png"; DestName: "LightRemote.Setup.Mark.png"; Flags: dontcopy
[Code]
procedure QuiesceInstalledRuntime();
begin
  // Probe has no runtime and never enters install/uninstall.
end;
#include "LightRemote.Wizard.iss"
procedure DeinitializeSetup();
begin
  LRReleaseAssets();
end;
