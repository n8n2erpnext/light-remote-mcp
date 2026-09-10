#ifndef StageDir
  #error StageDir must be defined
#endif
#ifndef OutputDir
  #error OutputDir must be defined
#endif
#ifndef AppVersion
  #define AppVersion "0.9.0-dev"
#endif

[Setup]
AppId={{A8D073F5-9792-4FA6-96A6-13C565F255F3}
AppName=GPT Operator
AppVersion={#AppVersion}
AppPublisher=Thai Duy
DefaultDirName={localappdata}\Programs\GPT Operator
DefaultGroupName=GPT Operator
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=GPT-Operator-Setup-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\GptOperator.Client.exe
AppMutex=Local\GPT_OPERATOR_CLIENT_V09
[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "GPT Operator"; ValueData: """{app}\GptOperator.Client.exe"" --background"; Flags: uninsdeletevalue

[Icons]
Name: "{group}\GPT Operator"; Filename: "{app}\GptOperator.Client.exe"
Name: "{userdesktop}\GPT Operator"; Filename: "{app}\GptOperator.Client.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{app}\GptOperator.Client.exe"; Description: "Start GPT Operator"; Flags: nowait postinstall skipifsilent

[Code]
procedure StopAndRemoveLegacyTask();
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "GPTOperatorDeviceAgent"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN "GPTOperatorDeviceAgent" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CacheRollbackInstaller();
var
  RollbackDir, RollbackFile: String;
begin
  RollbackDir := ExpandConstant('{localappdata}\GPTOperatorAgent\updates\rollback');
  ForceDirectories(RollbackDir);
  RollbackFile := RollbackDir + '\GPT-Operator-Setup-{#AppVersion}-x64.exe';
  if CompareText(ExpandConstant('{srcexe}'), RollbackFile) <> 0 then
    CopyFile(ExpandConstant('{srcexe}'), RollbackFile, False);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopAndRemoveLegacyTask();
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    CacheRollbackInstaller();
end;
