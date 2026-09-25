#ifndef StageDir
  #error StageDir must be defined
#endif
#ifndef OutputDir
  #error OutputDir must be defined
#endif
#ifndef AppVersion
  #define AppVersion "0.9.0-dev"
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
UninstallDisplayIcon={app}\LightRemote.Client.exe
SetupIconFile={#StageDir}\Assets\light-remote.ico
AppMutex=Local\GPT_OPERATOR_CLIENT_V09
[Files]
#ifdef CompactNodeBootstrap
Source: "{#StageDir}\VERSION"; DestDir: "{app}"; Flags: ignoreversion; AfterInstall: InstallCompactNodeRuntime
#endif
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: files; Name: "{app}\GptOperator.Client.exe"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Light Remote MCP"; ValueData: """{app}\LightRemote.Client.exe"" --background"; Flags: uninsdeletevalue

[Icons]
Name: "{group}\Light Remote MCP"; Filename: "{app}\LightRemote.Client.exe"; Parameters: "--launch"
Name: "{userdesktop}\Light Remote MCP"; Filename: "{app}\LightRemote.Client.exe"; Parameters: "--launch"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\agent\device-agent\install-windows-task.ps1"" -InstallRoot ""{app}"""; Flags: runhidden waituntilterminated
Filename: "{app}\LightRemote.Client.exe"; Description: "Start Light Remote tray"; Flags: nowait postinstall skipifsilent

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

procedure QuiesceInstalledRuntime();
var
  ScriptFile, ScriptText, AppExe, LegacyAppExe, NodeExe, Args: String;
  ResultCode: Integer;
begin
  AppExe := ExpandConstant('{app}\LightRemote.Client.exe');
  LegacyAppExe := ExpandConstant('{app}\GptOperator.Client.exe');
  NodeExe := ExpandConstant('{app}\runtime\node.exe');
  ScriptFile := ExpandConstant('{tmp}\light-remote-preinstall-quiesce.ps1');
  ScriptText :=
    'param([string]$AppExe,[string]$LegacyAppExe,[string]$NodeExe)' + #13#10 +
    '$ErrorActionPreference=''SilentlyContinue''' + #13#10 +
    '$targets=@($AppExe,$LegacyAppExe,$NodeExe)' + #13#10 +
    '$deadline=(Get-Date).AddSeconds(10)' + #13#10 +
    'do {' + #13#10 +
    '  $p=@(Get-Process -Name ''LightRemote.Client'',''GptOperator.Client'',''node'' -ErrorAction SilentlyContinue | Where-Object { try { $targets -contains $_.Path } catch { $false } })' + #13#10 +
    '  if(-not $p){ exit 0 }' + #13#10 +
    '  $p | Stop-Process -Force -ErrorAction SilentlyContinue' + #13#10 +
    '  Start-Sleep -Milliseconds 200' + #13#10 +
    '} while((Get-Date) -lt $deadline)' + #13#10 +
    '$left=@(Get-Process -Name ''LightRemote.Client'',''GptOperator.Client'',''node'' -ErrorAction SilentlyContinue | Where-Object { try { $targets -contains $_.Path } catch { $false } })' + #13#10 +
    'if($left){ exit 41 }' + #13#10 +
    'exit 0' + #13#10;
  if not SaveStringToFile(ScriptFile, ScriptText, False) then
    RaiseException('Unable to stage Light Remote runtime quiesce helper');
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptFile + '" -AppExe "' + AppExe + '" -LegacyAppExe "' + LegacyAppExe + '" -NodeExe "' + NodeExe + '"';
  if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
    RaiseException('Unable to stop the installed Light Remote runtime before replacement (exit ' + IntToStr(ResultCode) + ')');
  Log('light-remote-runtime-quiesced');
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
  QuiesceInstalledRuntime();
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
