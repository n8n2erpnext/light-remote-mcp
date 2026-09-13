#ifndef StageDir
  #error StageDir must be defined
#endif
#ifndef OutputDir
  #error OutputDir must be defined
#endif
#ifndef AppVersion
  #define AppVersion "0.9.0-rc.6"
#endif
#ifndef UpdaterStageDir
  #error UpdaterStageDir must be defined
#endif

[Setup]
AppId={{A8D073F5-9792-4FA6-96A6-13C565F255F3}
AppName=Light Remote MCP
AppVersion={#AppVersion}
AppPublisher=Thai Duy
DefaultDirName={localappdata}\Programs\Light Remote MCP
DefaultGroupName=Light Remote MCP
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Light-Remote-MCP-Setup-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\GptOperator.Client.exe
SetupIconFile={#StageDir}\Assets\light-remote.ico
AppMutex=Local\GPT_OPERATOR_CLIENT_V09
[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#UpdaterStageDir}\*"; DestDir: "{localappdata}\Light Remote\Updater"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Light Remote MCP"; ValueData: """{app}\GptOperator.Client.exe"" --background"; Flags: uninsdeletevalue

[Icons]
Name: "{group}\Light Remote MCP"; Filename: "{app}\GptOperator.Client.exe"; Parameters: "--launch"
Name: "{userdesktop}\Light Remote MCP"; Filename: "{app}\GptOperator.Client.exe"; Parameters: "--launch"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\agent\device-agent\install-windows-task.ps1"" -InstallRoot ""{app}"""; Flags: runhidden waituntilterminated
Filename: "{app}\GptOperator.Client.exe"; Description: "Start Light Remote tray"; Flags: nowait postinstall skipifsilent

[Code]
procedure RemoveLegacyAutostart();
begin
  RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'GPT Operator');
end;

procedure StopAndRemoveLegacyTask();
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "GPTOperatorDeviceAgent"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN "GPTOperatorDeviceAgent" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "LightRemoteDeviceAgent"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN "LightRemoteDeviceAgent" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "LightRemoteUpdater"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN "LightRemoteUpdater" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CacheRollbackInstaller();
var
  RollbackDir, RollbackFile: String;
begin
  RollbackDir := ExpandConstant('{localappdata}\Light Remote\Updater\rollback');
  ForceDirectories(RollbackDir);
  RollbackFile := RollbackDir + '\Light-Remote-MCP-Setup-{#AppVersion}-x64.exe';
  if CompareText(ExpandConstant('{srcexe}'), RollbackFile) <> 0 then
    CopyFile(ExpandConstant('{srcexe}'), RollbackFile, False);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopAndRemoveLegacyTask();
  RemoveLegacyAutostart();
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    CacheRollbackInstaller();
end;

[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/End /TN ""LightRemoteUpdater"""; Flags: runhidden waituntilterminated skipifdoesntexist
Filename: "{sys}\schtasks.exe"; Parameters: "/End /TN ""LightRemoteDeviceAgent"""; Flags: runhidden waituntilterminated skipifdoesntexist
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""LightRemoteDeviceAgent"" /F"; Flags: runhidden waituntilterminated skipifdoesntexist
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""LightRemoteUpdater"" /F"; Flags: runhidden waituntilterminated skipifdoesntexist

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\Light Remote\Updater"
