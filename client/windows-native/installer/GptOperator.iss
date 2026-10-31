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
AppName=Light Remote
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
DisableWelcomePage=yes
DisableDirPage=yes
DisableReadyPage=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\GptOperator.Client.exe
UninstallDisplayName=Light Remote
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
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Windows shortcuts:"

[Run]
Filename: "{app}\GptOperator.Client.exe"; Description: "Start Light Remote tray"; Flags: nowait postinstall skipifsilent

[Code]
// Moryqa Windows installer/uninstaller v2: per-user setup, native light/dark
// palette, and Desktop shortcut checked by default. Application identity stays
// on the original AppId to preserve upgrades and rollback.
function LightRemoteDarkWindowsTheme(): Boolean;
var
  LightApps: Cardinal;
begin
  Result := RegQueryDWordValue(HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize',
    'AppsUseLightTheme', LightApps) and (LightApps = 0);
end;

// This is an actual custom Inno wizard page, not just a renamed stock
// WelcomeLabel. Windows-light defaults to Moryqa #F5F8FD / #162B4C.
var
  BrandedWelcomePage: TWizardPage;
  BrandedDesktopShortcut: TNewCheckBox;

procedure AddBrandedText(Page: TWizardPage; TextValue: String;
  LeftValue, TopValue, WidthValue, FontSize: Integer; TextColor: TColor);
var
  L: TNewStaticText;
begin
  L := TNewStaticText.Create(Page);
  L.Parent := Page.Surface;
  L.Left := ScaleX(LeftValue);
  L.Top := ScaleY(TopValue);
  L.Width := ScaleX(WidthValue);
  L.Height := ScaleY(35);
  L.AutoSize := False;
  L.WordWrap := True;
  L.Caption := TextValue;
  L.Font.Name := 'Segoe UI';
  L.Font.Size := FontSize;
  L.Font.Color := TextColor;
end;

procedure BuildBrandedWelcomePage();
var
  Card: TPanel;
  IsDark: Boolean;
  Fore, Muted, Surface: TColor;
begin
  IsDark := LightRemoteDarkWindowsTheme();
  BrandedWelcomePage := CreateCustomPage(wpWelcome,
    'Light Remote for Windows', 'Your desktop, available to your AI.');
  if IsDark then
  begin
    Fore := clWhite;
    Muted := $00C3B1A1;
    Surface := $00221A14;
    BrandedWelcomePage.Surface.Color := $0017110D;
  end
  else
  begin
    Fore := $004C2B16;
    Muted := $008B7564;
    Surface := $00FCF9F5;
    BrandedWelcomePage.Surface.Color := clWhite;
  end;
  AddBrandedText(BrandedWelcomePage, 'Install Light Remote',
    16, 10, 440, 24, Fore);
  AddBrandedText(BrandedWelcomePage,
    'Secure desktop access for your authorized AI agents.',
    16, 54, 440, 11, Muted);
  Card := TPanel.Create(BrandedWelcomePage);
  Card.Parent := BrandedWelcomePage.Surface;
  Card.Left := ScaleX(15);
  Card.Top := ScaleY(93);
  Card.Width := BrandedWelcomePage.SurfaceWidth - ScaleX(30);
  Card.Height := ScaleY(93);
  Card.BevelOuter := bvNone;
  Card.Color := Surface;
  // These labels belong to the page surface and remain readable on themes.
  AddBrandedText(BrandedWelcomePage, '01  Device installation',
    29, 105, 390, 15, Fore);
  AddBrandedText(BrandedWelcomePage,
    'Per-user setup. No administrator elevation required.',
    29, 137, 414, 11, Muted);
  BrandedDesktopShortcut := TNewCheckBox.Create(BrandedWelcomePage);
  BrandedDesktopShortcut.Parent := BrandedWelcomePage.Surface;
  BrandedDesktopShortcut.Left := ScaleX(20);
  BrandedDesktopShortcut.Top := ScaleY(198);
  BrandedDesktopShortcut.Width := BrandedWelcomePage.SurfaceWidth - ScaleX(38);
  BrandedDesktopShortcut.Height := ScaleY(29);
  BrandedDesktopShortcut.Caption := 'Create Desktop shortcut';
  BrandedDesktopShortcut.Font.Name := 'Segoe UI';
  BrandedDesktopShortcut.Font.Size := 11;
  BrandedDesktopShortcut.Font.Color := Fore;
  BrandedDesktopShortcut.Checked := True;
  AddBrandedText(BrandedWelcomePage,
    'Starts with Windows  ·  Keeps your linked device identity',
    20, 234, 430, 10, Muted);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := PageID = wpSelectTasks;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = BrandedWelcomePage.ID then
  begin
    if BrandedDesktopShortcut.Checked then WizardSelectTasks('desktopicon')
    else WizardSelectTasks('!desktopicon');
  end;
