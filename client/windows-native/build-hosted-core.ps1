param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [string]$Configuration = 'Release'
)
$ErrorActionPreference = 'Stop'
$install = [IO.Path]::GetFullPath($InstallRoot)
$component = Join-Path $install 'windows-host'
New-Item -ItemType Directory -Force -Path $component | Out-Null
$project = Join-Path $PSScriptRoot 'LightRemote.WindowsHost/LightRemote.WindowsHost.csproj'
& dotnet publish $project -c $Configuration -r win-x64 --self-contained false -p:UseAppHost=false -p:PublishSingleFile=false -o $component
if ($LASTEXITCODE -ne 0) { throw 'Windows managed component build failed' }
if ((Get-ChildItem -LiteralPath $component -Filter '*.exe' -File).Count -ne 0) {
    throw 'The managed component must not publish a second apphost executable'
}

# Host the framework-dependent library using private, unmodified Microsoft
# frameworks. The resulting app never invokes a global dotnet.exe and does
# not require a machine-wide .NET install on the target device.
$rows = @(& dotnet --list-runtimes)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect build SDK runtimes' }
$frameworks = @()
foreach ($name in @('Microsoft.NETCore.App', 'Microsoft.WindowsDesktop.App')) {
    $candidates = @($rows | ForEach-Object {
        if ($_ -match ('^' + [regex]::Escape($name) + '\s+(8\.0\.\d+)\s+\[(.+)\]$')) {
            [pscustomobject]@{ Version = [version]$Matches[1]; Parent = $Matches[2] }
        }
    })
    $selected = $candidates | Sort-Object Version -Descending | Select-Object -First 1
    if ($null -eq $selected) { throw "Build runner lacks private framework source: $name 8.0" }
    $version = $selected.Version.ToString()
    $source = Join-Path $selected.Parent $version
    $parent = Join-Path $component "runtime/shared/$name"
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $parent -Recurse -Force
    $frameworks += @{ name = $name; version = $version }
}
$dotnetRoot = Split-Path -Parent (Get-Command dotnet).Source
$fxr = Get-ChildItem -LiteralPath (Join-Path $dotnetRoot 'host/fxr') -Directory |
    Where-Object Name -Match '^8\.0\.\d+$' | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if ($null -eq $fxr) { throw 'Build SDK has no .NET 8 hostfxr' }
Copy-Item -LiteralPath (Join-Path $fxr.FullName 'hostfxr.dll') -Destination (Join-Path $component 'hostfxr.dll') -Force
$assembly = Join-Path $component 'LightRemote.WindowsHost.dll'
$config = Join-Path $component 'LightRemote.WindowsHost.runtimeconfig.json'
if (-not (Test-Path -LiteralPath $assembly) -or -not (Test-Path -LiteralPath $config)) {
    throw 'Managed component or runtimeconfig is missing'
}
$runtimeConfig = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
if ($runtimeConfig.runtimeOptions.includedFrameworks) { throw 'Host component must be framework-dependent' }
$runtimeConfig.runtimeOptions | Add-Member -NotePropertyName rollForward -NotePropertyValue 'LatestPatch' -Force
$runtimeConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $config -Encoding utf8NoBOM
$manifest = @{
    schemaVersion = 1; architecture = 'win-x64'; deployment = 'private-framework-dependent-component'
    entryAssembly = 'LightRemote.WindowsHost.dll'; apphostExecutable = $false
    frameworkVersions = $frameworks; hostfxrVersion = $fxr.Name
    assemblySha256 = (Get-FileHash -LiteralPath $assembly -Algorithm SHA256).Hash.ToLowerInvariant()
    hostfxrSha256 = (Get-FileHash -LiteralPath (Join-Path $component 'hostfxr.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $component 'host-runtime.json') -Encoding utf8NoBOM
$configDir = Join-Path $install 'config'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$catalog = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../config/endpoints.json') -Raw | ConvertFrom-Json
if ($catalog.selectedProfile -ne 'goldabv2-lab' -or $catalog.profiles.'goldabv2-lab'.productId -ne 'goldabv2-desktop-v4') {
    throw 'Hosted primary builder is restricted to the canonical Windows product'
}
$layout = @{
    schemaVersion = 1; layoutId = 'lightremote-primary-hosted-v1'; entryPoint = 'LightRemote.exe'
    productId = $catalog.profiles.'goldabv2-lab'.productId; profile = $catalog.selectedProfile
    version = (Get-Content -LiteralPath (Join-Path $install 'VERSION') -Raw).Trim()
    component = 'windows-host/LightRemote.WindowsHost.dll'; minimumHelperCoreLayoutContract = 1
}
$layout | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $configDir 'core-layout.json') -Encoding utf8NoBOM
Write-Host 'WINDOWS_IN_PROCESS_COMPONENT_STAGED=PASS'
