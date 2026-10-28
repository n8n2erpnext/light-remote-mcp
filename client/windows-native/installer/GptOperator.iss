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
#ifndef WatchdogExe
  #error WatchdogExe must be defined
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

[Files]
Source: "{#WatchdogExe}"; DestName: "LightRemote.InstallWatchdog.exe"; Flags: dontcopy
#ifdef CompactNodeBootstrap
Source: "{#StageDir}\VERSION"; DestDir: "{app}"; Flags: ignoreversion; AfterInstall: InstallCompactNodeRuntime
#endif
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
Type: files; Name: "{app}\realremote-v2\GptOperator.RealRemoteV2.*"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Light Remote MCP"; ValueData: """{app}\GptOperator.Client.exe"" --background"; Flags: uninsdeletevalue

[Icons]
Name: "{group}\Light Remote MCP"; Filename: "{app}\GptOperator.Client.exe"; Parameters: "--launch"
Name: "{userdesktop}\Light Remote MCP"; Filename: "{app}\GptOperator.Client.exe"; Parameters: "--launch"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{app}\GptOperator.Client.exe"; Description: "Start Light Remote tray"; Flags: nowait postinstall skipifsilent

[Code]
var
  InstallTransactionStarted: Boolean;
  InstallTransactionCommitted: Boolean;
  HadAgentTaskBeforeInstall: Boolean;
  AgentTaskRecoveryXml: String;
  InstallerTxnDir: String;
  InstallerTxnCommitMarker: String;
  InstallerTxnVersionFile: String;
  InstallerTxnWatchdogExe: String;
  InstallerTxnWatchdogLog: String;
  InstallerTxnWatchdogTask: String;

function GetCurrentProcessId(): Cardinal;
external 'GetCurrentProcessId@kernel32.dll stdcall';

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
  CacheZip, TempZip, ScriptFile, ScriptText, WorkerFile, WorkerText, Args: String;
  ResultCode: Integer;
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
    // WinHTTP DownloadTemporaryFile may block silently while the runner is
    // waiting for Setup. Use a bounded Windows PowerShell HTTPS download,
    // then independently verify the pinned SHA-256 in Inno before caching.
    ScriptFile := ExpandConstant('{tmp}\light-remote-node-fetch.ps1');
    WorkerFile := ExpandConstant('{tmp}\light-remote-node-download-worker.ps1');
    WorkerText :=
      '$ErrorActionPreference=''Stop''' + #13#10 +
      'Invoke-WebRequest -Uri $env:LR_NODE_URL -OutFile $env:LR_NODE_OUT -UseBasicParsing -MaximumRedirection 8 -TimeoutSec 60 | Out-Null' + #13#10 +
      'if(-not(Test-Path -LiteralPath $env:LR_NODE_OUT) -or (Get-Item -LiteralPath $env:LR_NODE_OUT).Length -lt 1024){ exit 73 }' + #13#10 +
      'exit 0' + #13#10;
    if not SaveStringToFile(WorkerFile, WorkerText, False) then
      RaiseException('Unable to stage Node download worker');
    // Invoke-WebRequest -TimeoutSec limits network phases, not necessarily
    // wall time. A separate child process plus WaitForExit enforces that limit.
    ScriptText :=
      'param([string]$Url,[string]$Out,[string]$Worker)' + #13#10 +
      '$ErrorActionPreference=''Stop''' + #13#10 +
      '$env:LR_NODE_URL=$Url; $env:LR_NODE_OUT=$Out' + #13#10 +
      'for($attempt=1;$attempt -le 2;$attempt++){' + #13#10 +
      '  Remove-Item -LiteralPath $Out -Force -ErrorAction SilentlyContinue' + #13#10 +
      '  try{' + #13#10 +
      '    $psi=New-Object System.Diagnostics.ProcessStartInfo' + #13#10 +
      '    $psi.FileName=Join-Path $PSHOME ''powershell.exe''' + #13#10 +
      '    $psi.Arguments=''-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'' + $Worker + ''"''' + #13#10 +
      '    $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true' + #13#10 +
      '    $child=[System.Diagnostics.Process]::Start($psi)' + #13#10 +
      '    if(-not $child){throw ''node_download_worker_not_started''}' + #13#10 +
      '    try{' + #13#10 +
      '      if(-not $child.WaitForExit(75000)){' + #13#10 +
      '        try{$child.Kill()}catch{}' + #13#10 +
      '        $null=$child.WaitForExit(5000)' + #13#10 +
      '        throw ''node_download_wall_clock_timeout''' + #13#10 +
      '      }' + #13#10 +
      '      if($child.ExitCode -ne 0){throw (''node_download_worker_exit_''+$child.ExitCode)}' + #13#10 +
      '    }finally{$child.Dispose()}' + #13#10 +
      '    if(-not(Test-Path -LiteralPath $Out) -or (Get-Item -LiteralPath $Out).Length -lt 1024){throw ''empty_or_incomplete_node_archive''}' + #13#10 +
      '    exit 0' + #13#10 +
      '  }catch{' + #13#10 +
      '    if($attempt -eq 2){ exit 71 }' + #13#10 +
      '    Start-Sleep -Seconds 2' + #13#10 +
      '  }' + #13#10 +
      '}' + #13#10;
    if not SaveStringToFile(ScriptFile, ScriptText, False) then
      RaiseException('Unable to stage bounded Node downloader');
    Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptFile +
      '" -Url "{#NodeUrl}" -Out "' + TempZip + '" -Worker "' + WorkerFile + '"';
    Log('compact-node-download-bounded-begin');
    if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
      RaiseException('Verified Node runtime download failed (bounded attempts exit ' + IntToStr(ResultCode) + ')');
    if not FileExists(TempZip) then RaiseException('Downloaded Node runtime archive missing');
    if CompareText(GetSHA256OfFile(TempZip), '{#NodeZipSha}') <> 0 then
    begin
      DeleteFile(TempZip);
      RaiseException('Downloaded Node runtime SHA-256 mismatch');
    end;
    if not CopyFile(TempZip, CacheZip, False) then RaiseException('Unable to cache verified Node runtime');
    Log('compact-node-download-bounded-success');
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
  ResultCode, Attempt: Integer;
