[CmdletBinding()]
param(
  [string]$DeviceName = $env:COMPUTERNAME,
  [string]$Policy = 'windows-dev'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This setup must run on Windows.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run PowerShell as Administrator, then run this setup again.'
}
$RootDir = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $RootDir 'runtime\node.exe'
$Agent = Join-Path $PSScriptRoot 'operator-agent.mjs'
$Installer = Join-Path $PSScriptRoot 'install-windows-task.ps1'
if (-not (Test-Path $Node)) { throw "Bundled Node runtime missing: $Node" }
if (-not (Test-Path $Agent)) { throw "Agent missing: $Agent" }
if (-not (Test-Path $Installer)) { throw "Task installer missing: $Installer" }
function Invoke-Agent([string[]]$Arguments) {
  $output = & $Node $Agent @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($output | Out-String).Trim()) }
  return ($output | Out-String).Trim()
}
$statusText = Invoke-Agent @('status')
$status = $statusText | ConvertFrom-Json
if (-not $status.enrolled) {
  $loginText = Invoke-Agent @('login','--no-wait','--name',$DeviceName,'--policy',$Policy)
  Write-Host $loginText
  $url = [regex]::Match($loginText,'Activation URL:\s*(\S+)').Groups[1].Value
  $code = [regex]::Match($loginText,'Device code:\s*([A-Z0-9-]+)').Groups[1].Value
  if (-not $url -or -not $code) { throw 'Enrollment output did not contain activation URL/device code.' }
  Write-Host "\nApprove this device in the browser. Code: $code" -ForegroundColor Yellow
  Start-Process $url | Out-Null
  $deadline = (Get-Date).AddMinutes(10)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $pollText = Invoke-Agent @('poll')
    try { $poll = $pollText | ConvertFrom-Json } catch { continue }
    if ($poll.state -eq 'approved') { break }
    if ($poll.state -in @('expired','cancelled','replaced')) { throw "Enrollment ended with state=$($poll.state)" }
  }
  $statusText = Invoke-Agent @('status')
  $status = $statusText | ConvertFrom-Json
  if (-not $status.enrolled) { throw 'Enrollment was not approved before timeout.' }
}
Write-Host "Enrolled deviceId=$($status.deviceId) adapter=$($status.platformAdapter)" -ForegroundColor Green
Write-Host 'Windows DEV mode uses a per-user Scheduled Task. No account password or PIN is required.' -ForegroundColor Cyan
& $Installer
if ($LASTEXITCODE -ne 0) { throw 'Windows Scheduled Task installer failed.' }
$task = Get-ScheduledTask -TaskName 'GPTOperatorDeviceAgent' -ErrorAction Stop
if ($task.State -ne 'Running') { throw "Scheduled Task state is $($task.State), expected Running." }
Write-Host 'GPT Operator Windows leaf is installed and running in the signed-in user session.' -ForegroundColor Green
Write-Host 'Return to ChatGPT; the device should appear online in the ARM Hub within ~20 seconds.'
