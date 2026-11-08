param([Parameter(Mandatory = $true)][string]$InstallRoot,
      [Parameter(Mandatory = $true)][string]$EvidenceDir)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot)
$evidence = [IO.Path]::GetFullPath($EvidenceDir)
$exe = Join-Path $root 'LightRemote.exe'
$node = Join-Path $root 'runtime/node.exe'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$checks = [ordered]@{}

function Invoke-Core([string[]]$Arguments, [int]$TimeoutMs = 35000, [string]$InputText = '') {
    $info = [Diagnostics.ProcessStartInfo]::new($exe)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    # A successful test must use the packaged frameworks, not the CI SDK.
    $info.Environment['DOTNET_ROOT'] = 'Z:\not-a-runtime'
    $info.Environment['DOTNET_ROOT_X64'] = 'Z:\not-a-runtime'
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($info)
    try {
        $out = $process.StandardOutput.ReadToEndAsync()
        $err = $process.StandardError.ReadToEndAsync()
        if ($InputText) { $process.StandardInput.Write($InputText) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit($TimeoutMs)) {
            $process.Kill($true)
            throw ('Owned native core test timed out: ' + $Arguments[0])
        }
        return @{ Code = $process.ExitCode; Out = $out.GetAwaiter().GetResult(); Err = $err.GetAwaiter().GetResult() }
    } finally { $process.Dispose() }
}

foreach ($test in @(
    @('--host-component-self-test-output', 'component.json'),
    @('--self-test-output', 'health.json'),
    @('--boot-evidence-self-test', 'boot.json'),
    @('--wall-listener-self-test-output', 'wall-proof.json')
)) {
    $file = Join-Path $evidence $test[1]
    $run = Invoke-Core @($test[0], $file)
    if ($run.Code -ne 0 -or -not (Test-Path -LiteralPath $file)) { throw "Native component test failed: $($test[0]); $($run.Err)" }
    $report = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if (-not $report.ok) { throw "Native component reported failure: $($test[0])" }
    $checks[$test[1]] = 'PASS'
}
$component = Get-Content -LiteralPath (Join-Path $evidence 'component.json') -Raw | ConvertFrom-Json
if (-not $component.assemblyHasNoEntryPoint -or [IO.Path]::GetFileName($component.process) -ne 'LightRemote.exe') {
    throw 'The component must execute in the one native main file and have no standalone managed entry point'
}
if ([IO.Path]::GetFullPath($component.installRoot) -ne $root -or
    [IO.Path]::GetFullPath($component.managedProcessHelper) -ne $exe) { throw 'Native host changed install/helper identity' }
$checks['one-native-core-no-managed-entrypoint'] = 'PASS'
$checks['private-runtime-with-global-dotnet-disabled'] = 'PASS'
$status = Invoke-Core @('--desktop-bridge', 'status')
if ($status.Code -ne 0 -or ($status.Out | ConvertFrom-Json).state -ne 'status') {
    throw 'In-process Desktop status bridge failed without the old core EXE'
}
$denied = Invoke-Core @('--desktop-bridge', 'arbitrary-not-an-action')
if ($denied.Code -ne 0 -or ($denied.Out | ConvertFrom-Json).state -ne 'action_not_allowed') {
    throw 'In-process Desktop action allowlist was widened'
}
$checks['native-status-projection-and-action-allowlist'] = 'PASS'