end;



// Full three-phase Windows installation presentation, not just a custom welcome.
// Real underlying Inno install transaction, progress and Finish RunList are kept.
var
  BrandedInstallingPanel: TPanel;
  BrandedFinishedPanel: TPanel;

procedure AddPhaseLabel(ParentControl: TWinControl; CaptionText: String;
  LeftValue, TopValue, WidthValue, HeightValue, FontSize: Integer;
  TextColor: TColor; IsBold: Boolean);
var
  L: TNewStaticText;
begin
  L := TNewStaticText.Create(WizardForm);
  L.Parent := ParentControl;
  L.Left := ScaleX(LeftValue);
  L.Top := ScaleY(TopValue);
  L.Width := ScaleX(WidthValue);
  L.Height := ScaleY(HeightValue);
  L.AutoSize := False;
  L.WordWrap := True;
  L.Caption := CaptionText;
  L.Font.Name := 'Segoe UI';
  L.Font.Size := FontSize;
  L.Font.Color := TextColor;
  if IsBold then L.Font.Style := [fsBold];
end;

procedure BuildInstallPhasePanel(Panel: TPanel; IsFinished: Boolean);
var
  Header, Side, Surface, Accent: TColor;
  LabelColor, MutedColor: TColor;
  Inner: TPanel;
  IsDark: Boolean;
begin
  IsDark := LightRemoteDarkWindowsTheme();
  if IsDark then
  begin
    Header := $0017110D;
    Side := $002C2016;
    Surface := $00221A14;
    LabelColor := clWhite;
    MutedColor := $00C3B1A1;
  end
  else
  begin
    Header := clWhite;
    Side := $00FFF1EA;
    Surface := $00FCF9F5;
    LabelColor := $004C2B16;
    MutedColor := $008B7564;
  end;
  Accent := $00F05D20;

  Panel.Parent := WizardForm;
  Panel.SetBounds(0, 0, WizardForm.ClientWidth,
    WizardForm.CancelButton.Top - ScaleY(12));
  Panel.BevelOuter := bvNone;
  Panel.Color := Header;
  Panel.Visible := False;

  Inner := TPanel.Create(WizardForm);
  Inner.Parent := Panel;
  Inner.SetBounds(0, 0, ScaleX(185), Panel.Height);
  Inner.BevelOuter := bvNone;
  Inner.Color := Side;
  AddPhaseLabel(Inner, 'LR', 21, 29, 82, 42, 29, Accent, True);
  AddPhaseLabel(Inner, 'Light Remote', 21, 80, 152, 30, 18,
    LabelColor, True);
  AddPhaseLabel(Inner, 'WINDOWS SETUP', 22, 123, 150, 20, 9,
    MutedColor, True);
  AddPhaseLabel(Inner, '1   Welcome', 22, 192, 152, 25, 12,
    MutedColor, False);
  AddPhaseLabel(Inner, '2   Install & verify', 22, 237, 160, 26, 12,
    IsFinished ? MutedColor : Accent, not IsFinished);
  AddPhaseLabel(Inner, '3   Ready to use', 22, 283, 160, 26, 12,
    IsFinished ? Accent : MutedColor, IsFinished);
  AddPhaseLabel(Inner, 'Your desktop,', 22, 354, 155, 23, 11,
    MutedColor, False);
  AddPhaseLabel(Inner, 'available to your AI.', 22, 381, 157, 50, 11,
    MutedColor, False);

  // Real page status, not a static mock. The original Inno transaction
  // remains authoritative; these cards only present its existing controls.
  if IsFinished then
  begin
    AddPhaseLabel(Panel, 'Application installed', 218, 52, 405, 40, 25,
      LabelColor, True);
    AddPhaseLabel(Panel, 'Light Remote is ready', 221, 109, 415, 31, 16,
      Accent, True);
    AddPhaseLabel(Panel,
      'Your agent and desktop application have been installed. ' +
      'Your existing device identity is preserved.',
      221, 164, 406, 90, 12, MutedColor, False);
    AddPhaseLabel(Panel, 'Ready to use', 221, 277, 415, 35, 16,
      LabelColor, True);
    AddPhaseLabel(Panel, 'Open Local Wall to link or manage your device.',
      221, 327, 410, 55, 12, MutedColor, False);
    AddPhaseLabel(Panel,
      'Start Light Remote tray is selected by default.',
      221, 386, 415, 26, 11, MutedColor, False);
  end
  else
  begin
    AddPhaseLabel(Panel, 'Installing your desktop agent',
      218, 52, 430, 62, 22, LabelColor, True);
    AddPhaseLabel(Panel,
      'Application files  ·  Verify Node runtime  ·  Register Agent',
      221, 136, 418, 54, 12, MutedColor, False);
    AddPhaseLabel(Panel, 'Installation progress',
      221, 221, 412, 29, 14, LabelColor, True);
    AddPhaseLabel(Panel,
      'Verified files, runtime integrity and updater registration.',
      221, 370, 420, 50, 11, MutedColor, False);
    AddPhaseLabel(Panel,
      'Installation is recoverable; do not turn off Windows during setup.',
      221, 421, 425, 28, 10, MutedColor, False);
  end;
