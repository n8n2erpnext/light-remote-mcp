# Light Remote GoldABV2 T05A - isolated manual Windows QA Agent.
# Never install tasks/services or modify existing installed Gold and its state.
[CmdletBinding()]
param([ValidateSet('check','status','login','poll','connect','disconnect','daemon')][string]$Action = 'check')
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Node = Join-Path $Root 'runtime\node.exe'
$Agent = Join-Path $Root 'agent\device-agent\operator-agent.mjs'
$StateRoot = Join-Path $Root 'state'
$StateFile = Join-Path $StateRoot 'device.json'
$AuthFile = Join-Path $StateRoot 'wall-auth.json'
$Base = 'https://goldabv2.light-remote.thaiduy.digital'
$QaWallPort = 5591
$QaFleetPort = 5592

if (-not (Test-Path -LiteralPath $Node -PathType Leaf) -or
    -not (Test-Path -LiteralPath $Agent -PathType Leaf)) {
    throw 'QA package incomplete: node.exe or Agent is missing.'
}
$InstalledRoot = Join-Path $env:LOCALAPPDATA 'Programs\Light Remote MCP'
if ($Root.TrimEnd('\') -eq $InstalledRoot.TrimEnd('\')) {
    throw 'Refusing to run QA launcher from installed Gold directory.'
}
if ([IO.Path]::GetFullPath($StateFile) -eq
    [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.config\gpt-operator-agent\device.json'))) {
    throw 'Refusing to use the installed Agent state.'
}
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
function PortBusy([int]$Port) {
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -gt 0
}
if ($Action -eq 'check') {
    Write-Host 'Light Remote GoldABV2 Windows Desktop V4 isolated QA'
    Write-Host "Owner/Operator HTTPS: $Base"
    Write-Host "QA Local Wall (for setup only): http://127.0.0.1:$QaWallPort/"
    Write-Host 'Windows installed Gold remains on http://127.0.0.1:5491/'
    Write-Host 'Desktop V4 Open Wall STILL points at old Gold 5491 on this host.'
    Write-Host 'For this coexistence QA, test Desktop AI Access over native IPC only.'
    foreach ($Port in @(5491,5492,$QaWallPort,$QaFleetPort)) {
        Write-Host ("port {0}: {1}" -f $Port, $(if (PortBusy $Port) {'occupied'} else {'free'}))
    }
    Write-Host ("QA state: " + $(if (Test-Path $StateFile) {'present'} else {'not enrolled'}))
    exit 0
}
if ($Action -eq 'daemon') {
    foreach ($Port in @($QaWallPort,$QaFleetPort)) {
        if (PortBusy $Port) {throw "QA port $Port in use. Refusing to start."}
    }
    if (-not (Test-Path -LiteralPath $StateFile -PathType Leaf)) {
        throw 'QA not enrolled. Use -Action login, approve in GoldABV2 account, then poll.'
    }
    $S = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($S.enrollment.deviceId) -or
        [string]::IsNullOrWhiteSpace($S.enrollment.accountId) -or
        $S.enrollment.revoked -eq $true -or $S.enrollment.revokedAt) {
        throw 'QA device has no current approved GoldABV2 enrollment.'
    }
}
$EnvMap = @{
    OPERATOR_AGENT_BASE_URL = $Base
    OPERATOR_AGENT_HUB_URL = $Base
    OPERATOR_AGENT_STATE = $StateFile
    OPERATOR_AGENT_COMMAND_DIR = (Join-Path $StateRoot 'commands')
    OPERATOR_AGENT_WALL_AUTH_FILE = $AuthFile
    OPERATOR_AGENT_WALL_HOST = '127.0.0.1'
    OPERATOR_AGENT_WALL_PORT = "$QaWallPort"
    OPERATOR_FLEET_WALL_HOST = '127.0.0.1'
    OPERATOR_FLEET_WALL_PORT = "$QaFleetPort"
    LIGHT_REMOTE_UPDATE_STATE_DIR = (Join-Path $StateRoot 'update-runtime')
    OPERATOR_AGENT_MAX_SESSIONS = '1'
    LR_GOLD_INSTANCE_ID = 'abv2lab01'
    LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1 = '1'
    LR_GOLD_ABV2_LAB_SIGNED_WALL_B_ONLY = '1'
    LR_GOLD_ABV2_DESKTOP_ABV2_NATIVE_V4 = $(if ($Action -eq 'daemon') {'1'} else {'0'})
}
# Compatible with Windows PowerShell 5.1; no shell command interpolation,
# no system-wide environment mutation, no old Gold task or process changes.
$Start = New-Object System.Diagnostics.ProcessStartInfo
$Start.FileName = $Node
$Start.WorkingDirectory = (Join-Path $Root 'agent')
$Start.UseShellExecute = $false
$Start.CreateNoWindow = $false
$Start.Arguments = ('"' + $Agent + '" ' + $Action +
    $(if ($Action -eq 'login') {' --name "Windows GoldABV2 Desktop V4 QA" --no-wait'} else {''}))
foreach ($Name in $EnvMap.Keys) {$Start.EnvironmentVariables[$Name] = [string]$EnvMap[$Name]}
$Child = [System.Diagnostics.Process]::Start($Start)
if (-not $Child) {throw 'QA child process did not start.'}
Write-Host "GoldABV2 QA Agent: $Action / PID $($Child.Id)"
Write-Host "QA local ports $QaWallPort/$QaFleetPort; installed Gold 5491/5492 untouched."
$Child.WaitForExit()
if ($Action -eq 'login' -and $Child.ExitCode -eq 0 -and (Test-Path -LiteralPath $StateFile)) {
    $Current = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
    $EnrollmentId = [string]$Current.pendingEnrollment.enrollmentId
    if ($EnrollmentId -match '^enr_[A-Za-z0-9-]{20,80}$') {
        Write-Host "PUBLIC Activation URL: $Base/enroll?id=$EnrollmentId"
        Write-Host 'Ignore the LXD-internal 127.0.0.1 activation URL printed by the Lab Operator.'
    }
}
exit $Child.ExitCode
