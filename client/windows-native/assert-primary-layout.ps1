param([Parameter(Mandatory=$true)][string]$InstallRoot,
      [Parameter(Mandatory=$true)][string]$EvidenceFile)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($InstallRoot)
foreach($old in @('GptOperator.Client.exe','desktop-v4/LightRemote.Desktop.exe')){
    if(Test-Path -LiteralPath (Join-Path $root $old)){throw "Obsolete primary executable still installed: $old"}
}
foreach($required in @('LightRemote.exe','windows-host/LightRemote.WindowsHost.dll',
    'windows-host/hostfxr.dll','windows-host/LightRemote.WindowsHost.runtimeconfig.json',
    'windows-host/host-runtime.json','config/core-layout.json','runtime/node.exe',
    'agent/device-agent/operator-agent.mjs','realremote-v2/LightRemote.RM.exe',
    'helper-candidate/LightRemote.Updater.exe')){
    if(-not(Test-Path -LiteralPath (Join-Path $root $required) -PathType Leaf)){throw "Primary layout missing: $required"}
}
$layout=Get-Content -LiteralPath (Join-Path $root 'config/core-layout.json') -Raw|ConvertFrom-Json
$version=(Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
if($layout.schemaVersion -ne 1 -or $layout.layoutId -ne 'lightremote-primary-hosted-v1' -or
   $layout.entryPoint -ne 'LightRemote.exe' -or $layout.version -ne $version -or
   $layout.productId -ne 'goldabv2-desktop-v4' -or $layout.profile -ne 'goldabv2-lab'){
    throw 'Primary layout metadata/version/product mismatch'
}
$component=Join-Path $root 'windows-host'
if(Get-ChildItem -LiteralPath $component -Filter '*.exe' -File){throw 'Managed component published a second apphost'}
$inventory=@(Get-ChildItem -LiteralPath $root -Filter '*.exe' -File -Recurse|ForEach-Object{
    $relative=[IO.Path]::GetRelativePath($root,$_.FullName).Replace('\','/')
    $role=if($relative -eq 'LightRemote.exe'){'primary-ui-agent-managed-worker'}
          elseif($relative -eq 'runtime/node.exe'){'node-runtime'}
          elseif($relative -eq 'realremote-v2/LightRemote.RM.exe'){'rm-v2-companion'}
          elseif($relative -like 'helper-candidate/*'){'independent-update-helper-candidate'}
          elseif($relative -match '^unins\d+\.exe$'){'inno-uninstaller'}
          else{'supporting-runtime-tool'}
    [ordered]@{path=$relative;role=$role;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$report=[ordered]@{schemaVersion=1;result='PASS';layoutId=$layout.layoutId;version=$version
    primaryExecutable='LightRemote.exe';primaryExecutableCount=1;oldPrimaryExecutablesAbsent=$true
    sourceCommit=$env:GITHUB_SHA;ciRunId=$env:GITHUB_RUN_ID;executables=$inventory
    observedInstallBytes=([long]((Get-ChildItem -LiteralPath $root -File -Recurse|Measure-Object -Property Length -Sum).Sum))
    observedPrivateFrameworkBytes=([long]((Get-ChildItem -LiteralPath (Join-Path $component 'runtime') -File -Recurse|Measure-Object -Property Length -Sum).Sum))
    frameworkVersions=(Get-Content -LiteralPath (Join-Path $component 'host-runtime.json') -Raw|ConvertFrom-Json).frameworkVersions
    physicalOwnerAcceptance=$false}
$parent=Split-Path -Parent ([IO.Path]::GetFullPath($EvidenceFile))
New-Item -ItemType Directory -Force -Path $parent|Out-Null
$report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $EvidenceFile -Encoding utf8NoBOM
Write-Host "WINDOWS_PRIMARY_LAYOUT=PASS version=$version supporting_executables=$($inventory.Count-1)"
