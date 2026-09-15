#ifndef StageDir
  #error StageDir must be defined
#endif
#ifndef OutputDir
  #error OutputDir must be defined
#endif
#ifndef AppVersion
  #define AppVersion "0.9.0-rc.6"
#endif
#ifndef OutputBaseName
  #define OutputBaseName "Light-Remote-MCP-Setup-x64"
#endif
#ifdef CompactNodeBootstrap
  #ifndef NodeZipName
    #error NodeZipName must be defined for compact installer
  #endif
  #ifndef NodeUrl
    #error NodeUrl must be defined for compact installer
  #endif
  #ifndef NodeFolder
    #error NodeFolder must be defined for compact installer
  #endif
  #ifndef NodeZipSha
    #error NodeZipSha must be defined for compact installer
  #endif
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
OutputBaseFilename={#OutputBaseName}
Compression=lzma2/max
SolidCompression=yes
#ifdef CompactNodeBootstrap
ArchiveExtraction=full
#endif
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\GptOperator.Client.exe
SetupIconFile={#StageDir}\Assets\light-remote.ico
AppMutex=Local\GPT_OPERATOR_CLIENT_V09
[Files]
#ifdef CompactNodeBootstrap
Source: "{#StageDir}\VERSION"; DestDir: "{app}"; Flags: ignoreversion; AfterInstall: InstallCompactNodeRuntime
#endif
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

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
#ifdef CompactNodeBootstrap
function CompactNodeCacheDir(): String;
begin
  Result := ExpandConstant('{localappdata}\Light Remote\Updater\runtime-cache');
end;

function CompactNodeCacheZip(): String;
begin
  Result := CompactNodeCacheDir() + '\{#NodeZipName}';
end;

procedure PrepareCompactNodeArchive();
var
  CacheZip, TempZip: String;
begin
  ForceDirectories(CompactNodeCacheDir());
  CacheZip := CompactNodeCacheZip();
  TempZip := ExpandConstant('{tmp}\{#NodeZipName}');
  if FileExists(CacheZip) and (CompareText(GetSHA256OfFile(CacheZip), '{#NodeZipSha}') = 0) then
  begin
    if not CopyFile(CacheZip, TempZip, False) then RaiseException('Unable to stage cached Node runtime');
    Log('compact-node-source=cache');
  end
  else
  begin
    DownloadTemporaryFile('{#NodeUrl}', '{#NodeZipName}', '{#NodeZipSha}', nil);
    if not CopyFile(TempZip, CacheZip, False) then RaiseException('Unable to cache Node runtime');
    Log('compact-node-source=download');
  end;
end;

procedure InstallCompactNodeRuntime();
var
  TempZip, ExtractDir, SourceNode, DestNode: String;
  ResultCode: Integer;
begin
  TempZip := ExpandConstant('{tmp}\{#NodeZipName}');
  ExtractDir := ExpandConstant('{tmp}\light-remote-node');
  DelTree(ExtractDir, True, True, True);
  ForceDirectories(ExtractDir);
  ExtractArchive(TempZip, ExtractDir, '', True, nil);
  SourceNode := ExtractDir + '\{#NodeFolder}\node.exe';
  DestNode := ExpandConstant('{app}\runtime\node.exe');
  if not FileExists(SourceNode) then RaiseException('Downloaded Node runtime is incomplete');
  ForceDirectories(ExtractFileDir(DestNode));
  if not CopyFile(SourceNode, DestNode, False) then RaiseException('Unable to install Node runtime');
  if (not Exec(DestNode, '--version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
    RaiseException('Installed Node runtime failed self-check');
  Log('compact-node-runtime=ready');
end;
#endif

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
#ifdef CompactNodeBootstrap
  try
    PrepareCompactNodeArchive();
  except
    Result := 'Unable to prepare the verified Node runtime: ' + GetExceptionMessage;
    Exit;
  end;
#endif
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
#ifdef CompactNodeBootstrap
Type: filesandordirs; Name: "{app}\runtime"
#endif
Type: filesandordirs; Name: "{localappdata}\Light Remote\Updater"