$arguments = @('hello world', 'a"b', 'C:\with space\', 'Tiếng Việt')
$script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exit(27)'
$run = Invoke-Core (@('--managed-process', $node, '-e', $script) + $arguments)
if ($run.Code -ne 27 -or $run.Out.Trim() -ne (ConvertTo-Json -InputObject $arguments -Compress)) {
    # Compare decoded JSON as serializers may choose different Unicode escaping.
    if ($run.Code -ne 27 -or (Compare-Object @($run.Out | ConvertFrom-Json) $arguments)) {
        throw "Managed argument/exit-code contract failed: $($run.Code) $($run.Err)"
    }
}
$run = Invoke-Core @('--managed-process', $node, '-e', 'process.stdin.pipe(process.stdout)') 35000 "stdio Việt`n"
if ($run.Code -ne 0 -or $run.Out -ne "stdio Việt`n") { throw 'Managed stdin/stdout inheritance failed' }
$checks['managed-unicode-quoting-exit-code-stdio'] = 'PASS'

# A naturally exiting parent may not leave its child alive. This exercises
# the real inherited handles + suspended create/JobObject/close path.
$pidFile = Join-Path $evidence 'managed-child.pid'
$childSource = 'const{spawn}=require("child_process"),fs=require("fs");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(c.pid));c.unref();setTimeout(()=>process.exit(0),350)'
$run = Invoke-Core @('--managed-process', $node, '-e', $childSource, $pidFile)
if ($run.Code -ne 0 -or -not (Test-Path -LiteralPath $pidFile)) { throw 'Managed descendant fixture did not run' }
$ownedChildId = [int](Get-Content -LiteralPath $pidFile -Raw)
$deadline = [DateTime]::UtcNow.AddSeconds(5)
do {
    $owned = Get-Process -Id $ownedChildId -ErrorAction SilentlyContinue
    if ($null -eq $owned) { break }
    Start-Sleep -Milliseconds 80
} while ([DateTime]::UtcNow -lt $deadline)
if ($null -ne $owned) { throw 'Managed Job Object left a descendant after normal parent exit' }
$checks['managed-job-descendant-cleanup'] = 'PASS'

# Exercise the actual retained AgentHost supervisor against an isolated,
# temporary copy of the bundled agent entry. No cloud enrollment or service
# registration occurs; the original package stage is not modified.
$agent = Join-Path $root 'agent/device-agent/operator-agent.mjs'
$original = [IO.File]::ReadAllBytes($agent)
$supervisorDir = Join-Path $evidence 'supervisor'
New-Item -ItemType Directory -Force -Path $supervisorDir | Out-Null
$fixture = @'
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const dir=process.env.LR_HOST_POC_EVIDENCE;
const record=path.join(dir,'attempts.jsonl');
setTimeout(()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 child.unref();
 const old=fs.existsSync(record)?fs.readFileSync(record,'utf8').trim().split('\n').filter(Boolean):[];
 fs.appendFileSync(record,JSON.stringify({attempt:old.length+1,pid:process.pid,child:child.pid,
  helper:process.env.LIGHT_REMOTE_MANAGED_PROCESS_HELPER,nativeAb:process.env.LR_GOLD_ABV2_DESKTOP_ABV2_NATIVE_V4,
  state:process.env.OPERATOR_AGENT_STATE,rm:process.env.LIGHT_REMOTE_CLIENT_EXE})+'\n');
 if(old.length<2)setTimeout(()=>process.exit(37),100);
 else setInterval(()=>{},1000);
},250);
'@
$hostProcess = $null
$unrelatedWrapper = $null
try {
    [IO.File]::WriteAllText($agent, $fixture, [Text.UTF8Encoding]::new($false))
    $start = [Diagnostics.ProcessStartInfo]::new($exe)
    $start.ArgumentList.Add('--agent-host')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.Environment['LR_HOST_POC_EVIDENCE'] = $supervisorDir
    $hostProcess = [Diagnostics.Process]::Start($start)
    $attemptsFile = Join-Path $supervisorDir 'attempts.jsonl'
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $attempts = @()
    do {
        if ($hostProcess.HasExited) { throw 'Native headless AgentHost exited unexpectedly' }
        if (Test-Path -LiteralPath $attemptsFile) {
            $attempts = @(Get-Content -LiteralPath $attemptsFile | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
        }
        if ($attempts.Count -ge 3) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($attempts.Count -lt 3 -or $hostProcess.MainWindowHandle -ne 0) { throw 'Headless host restart/no-GUI contract failed' }
    foreach ($row in $attempts) {
        if ($row.helper -ne $exe -or $row.nativeAb -ne '1' -or
            $row.state -notmatch 'gpt-operator-agent-goldabv2' -or
            $row.rm -ne (Join-Path $root 'realremote-v2/LightRemote.RM.exe')) {
            throw 'Native host lost helper/profile/native A-B/RM identity'
        }
    }
    $other = [Diagnostics.ProcessStartInfo]::new($exe)
    $other.UseShellExecute = $false
    $other.CreateNoWindow = $true
    $other.RedirectStandardInput = $true
    $other.RedirectStandardOutput = $true
    $other.RedirectStandardError = $true
    $otherReady = Join-Path $evidence 'other-role.ready'
    foreach ($arg in @('--managed-process', $node, '-e', 'require("fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)', $otherReady)) { $other.ArgumentList.Add($arg) }
    $unrelatedWrapper = [Diagnostics.Process]::Start($other)
    $otherErrors = $unrelatedWrapper.StandardError.ReadToEndAsync()
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        if ($unrelatedWrapper.HasExited) { throw "Other-role fixture exited before stop: code=$($unrelatedWrapper.ExitCode) error=$($otherErrors.GetAwaiter().GetResult())" }
        if (Test-Path -LiteralPath $otherReady) { break }
        Start-Sleep -Milliseconds 80
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not (Test-Path -LiteralPath $otherReady)) { throw 'Other-role managed fixture did not become ready' }
    $stop = Invoke-Core @('--stop-agent-host')
    if ($stop.Code -ne 0 -or -not $hostProcess.WaitForExit(5000)) { throw "Owned Agent-only stop failed: code=$($stop.Code) phase=$($stop.Err)" }
    if ($unrelatedWrapper.HasExited) { throw 'Agent-only stop killed another role of the same executable' }
    $otherChildId = [int](Get-Content -LiteralPath $otherReady -Raw)
    if (-not (Get-Process -Id $otherChildId -ErrorAction SilentlyContinue)) { throw 'Agent-only stop killed the other role child' }
    $checks['agent-only-stop-preserves-other-native-core-role'] = 'PASS'
    Start-Sleep -Milliseconds 300
    foreach ($row in $attempts) {
        if (Get-Process -Id $row.pid -ErrorAction SilentlyContinue) { throw 'Daemon survived owned host termination' }
        if (Get-Process -Id $row.child -ErrorAction SilentlyContinue) { throw 'Daemon descendant escaped attempt Job Object' }
    }
    $checks['headless-supervisor-restart-profile-rm-native-ab'] = 'PASS'
    $checks['owned-host-exit-cleans-all-attempt-children'] = 'PASS'
} finally {
    if ($null -ne $unrelatedWrapper) {
        if (-not $unrelatedWrapper.HasExited) { $unrelatedWrapper.Kill($true); $unrelatedWrapper.WaitForExit(5000) | Out-Null }
        $unrelatedWrapper.Dispose()
    }
    if ($null -ne $hostProcess) {
        if (-not $hostProcess.HasExited) { $hostProcess.Kill($true); $hostProcess.WaitForExit(5000) | Out-Null }
        $hostProcess.Dispose()
    }
    [IO.File]::WriteAllBytes($agent, $original)
}
$report = @{ result = 'PASS'; checks = $checks; nativeExecutable = $exe
    sourceCommit = $env:GITHUB_SHA; ciRunId = $env:GITHUB_RUN_ID
    scope = 'Native in-process library, private runtime, worker modes and isolated supervisor fixtures'
    liveBackendAcceptance = $false; physicalOwnerAcceptance = $false }
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence 'summary.json') -Encoding utf8NoBOM
Write-Host 'NATIVE_HOSTED_CORE_PROOF=PASS'
