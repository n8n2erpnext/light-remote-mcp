[CmdletBinding()]
param(
  [string]$WinSWPath = (Join-Path $PSScriptRoot 'winsw.exe'),
  [PSCredential]$ServiceCredential
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer must run on Windows.' }
$RootDir = Split-Path -Parent $PSScriptRoot
$RightsHelper = Join-Path $PSScriptRoot 'windows-service-rights.ps1'
if (-not (Test-Path $RightsHelper)) { throw "Windows service-rights helper missing: $RightsHelper" }
. $RightsHelper
$StateFile = Join-Path $env:USERPROFILE '.config\gpt-operator-agent\device.json'
if (-not (Test-Path $StateFile)) { throw 'Device is not enrolled yet. Run operator-agent login first.' }
if (-not (Test-Path $WinSWPath)) { throw "WinSW wrapper not found: $WinSWPath" }
if (-not $ServiceCredential) {
  $defaultUser = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
  $ServiceCredential = Get-Credential -UserName $defaultUser -Message 'Credential for GPT Operator Device Agent service'
}
$credentialLeaf = (($ServiceCredential.UserName -split '\\')[-1] -split '@')[0]
if ($credentialLeaf -ne $env:USERNAME) { throw 'Service credential must be the enrolled device owner for this developer install.' }
$serviceAccountSid = Grant-GptServiceLogonRight -AccountName $ServiceCredential.UserName
Write-Host "Granted SeServiceLogonRight to $($ServiceCredential.UserName) ($serviceAccountSid)"
$BundledNode = Join-Path $RootDir 'runtime\node.exe'
$NodeSource = if (Test-Path $BundledNode) { $BundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
$AppDir = Join-Path $env:LOCALAPPDATA 'GPTOperatorAgent'
$AgentDir = Join-Path $AppDir 'device-agent'
$AdapterDir = Join-Path $AgentDir 'platform-adapters'
$LibDir = Join-Path $AppDir 'lib'
$RuntimeDir = Join-Path $AppDir 'runtime'
$NodeBin = Join-Path $RuntimeDir 'node.exe'
$ServiceName = 'GPTOperatorDeviceAgent'
$ServiceExe = Join-Path $AppDir 'gpt-operator-device-agent.exe'
$ServiceXml = Join-Path $AppDir 'gpt-operator-device-agent.xml'
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force }
  & sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Milliseconds 750
}
New-Item -ItemType Directory -Force -Path $AgentDir,$AdapterDir,$LibDir,$RuntimeDir | Out-Null
Copy-Item (Join-Path $RootDir 'device-agent\operator-agent.mjs') (Join-Path $AgentDir 'operator-agent.mjs') -Force
Copy-Item (Join-Path $RootDir 'device-agent\platform-adapters\*.mjs') $AdapterDir -Force
Copy-Item (Join-Path $RootDir 'lib\device-proof.mjs') (Join-Path $LibDir 'device-proof.mjs') -Force
Copy-Item $NodeSource $NodeBin -Force
Copy-Item $WinSWPath $ServiceExe -Force
$nodeXml = [System.Security.SecurityElement]::Escape($NodeBin)
$agentXml = [System.Security.SecurityElement]::Escape((Join-Path $AgentDir 'operator-agent.mjs'))
$homeXml = [System.Security.SecurityElement]::Escape($env:USERPROFILE)
$logXml = [System.Security.SecurityElement]::Escape((Join-Path $AppDir 'logs'))
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir 'logs') | Out-Null
$xml = @"
<service>
  <id>$ServiceName</id>
  <name>GPT Operator Device Agent</name>
  <description>Outbound GPT operator leaf agent running as the enrolled Windows user.</description>
  <executable>$nodeXml</executable>
  <arguments>&quot;$agentXml&quot; daemon</arguments>
  <env name="HOME" value="$homeXml" />
  <env name="USERPROFILE" value="$homeXml" />
  <stoptimeout>15 sec</stoptimeout>
  <onfailure action="restart" delay="5 sec" />
  <logpath>$logXml</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>4</keepFiles>
  </log>
</service>
"@
Set-Content -LiteralPath $ServiceXml -Value $xml -Encoding UTF8
$binary = '"' + $ServiceExe + '"'
New-Service -Name $ServiceName -BinaryPathName $binary -DisplayName 'GPT Operator Device Agent' -StartupType Automatic -Credential $ServiceCredential | Out-Null
try {
  Start-Service -Name $ServiceName
} catch {
  $startError = $_.Exception.Message
  $diagnostic = Get-GptServiceStartDiagnostic -ServiceName $ServiceName -AppDir $AppDir
  Write-Host '--- Windows service start diagnostic ---' -ForegroundColor Yellow
  Write-Host ($diagnostic | ConvertTo-Json -Depth 6)
  throw "Service was installed but did not start after SeServiceLogonRight was granted. $startError"
}
$service = Get-Service -Name $ServiceName
$StateDir = Split-Path -Parent $StateFile
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $StateDir /inheritance:r /grant:r "*$($userSid):(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict device-state ACL.' }
Write-Host "Installed $ServiceName as $($ServiceCredential.UserName); status=$($service.Status)"
Write-Host "State remains at $StateFile; no service password is written to the WinSW XML."