end;

procedure InitializeBrandedInstallPhases();
begin
  BrandedInstallingPanel := TPanel.Create(WizardForm);
  BuildInstallPhasePanel(BrandedInstallingPanel, False);
  BrandedFinishedPanel := TPanel.Create(WizardForm);
  BuildInstallPhasePanel(BrandedFinishedPanel, True);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  // Inno still manages update/rollback, progress, and [Run] checkbox.
  BrandedInstallingPanel.Visible := CurPageID = wpInstalling;
  BrandedFinishedPanel.Visible := CurPageID = wpFinished;

  if CurPageID = wpInstalling then
  begin
    WizardForm.ProgressGauge.Parent := BrandedInstallingPanel;
    WizardForm.ProgressGauge.SetBounds(ScaleX(221), ScaleY(274),
      BrandedInstallingPanel.Width - ScaleX(245), ScaleY(23));
    WizardForm.StatusLabel.Parent := BrandedInstallingPanel;
    WizardForm.StatusLabel.SetBounds(ScaleX(221), ScaleY(307),
      BrandedInstallingPanel.Width - ScaleX(245), ScaleY(38));
    WizardForm.FilenameLabel.Parent := BrandedInstallingPanel;
    WizardForm.FilenameLabel.SetBounds(ScaleX(221), ScaleY(342),
      BrandedInstallingPanel.Width - ScaleX(245), ScaleY(24));
    BrandedInstallingPanel.BringToFront();
  end;
  if CurPageID = wpFinished then
  begin
    WizardForm.RunList.Parent := BrandedFinishedPanel;
    WizardForm.RunList.SetBounds(ScaleX(221), ScaleY(414),
      BrandedFinishedPanel.Width - ScaleX(240), ScaleY(38));
    BrandedFinishedPanel.BringToFront();
  end;
end;


procedure InitializeWizard();
begin
  BuildBrandedWelcomePage();
  InitializeBrandedInstallPhases();
  WizardForm.WelcomeLabel1.Caption := 'Install Light Remote';
  WizardForm.WelcomeLabel2.Caption :=
    'Your desktop, available to your AI.' + #13#10 + #13#10 +
    'Per-user installation — no administrator elevation required.' + #13#10 +
    'Run at Windows sign-in and create a Desktop shortcut (selected by default).' + #13#10 +
    'Your device identity remains under your control.';
  if LightRemoteDarkWindowsTheme() then
  begin
    // Use the same dark Figma status surfaces as the native Windows Tray.
    WizardForm.Color := $0017110D;
    WizardForm.MainPanel.Color := $0017110D;
    WizardForm.InnerPage.Color := $0017110D;
    WizardForm.WelcomeLabel1.Font.Color := clWhite;
    WizardForm.WelcomeLabel2.Font.Color := $00B9A89B;
    WizardForm.PageNameLabel.Font.Color := clWhite;
    WizardForm.PageDescriptionLabel.Font.Color := $00B9A89B;
  end;
end;

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
