param([Parameter(Mandatory=$true)][string]$PrimaryInstaller,
      [Parameter(Mandatory=$true)][string]$BridgeConfig,
      [Parameter(Mandatory=$true)][string]$EvidenceDir,
      [string]$FailpointInstaller='')
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){throw 'Migration fixture is restricted to hosted CI'}
$allowed=[IO.Path]::GetFullPath($env:RUNNER_TEMP)+[IO.Path]::DirectorySeparatorChar
$root=[IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'Light Remote Primary Migration Fixture'))
if(-not $root.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $root)){
    throw 'Migration must use a fresh owned CI directory'
}
if(Get-ScheduledTask -TaskName 'LightRemoteDeviceAgent' -ErrorAction SilentlyContinue){throw 'Previous CI installation must be uninstalled first'}
$evidence=[IO.Path]::GetFullPath($EvidenceDir)
New-Item -ItemType Directory -Force -Path $evidence|Out-Null
$updaterRoot=Join-Path $env:LOCALAPPDATA 'Light Remote/Updater/GoldABV2'
if(Test-Path -LiteralPath $updaterRoot){throw 'Previous CI updater recovery root must be removed by its uninstaller'}
$updater=Join-Path $updaterRoot 'LightRemote.Updater.exe'
$config=Get-Content -LiteralPath $BridgeConfig -Raw|ConvertFrom-Json
$version=(Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../VERSION') -Raw).Trim()
if($config.schemaVersion -ne 1 -or $config.version -ne '0.10.1-dev.1' -or
   $config.sourceCommit -notmatch '^[a-f0-9]{40}$' -or $config.installerSha256 -notmatch '^[a-f0-9]{64}$' -or
   $config.installerUrl -notlike 'https://github.com/n8n2erpnext/light-remote-mcp/releases/download/*' -or
   $config.manifestSha256 -notmatch '^[a-f0-9]{64}$' -or
   $config.installerAssetId -lt 1 -or $config.manifestAssetId -lt 1 -or
   $config.manifestUrl -ne ($config.installerUrl.Substring(0,$config.installerUrl.LastIndexOf('/')+1)+'BUILD_MANIFEST.json')){
    throw 'Bridge pin must identify a verified installer in the official repository'
}
$bridge=Join-Path $evidence 'compatibility-bridge.exe'
function Receive-BridgeAsset([long]$AssetId,[string]$Destination,[string]$ExpectedSha256){
    if(-not $env:GITHUB_TOKEN){throw 'Hosted bridge intake requires its contents-read Actions token'}
    # The release browser endpoint intermittently returned504 on hosted
    # runners. Read the exact pinned asset through the repository API.
    # Never forward the API bearer to its signed CDN redirect.
    for($attempt=1;$attempt -le 3;$attempt++){
        $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
        $api=[Net.Http.HttpClient]::new($handler);$api.Timeout=[TimeSpan]::FromSeconds(30)
        $api.DefaultRequestHeaders.UserAgent.ParseAdd('LightRemote-Internal-CI/1')
        $api.DefaultRequestHeaders.Accept.ParseAdd('application/octet-stream')
        $api.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$env:GITHUB_TOKEN)
        $reply=$null;$cdn=$null;$download=$null;$output=$null;$assetStream=$null
        $budget=[Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(90))
        try{
            $reply=$api.GetAsync(('https://api.github.com/repos/n8n2erpnext/light-remote-mcp/releases/assets/'+$AssetId),[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$budget.Token).GetAwaiter().GetResult()
            if([int]$reply.StatusCode -in @(301,302,303,307,308)){
                $location=$reply.Headers.Location
                if(-not $location.IsAbsoluteUri -or $location.Scheme -ne 'https' -or $location.Host -notin @('release-assets.githubusercontent.com','objects.githubusercontent.com') -or $location.UserInfo){throw 'bridge_asset_redirect_denied'}
                $cdn=[Net.Http.HttpClient]::new();$cdn.Timeout=[TimeSpan]::FromSeconds(180)
                $download=$cdn.GetAsync($location,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$budget.Token).GetAwaiter().GetResult()
            }else{$download=$reply}
            [void]$download.EnsureSuccessStatusCode()
            $assetStream=$download.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $output=[IO.File]::Create($Destination);$assetStream.CopyToAsync($output,$budget.Token).GetAwaiter().GetResult();$output.Dispose();$output=$null
            if((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'bridge_asset_digest_mismatch'}
            return
        }catch{
            if($_.Exception.Message -match 'bridge_asset_(digest_mismatch|redirect_denied)'){throw}
            if($attempt -eq 3){throw 'Pinned bridge asset unavailable after three bounded API attempts'}
            Start-Sleep -Seconds 2
        }finally{
            if($output){$output.Dispose()};if($assetStream){$assetStream.Dispose()}
            if($download -and $download -ne $reply){$download.Dispose()};if($reply){$reply.Dispose()}
            if($cdn){$cdn.Dispose()};$api.Dispose();$handler.Dispose();$budget.Dispose()
        }
    }
}
Receive-BridgeAsset $config.installerAssetId $bridge $config.installerSha256
if((Get-FileHash -LiteralPath $bridge -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.installerSha256){throw 'Bridge installer digest mismatch'}
$bridgeManifestFile=Join-Path $evidence 'bridge-build-manifest.json'
Receive-BridgeAsset $config.manifestAssetId $bridgeManifestFile $config.manifestSha256
if((Get-FileHash -LiteralPath $bridgeManifestFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $config.manifestSha256){throw 'Bridge source manifest digest mismatch'}
$bridgeManifest=Get-Content -LiteralPath $bridgeManifestFile -Raw|ConvertFrom-Json
if($bridgeManifest.sourceCommit -ne $config.sourceCommit -or $bridgeManifest.artifact.sha256 -ne $config.installerSha256 -or
   $bridgeManifest.projectVersion -ne $config.version){throw 'Bridge source/version/manifest pin mismatch'}
$checks=[ordered]@{}
$canaries=[ordered]@{}
$fixtureVars=@{}
$primaryFailure=$null

function Save-MigrationProgress([string]$Stage){
    [ordered]@{stage=$Stage;checks=$checks;sourceCommit=$env:GITHUB_SHA;ciRunId=$env:GITHUB_RUN_ID}|
        ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $evidence 'migration-progress.json') -Encoding utf8NoBOM
    Write-Host "PRIMARY_MIGRATION_STAGE=$Stage"
}
function Copy-RecoveryDiagnostics{
    foreach($relative in @('logs/update.log','state/status.json','state/pending-report.json','state/transaction.json')){
        $file=Join-Path $updaterRoot $relative
        if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination (Join-Path $evidence ('recovery-'+[IO.Path]::GetFileName($file))) -Force}
    }
    $txn=Join-Path $updaterRoot 'state/installer-txn'
    if(Test-Path -LiteralPath $txn){
        Get-ChildItem -LiteralPath $txn -Filter 'watchdog.log' -File -Recurse|ForEach-Object{
            $name='watchdog-'+(Split-Path -Leaf (Split-Path -Parent $_.FullName))+'.log'
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $evidence $name) -Force
        }
    }
}

function Invoke-Owned([string]$File,[string[]]$Arguments,[int]$Timeout=180000){
    $psi=[Diagnostics.ProcessStartInfo]::new($File);$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    foreach($arg in $Arguments){$psi.ArgumentList.Add($arg)}
    foreach($name in $fixtureVars.Keys){$psi.Environment[$name]=$fixtureVars[$name]}
    $p=[Diagnostics.Process]::Start($psi)
    try{
        if(-not $p.WaitForExit($Timeout)){$p.Kill($true);throw "Owned migration phase timed out: $([IO.Path]::GetFileName($File))"}
        return $p.ExitCode
    }finally{$p.Dispose()}
}
function Install-Package([string]$File,[string]$Phase){
    $code=Invoke-Owned $File @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR='+$root),('/LOG='+(Join-Path $evidence ($Phase+'.log'))))
    if($code -ne 0){throw "Migration installer $Phase exited $code"}
}
function Assert-Canaries{
    foreach($file in $canaries.Keys){
        if(-not(Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $canaries[$file]){
            throw 'Installer changed an unrelated preserved config/device-local/Long Memory fixture'
        }
    }
}
function Wait-Healthy([string]$ExpectedVersion,[bool]$Primary){
    $deadline=[DateTime]::UtcNow.AddSeconds(90)
    do{
        try{
            $current=(Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
            $task=Get-ScheduledTask -TaskName 'LightRemoteDeviceAgent' -ErrorAction Stop
            $name=if($Primary){'LightRemote.exe'}else{'GptOperator.Client.exe'}
            if($current -eq $ExpectedVersion -and $task.State -eq 'Running' -and
               [IO.Path]::GetFullPath(@($task.Actions)[0].Execute) -eq (Join-Path $root $name) -and
               (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5491/' -TimeoutSec 2).StatusCode -eq 200){
                if($Primary){
                    & (Join-Path $PSScriptRoot 'assert-primary-layout.ps1') -InstallRoot $root -EvidenceFile (Join-Path $evidence 'migration-primary-inventory.json')
                }else{
                    if(Test-Path -LiteralPath (Join-Path $root 'LightRemote.exe')){throw 'Primary EXE remained after legacy rollback'}
                    if(-not(Test-Path -LiteralPath (Join-Path $root 'desktop-v4/LightRemote.Desktop.exe'))){throw 'Legacy Desktop missing after rollback'}
                }
                return
            }
        }catch{$last=$_.Exception.Message}
        Start-Sleep -Milliseconds 300
    }while([DateTime]::UtcNow -lt $deadline)
    throw "Migration health/version/layout timed out: $ExpectedVersion $last"
}
function Apply-Package([string]$File,[string]$From,[string]$Target,[bool]$ExpectRollback=$false){
    $state=Join-Path $updaterRoot 'state';New-Item -ItemType Directory -Force -Path $state|Out-Null
    $tx='ut_ci_oneexe_'+[guid]::NewGuid().ToString('N')
    [ordered]@{schemaVersion=1;txId=$tx;fromVersion=$From;targetVersion=$Target;startedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}|
        ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $state 'transaction.json') -Encoding utf8NoBOM
    Remove-Item -LiteralPath (Join-Path $state 'core-health-ack.json') -Force -ErrorAction SilentlyContinue
    $code=Invoke-Owned $updater @('--apply-update',$File,$root,$From,'0',$Target,$tx) 240000
    if($code -ne 0){throw "Migration update controller failed: $code"}
    $deadline=[DateTime]::UtcNow.AddSeconds(40)
    do{
        try{
            $status=Get-Content -LiteralPath (Join-Path $state 'status.json') -Raw|ConvertFrom-Json
            $wanted=if($ExpectRollback){'rollback'}else{'success'}
            if($status.state -eq $wanted){break}
        }catch{}
        Start-Sleep -Milliseconds 200
    }while([DateTime]::UtcNow -lt $deadline)
    if($status.state -ne $wanted){throw "Migration transaction did not finalize: $($status.state)"}
    if($ExpectRollback){
        $report=Get-Content -LiteralPath (Join-Path $state 'pending-report.json') -Raw|ConvertFrom-Json
        if($report.outcome -ne 'rollback' -or -not $report.rollback.success){throw 'Rollback did not produce a verified recovery receipt'}
    }
}
function Stop-Fixture{
    Stop-ScheduledTask -TaskName 'LightRemoteDeviceAgent' -ErrorAction SilentlyContinue
    Stop-ScheduledTask -TaskName 'LightRemoteUpdater' -ErrorAction SilentlyContinue
    $targets=@('LightRemote.exe','GptOperator.Client.exe','desktop-v4/LightRemote.Desktop.exe','runtime/node.exe')|ForEach-Object{Join-Path $root $_}
    foreach($p in @(Get-Process -Name 'LightRemote','GptOperator.Client','LightRemote.Desktop','node' -ErrorAction SilentlyContinue)){
        try{if($targets -contains $p.Path){$p.Kill($false);$p.WaitForExit(5000)|Out-Null}}catch{}finally{$p.Dispose()}
    }
    foreach($p in @(Get-Process -Name 'LightRemote.Updater' -ErrorAction SilentlyContinue)){
        try{if($p.Path.StartsWith([IO.Path]::GetFullPath($updaterRoot)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){$p.Kill($false);$p.WaitForExit(5000)|Out-Null}}catch{}finally{$p.Dispose()}
    }
}
function Compile-Fixture([string]$Name,[string]$Source){
    $sourceFile=Join-Path $evidence ($Name+'.cs');$file=Join-Path $evidence ($Name+'.exe')
    [IO.File]::WriteAllText($sourceFile,$Source,[Text.UTF8Encoding]::new($false))
    $compiler=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $compiler /nologo /target:winexe ("/out:$file") $sourceFile
    if($LASTEXITCODE -ne 0){throw 'CI-only .NET Framework failure fixture did not compile'}
    return $file
}
function Wait-WatchdogCompletion{
    $owned=[IO.Path]::GetFullPath((Join-Path $updaterRoot 'state/installer-txn'))+[IO.Path]::DirectorySeparatorChar
    $deadline=[DateTime]::UtcNow.AddSeconds(90)
    do{
        $active=@(Get-Process -Name 'LightRemote.InstallWatchdog' -ErrorAction SilentlyContinue|Where-Object{
            try{$_.Path.StartsWith($owned,[StringComparison]::OrdinalIgnoreCase)}catch{$false}
        })
        if(-not $active){return}
        Start-Sleep -Milliseconds 250
    }while([DateTime]::UtcNow -lt $deadline)
    throw 'Native installer watchdog did not finish its synchronous recovery'
}
function Assert-LegacyGuiIsolation{
    $desktop=Join-Path $root 'desktop-v4/LightRemote.Desktop.exe'
    foreach($p in @(Get-Process -Name 'LightRemote.Desktop' -ErrorAction SilentlyContinue)){
        try{if($p.Path -eq $desktop){$p.Kill($false);$p.WaitForExit(5000)|Out-Null}}finally{$p.Dispose()}
    }
    # Leave a valid newer component present to prove the restored legacy GUI
    # never activates hosted operation merely because those DLL files exist.
    $runtimeConfig=Join-Path $root 'windows-host/LightRemote.WindowsHost.runtimeconfig.json'
    $held=$runtimeConfig+'.fixture-held'
    if(Test-Path -LiteralPath $held){Copy-Item -LiteralPath $held -Destination $runtimeConfig -Force}
    $psi=[Diagnostics.ProcessStartInfo]::new($desktop);$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    $gui=[Diagnostics.Process]::Start($psi)
    try{
        Start-Sleep -Seconds 3
        $gui.Refresh()
        if($gui.HasExited -or $gui.MainWindowHandle -eq 0){throw 'Restored legacy native GUI did not launch'}
        $component=[IO.Path]::GetFullPath((Join-Path $root 'windows-host'))+[IO.Path]::DirectorySeparatorChar
        if(@($gui.Modules|Where-Object{$_.FileName.StartsWith($component,[StringComparison]::OrdinalIgnoreCase)})){
            throw 'Legacy rollback GUI opportunistically loaded a newer component'
        }
    }finally{if(-not $gui.HasExited){$gui.Kill($false);$gui.WaitForExit(5000)|Out-Null};$gui.Dispose()}
}

try{
    Install-Package $bridge 'bridge-fresh'
    Wait-Healthy $config.version $false
    $health=Join-Path $evidence 'bridge-helper.json'
    if((Invoke-Owned $updater @('--self-test-output',$health,$root)) -ne 0){throw 'Bridge helper self-test failed'}
    $helper=Get-Content -LiteralPath $health -Raw|ConvertFrom-Json
    if(-not $helper.ok -or -not $helper.supportsPrimaryHostedLayout -or $helper.coreLayoutContract -ne 1 -or
       (Get-Content -LiteralPath (Join-Path $updaterRoot 'VERSION') -Raw).Trim() -ne $config.version){
        throw 'Pinned bridge did not install the dual-layout independent helper'
    }
    $checks['verified-bridge-fresh-install-independent-helper']='PASS'
    Save-MigrationProgress 'bridge-installed'
    $deviceLocal=Join-Path $env:LOCALAPPDATA 'LightRemoteGoldABV2/oneexe-ci-preservation'
    $stateDir=Join-Path $env:USERPROFILE '.config/gpt-operator-agent-goldabv2'
    $preserved=@((Join-Path $root 'config/oneexe-ci-custom.json'),
        (Join-Path $root 'desktop-v4/oneexe-ci-owner-data.txt'),
        (Join-Path $deviceLocal 'long-memory-fixture-canary.txt'),
        (Join-Path $stateDir 'oneexe-ci-device-identity-canary.txt'))
    foreach($file in $preserved){
        if(Test-Path -LiteralPath $file){throw 'CI canary unexpectedly already exists'}
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file)|Out-Null
        [IO.File]::WriteAllText($file,[guid]::NewGuid().ToString(),[Text.UTF8Encoding]::new($false))
        $canaries[$file]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    }

    # Real primary installer + a synthetic old-capability helper response.
    # The real bridge binary is restored before any upgrade transaction.
    $unsupported=Compile-Fixture 'unsupported-updater-fixture' @'
using System.IO;
class UnsupportedHelper {
 static int Main(string[] args) {
  if(args.Length==3 && args[0]=="--self-test-output") {
   File.WriteAllText(args[1],"{\"ok\":true,\"updaterOutsideApp\":true}");return 0;
  } return 2;
 }
}
'@
    $backup=Join-Path $evidence 'verified-bridge-helper.exe'
    Copy-Item -LiteralPath $updater -Destination $backup
    $oldHash=(Get-FileHash -LiteralPath (Join-Path $root 'GptOperator.Client.exe') -Algorithm SHA256).Hash
    $hostBefore=@(Get-CimInstance Win32_Process -Filter "Name='GptOperator.Client.exe'"|Where-Object{$_.ExecutablePath -eq (Join-Path $root 'GptOperator.Client.exe') -and $_.CommandLine -match '--agent-host'}|ForEach-Object{[int]$_.ProcessId})
    try{
        Stop-ScheduledTask -TaskName 'LightRemoteUpdater' -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath $unsupported -Destination $updater -Force
        $blocked=Invoke-Owned $PrimaryInstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR='+$root),('/LOG='+(Join-Path $evidence 'unsupported-helper-preflight.log')))
        if($blocked -eq 0 -or (Get-FileHash -LiteralPath (Join-Path $root 'GptOperator.Client.exe') -Algorithm SHA256).Hash -ne $oldHash){
            throw 'Incompatible helper was not blocked before Core replacement'
        }
        foreach($hostId in $hostBefore){if(-not(Get-Process -Id $hostId -ErrorAction SilentlyContinue)){throw 'Blocked install stopped the existing Agent host'}}
        Wait-Healthy $config.version $false
        Assert-Canaries
    }finally{Copy-Item -LiteralPath $backup -Destination $updater -Force}
    $checks['real-installer-incompatible-helper-blocks-before-core-stop']='PASS'
    Save-MigrationProgress 'incompatible-helper-preflight'

    Apply-Package $PrimaryInstaller $config.version $version
    Wait-Healthy $version $true
    Assert-Canaries
    $checks['bridge-helper-installs-and-verifies-primary-layout']='PASS'
    Save-MigrationProgress 'bridge-to-primary'
    Install-Package $PrimaryInstaller 'primary-reinstall'
    Wait-Healthy $version $true
    Assert-Canaries
    $checks['same-version-primary-reinstall-preserves-config-device-local-canaries']='PASS'
    Save-MigrationProgress 'primary-reinstall'

    # Controlled valid downgrade establishes the real bridge again. This uses
    # the normal apply/health/helper transaction, not a fabricated directory.
    Apply-Package $bridge $version $config.version
    Wait-Healthy $config.version $false
    Assert-Canaries
    $checks['primary-to-legacy-real-installer-transaction']='PASS'
    Save-MigrationProgress 'controlled-legacy-downgrade'

    # The CI-only wrapper invokes the exact real primary installer, lets its
    # watchdog observe commit, then removes the component runtimeconfig. A fresh
    # health worker must fail and the running bridge helper must restore the
    # cached real bridge installer. The fixture is never shipped in the app.
    $broken=Compile-Fixture 'post-install-health-failure-fixture' @'
using System;using System.IO;using System.Diagnostics;
class BrokenInstalledComponent {
 static int Main() {
  string root=Environment.GetEnvironmentVariable("LR_CI_MIGRATION_ROOT");
  string installer=Environment.GetEnvironmentVariable("LR_CI_PRIMARY_INSTALLER");
  if(String.IsNullOrEmpty(root)||String.IsNullOrEmpty(installer))return 77;
  var info=new ProcessStartInfo(installer);
  info.UseShellExecute=false;info.CreateNoWindow=true;
  info.Arguments="/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /DIR=\""+root+"\"";
  using(var process=Process.Start(info)) {
   if(!process.WaitForExit(150000))return 78;
   if(process.ExitCode!=0)return process.ExitCode;
  }
  string component=Path.Combine(root,"windows-host","LightRemote.WindowsHost.runtimeconfig.json");
  File.Move(component,component+".fixture-held");
  File.WriteAllText(Path.Combine(root,"ci-post-install-failure-injected.txt"),"injected after real installer commit");
  return 0;
 }
}
'@
    $fixtureVars['LR_CI_MIGRATION_ROOT']=$root
    $fixtureVars['LR_CI_PRIMARY_INSTALLER']=[IO.Path]::GetFullPath($PrimaryInstaller)
    Apply-Package $broken $config.version $version $true
    $fixtureVars.Clear()
    Wait-Healthy $config.version $false
    Assert-Canaries
    if(-not(Test-Path -LiteralPath (Join-Path $root 'ci-post-install-failure-injected.txt'))){throw 'Real post-install health failure was not injected'}
    Copy-Item -LiteralPath (Join-Path $updaterRoot 'state/pending-report.json') -Destination (Join-Path $evidence 'cross-layout-rollback-report.json')
    $checks['real-primary-install-health-failure-restores-real-bridge-and-removes-new-exe']='PASS'
    Assert-LegacyGuiIsolation
    $checks['restored-legacy-gui-does-not-activate-leftover-hosted-component']='PASS'
    Save-MigrationProgress 'real-health-failure-rollback-and-legacy-gui'

    if($FailpointInstaller){
        Save-MigrationProgress 'manual-watchdog-failpoint-start'
        $failed=Invoke-Owned $FailpointInstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR='+$root),('/LOG='+(Join-Path $evidence 'installer-watchdog-failpoint.log')))
        # Inno can return zero after a suppressed ssPostInstall exception.
        # Prove the injected failure and independent watchdog recovery rather
        # than treating the installer's process exit code as a commit receipt.
        $failureLog=Get-Content -LiteralPath (Join-Path $evidence 'installer-watchdog-failpoint.log') -Raw
        if($failureLog -notmatch 'Light Remote installer transaction self-test failpoint' -or
           $failureLog -notmatch 'light-remote-install-transaction-abort-watchdog-armed'){
            throw "Native installer failpoint was not observed: exit=$failed"
        }
        Wait-Healthy $config.version $false
        Wait-WatchdogCompletion
        Copy-RecoveryDiagnostics
        $recovered=@(Get-ChildItem -LiteralPath $evidence -Filter 'watchdog-*.log' -File|Where-Object{
            (Get-Content -LiteralPath $_.FullName -Raw) -match 'rollback_restore_wall_healthy'
        })
        if(-not $recovered){throw 'Native watchdog did not record verified rollback health'}
        Assert-Canaries
        $checks['manual-installer-postinstall-failure-watchdog-restores-bridge']='PASS'
        Save-MigrationProgress 'manual-watchdog-recovered'
    }

    Apply-Package $PrimaryInstaller $config.version $version
    Wait-Healthy $version $true
    Assert-Canaries
    $checks['upgrade-after-rollback-reuses-same-identity-directories']='PASS'
    [ordered]@{schemaVersion=1;result='PASS';sourceCommit=$env:GITHUB_SHA;ciRunId=$env:GITHUB_RUN_ID
        primaryVersion=$version;bridgeSource=$config.sourceCommit;bridgeVersion=$config.version
        bridgeInstallerSha256=$config.installerSha256;checks=$checks;preservedCanaryCount=$canaries.Count
        liveOwnerIdentityOrVaultAcceptance=$false;physicalOwnerAcceptance=$false}|
        ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $evidence 'migration-summary.json') -Encoding utf8NoBOM
    Write-Host 'WINDOWS_ONE_PRIMARY_REAL_INSTALL_UPGRADE_ROLLBACK=PASS'
}catch{
    $primaryFailure=$_
    [ordered]@{result='FAIL';error=$_.Exception.Message;scriptStackTrace=$_.ScriptStackTrace;checks=$checks}|
        ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $evidence 'migration-failure.json') -Encoding utf8NoBOM
    try{Copy-RecoveryDiagnostics}catch{Write-Warning 'Could not capture all fixture recovery diagnostics'}
    throw
}finally{
    $cleanupErrors=[Collections.Generic.List[string]]::new()
    try{Wait-WatchdogCompletion;Copy-RecoveryDiagnostics}catch{$cleanupErrors.Add($_.Exception.Message)}
    try{
        Stop-Fixture
        $unins=Join-Path $root 'unins000.exe'
        if(Test-Path -LiteralPath $unins){
            $exit=Invoke-Owned $unins @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') 60000
            if($exit -ne 0){throw "Migration fixture uninstaller failed: $exit"}
        }
        foreach($file in $canaries.Keys){Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}
        if(Get-ScheduledTask -TaskName 'LightRemoteDeviceAgent' -ErrorAction SilentlyContinue){throw 'Migration fixture left the Agent task installed'}
        if(Test-Path -LiteralPath $updaterRoot){throw 'Migration fixture left its independent updater installed'}
    }catch{$cleanupErrors.Add($_.Exception.Message)}
    if($cleanupErrors.Count){
        $cleanupErrors|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $evidence 'cleanup-errors.json') -Encoding utf8NoBOM
        if($null -eq $primaryFailure){throw ('Migration fixture cleanup: '+($cleanupErrors -join '; '))}
        Write-Warning ('Cleanup also failed: '+($cleanupErrors -join '; '))
    }
}