begin
  for Attempt := 1 to 4 do
  begin
    Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "GPTOperatorDeviceAgent"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Log('legacy-task-end attempt=' + IntToStr(Attempt) + ' exit=' + IntToStr(ResultCode));
    Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN "GPTOperatorDeviceAgent" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Log('legacy-task-delete attempt=' + IntToStr(Attempt) + ' exit=' + IntToStr(ResultCode));
    if ResultCode = 0 then
      Break;
    Sleep(250);
  end;
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "LightRemoteDeviceAgent"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "LightRemoteUpdater"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure PrepareInstallerTransaction();
var
  SourceVersion, TempWatchdog: String;
begin
  InstallerTxnDir := ExpandConstant('{localappdata}\\Light Remote\\Updater\\state\\installer-txn') + '\\' + IntToStr(GetCurrentProcessId());
  InstallerTxnWatchdogTask := 'LightRemoteInstallWatchdog-' + IntToStr(GetCurrentProcessId());
  ForceDirectories(InstallerTxnDir);
  InstallerTxnCommitMarker := InstallerTxnDir + '\\commit.ok';
  InstallerTxnVersionFile := InstallerTxnDir + '\\previous-version.txt';
  InstallerTxnWatchdogExe := InstallerTxnDir + '\\LightRemote.InstallWatchdog.exe';
  InstallerTxnWatchdogLog := InstallerTxnDir + '\\watchdog.log';
  DeleteFile(InstallerTxnCommitMarker);
  DeleteFile(InstallerTxnWatchdogLog);
  ExtractTemporaryFile('LightRemote.InstallWatchdog.exe');
  TempWatchdog := ExpandConstant('{tmp}\\LightRemote.InstallWatchdog.exe');
  if not CopyFile(TempWatchdog, InstallerTxnWatchdogExe, False) then
    RaiseException('Unable to stage Light Remote native installer watchdog');
  SourceVersion := ExpandConstant('{app}\\VERSION');
  if FileExists(SourceVersion) then
  begin
    if not CopyFile(SourceVersion, InstallerTxnVersionFile, False) then
      RaiseException('Unable to capture installed Light Remote version');
  end
  else
    SaveStringToFile(InstallerTxnVersionFile, '', False);
end;

procedure StartInstallerWatchdog();
var
  Args: String;
  ResultCode: Integer;
begin
  Args := '--register --installer-pid ' + IntToStr(GetCurrentProcessId()) +
    ' --commit-marker "' + InstallerTxnCommitMarker +
    '" --task-xml "' + AgentTaskRecoveryXml +
    '" --version-file "' + InstallerTxnVersionFile +
    '" --install-root "' + ExpandConstant('{app}') +
    '" --log-path "' + InstallerTxnWatchdogLog +
    '" --task-name "LightRemoteDeviceAgent"' +
    ' --watchdog-task "' + InstallerTxnWatchdogTask + '"';
  if (not Exec(InstallerTxnWatchdogExe, Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
    RaiseException('Unable to arm Light Remote native installer watchdog (exit ' + IntToStr(ResultCode) + ')');
  Log('light-remote-install-transaction-native-watchdog-armed');
end;

procedure CaptureAgentTaskRecovery();
var
  ScriptFile, ScriptText, Args: String;
  ResultCode: Integer;
begin
  AgentTaskRecoveryXml := InstallerTxnDir + '\LightRemoteDeviceAgent.xml';
  DeleteFile(AgentTaskRecoveryXml);
  ScriptFile := ExpandConstant('{tmp}\\light-remote-capture-agent-task.ps1');
  ScriptText :=
    'param([string]$Out)' + #13#10 +
    '$ErrorActionPreference=''Stop''' + #13#10 +
    '$t=Get-ScheduledTask -TaskName ''LightRemoteDeviceAgent'' -ErrorAction SilentlyContinue' + #13#10 +
    'if($null -eq $t){ exit 3 }' + #13#10 +
    'Export-ScheduledTask -TaskName ''LightRemoteDeviceAgent'' | Set-Content -LiteralPath $Out -Encoding Unicode' + #13#10 +
    'exit 0' + #13#10;
  if not SaveStringToFile(ScriptFile, ScriptText, False) then
    RaiseException('Unable to stage Light Remote task recovery capture helper');
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptFile + '" -Out "' + AgentTaskRecoveryXml + '"';
  if not Exec(ExpandConstant('{sys}\\WindowsPowerShell\\v1.0\\powershell.exe'), Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Unable to inspect existing Light Remote background task');
  if ResultCode = 0 then
    HadAgentTaskBeforeInstall := True
  else if ResultCode = 3 then
    HadAgentTaskBeforeInstall := False
  else
    RaiseException('Unable to capture existing Light Remote background task (exit ' + IntToStr(ResultCode) + ')');
  Log('light-remote-install-transaction-captured-task hadTask=' + IntToStr(Ord(HadAgentTaskBeforeInstall)));
end;

procedure RestoreAgentTaskRecovery();
var
  ResultCode: Integer;
begin
  if HadAgentTaskBeforeInstall and FileExists(AgentTaskRecoveryXml) then
  begin
    Exec(ExpandConstant('{sys}\\schtasks.exe'), '/Create /TN "LightRemoteDeviceAgent" /XML "' + AgentTaskRecoveryXml + '" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode <> 0 then
      Log('light-remote-install-transaction-task-restore-failed exit=' + IntToStr(ResultCode));
    Exec(ExpandConstant('{sys}\\schtasks.exe'), '/Run /TN "LightRemoteDeviceAgent"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Log('light-remote-install-transaction-task-restart exit=' + IntToStr(ResultCode));
  end
  else
  begin
    Exec(ExpandConstant('{sys}\\schtasks.exe'), '/End /TN "LightRemoteDeviceAgent"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{sys}\\schtasks.exe'), '/Delete /TN "LightRemoteDeviceAgent" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Log('light-remote-install-transaction-partial-task-cleaned');
  end;
end;

procedure RunAgentInstallTransaction();
var
  ScriptFile, Args: String;
  ResultCode: Integer;
begin
  ScriptFile := ExpandConstant('{app}\\agent\\device-agent\\install-windows-task.ps1');
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptFile + '" -InstallRoot "' + ExpandConstant('{app}') + '"';
  if (not Exec(ExpandConstant('{sys}\\WindowsPowerShell\\v1.0\\powershell.exe'), Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
    RaiseException('Light Remote post-install task/health gate failed (exit ' + IntToStr(ResultCode) + ')');
#ifdef InstallerTxnFailpoint
  RaiseException('Light Remote installer transaction self-test failpoint');
#endif
end;

procedure QuiesceInstalledRuntime();
var
  ScriptFile, ScriptText, AppExe, NodeExe, Args: String;
  ResultCode: Integer;
begin
  AppExe := ExpandConstant('{app}\GptOperator.Client.exe');
  NodeExe := ExpandConstant('{app}\runtime\node.exe');
  ScriptFile := ExpandConstant('{tmp}\light-remote-preinstall-quiesce.ps1');
  ScriptText :=
    'param([string]$AppExe,[string]$NodeExe)' + #13#10 +
    '$ErrorActionPreference=''SilentlyContinue''' + #13#10 +
    '$targets=@($AppExe,$NodeExe)' + #13#10 +
    '$deadline=(Get-Date).AddSeconds(10)' + #13#10 +
    'do {' + #13#10 +
    '  $p=@(Get-Process -Name ''GptOperator.Client'',''node'' -ErrorAction SilentlyContinue | Where-Object { try { $targets -contains $_.Path } catch { $false } })' + #13#10 +
    '  if(-not $p){ exit 0 }' + #13#10 +
    '  $p | Stop-Process -Force -ErrorAction SilentlyContinue' + #13#10 +
    '  Start-Sleep -Milliseconds 200' + #13#10 +
    '} while((Get-Date) -lt $deadline)' + #13#10 +
    '$left=@(Get-Process -Name ''GptOperator.Client'',''node'' -ErrorAction SilentlyContinue | Where-Object { try { $targets -contains $_.Path } catch { $false } })' + #13#10 +
    'if($left){ exit 41 }' + #13#10 +
    'exit 0' + #13#10;
  if not SaveStringToFile(ScriptFile, ScriptText, False) then
    RaiseException('Unable to stage Light Remote runtime quiesce helper');
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptFile + '" -AppExe "' + AppExe + '" -NodeExe "' + NodeExe + '"';
  if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
    RaiseException('Unable to stop the installed Light Remote runtime before replacement (exit ' + IntToStr(ResultCode) + ')');
  Log('light-remote-runtime-quiesced');
end;

procedure CacheRollbackInstaller();
var
  RollbackDir, RollbackFile, SourceInstaller: String;
  Attempt: Integer;
  Cached: Boolean;
begin
  RollbackDir := ExpandConstant('{localappdata}\Light Remote\Updater\rollback');
  if not ForceDirectories(RollbackDir) then
    RaiseException('Unable to create rollback installer cache directory: ' + RollbackDir);
  RollbackFile := RollbackDir + '\Light-Remote-MCP-Setup-{#AppVersion}-x64.exe';
  SourceInstaller := ExpandConstant('{srcexe}');
  if CompareText(SourceInstaller, RollbackFile) = 0 then
    Exit;

  Cached := False;
  for Attempt := 1 to 6 do
  begin
    Cached := CopyFile(SourceInstaller, RollbackFile, False);
    if Cached and FileExists(RollbackFile) then
    begin
      Log('light-remote-rollback-cache-ready attempt=' + IntToStr(Attempt) + ' path=' + RollbackFile);
      Exit;
    end;
    Log('light-remote-rollback-cache-retry attempt=' + IntToStr(Attempt) + ' path=' + RollbackFile);
    Sleep(500);
  end;

  RaiseException('Unable to cache rollback installer: ' + RollbackFile);

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
  PrepareInstallerTransaction();
  CaptureAgentTaskRecovery();
  StartInstallerWatchdog();
  InstallTransactionStarted := True;
  StopAndRemoveLegacyTask();
  QuiesceInstalledRuntime();
  RemoveLegacyAutostart();
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    RunAgentInstallTransaction();
    if not SaveStringToFile(InstallerTxnCommitMarker, 'commit', False) then
      RaiseException('Unable to commit Light Remote installer transaction');
    InstallTransactionCommitted := True;
    CacheRollbackInstaller();
    Log('light-remote-install-transaction-committed');
  end;
end;

procedure DeinitializeSetup();
begin
  if InstallTransactionStarted and (not InstallTransactionCommitted) then
  begin
    Log('light-remote-install-transaction-abort-watchdog-armed');
  end;
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
