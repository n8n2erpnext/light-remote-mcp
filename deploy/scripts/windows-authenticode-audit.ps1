# Windows 11 publisher trust evidence; intentionally does not sign or bypass security policy.
# Use on a Windows CI runner after both Inno Setup installers have been generated.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$StageDir,
  [Parameter(Mandatory=$true)][string]$InstallerDir,
  [Parameter(Mandatory=$true)][string]$ReportFile,
  [switch]$RequireTrustedSignatures
)
$ErrorActionPreference='Stop'
$stage=(Resolve-Path -LiteralPath $StageDir).Path
$install=(Resolve-Path -LiteralPath $InstallerDir).Path
$targets=@()
# Smart App Control applies to each executed PE rather than the top-level installer alone.
$targets+=@(Get-ChildItem -LiteralPath $stage -Recurse -File |
  Where-Object { $_.Extension.ToLowerInvariant() -in @('.exe','.dll','.node','.ps1') })
$targets+=@(
  (Join-Path $install 'Light-Remote-MCP-Setup-x64.exe'),
  (Join-Path $install 'Light-Remote-MCP-Compact-Setup-x64.exe')
) | ForEach-Object {
  if(-not(Test-Path -LiteralPath $_ -PathType Leaf)){throw "Expected installer missing: $_"}
  Get-Item -LiteralPath $_
}
# Avoid reading repository/private secrets; inspect only signatures and publisher identities.
$report=@(foreach($file in $targets){
  $signature=Get-AuthenticodeSignature -LiteralPath $file.FullName
  $status=[string]$signature.Status
  $signer=$signature.SignerCertificate
  [pscustomobject]@{
    path=if($file.FullName.StartsWith($stage,[StringComparison]::OrdinalIgnoreCase)){
      'stage/'+$file.FullName.Substring($stage.Length).TrimStart('\','/').Replace('\','/')
    }else{'installer/'+$file.Name}
    status=$status
    publisher=if($signer){$signer.Subject}else{''}
    rsa=if($signer){$signer.PublicKey.Oid.Value -eq '1.2.840.113549.1.1.1'}else{$false}
  }
})
$notTrusted=@($report|Where-Object {$_.status -ne 'Valid' -or -not $_.rsa})
$critical=@($report|Where-Object {$_.path -eq 'stage/GptOperator.Client.exe' -or $_.path -like 'installer/*'})
$allCriticalValid=($critical.Count -eq 3 -and @($critical|Where-Object {$_.status -ne 'Valid' -or -not $_.rsa}).Count -eq 0)
$summary=[ordered]@{
  schema='light-remote-windows-authenticode-audit-v1'
  windowsSmartAppControlCompatibleSignatureEvidence=($notTrusted.Count -eq 0 -and $allCriticalValid)
  # A valid CA signature is necessary for unknown binaries but may not overcome a malicious-app verdict.
  successfulSignaturesDoNotGuaranteeExecution=$true
  totalExamined=$report.Count
  notTrusted=$notTrusted.Count
  criticalSigned=$allCriticalValid
  critical=$critical
  samplesNotTrusted=@($notTrusted|Select-Object -First 25)
}
$parent=Split-Path -Path $ReportFile -Parent
if($parent -and -not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Force -Path $parent|Out-Null}
$summary|ConvertTo-Json -Depth 7|Set-Content -LiteralPath $ReportFile -Encoding utf8
Write-Host ("windows-authenticode-audit=checked total={0} notTrusted={1} criticalSigned={2}" -f $report.Count,$notTrusted.Count,$allCriticalValid)
if($notTrusted.Count){
  Write-Warning "Unsigned/untrusted binaries detected. GitHub CI success is not Windows 11 Smart App Control acceptance. A publicly trusted RSA Authenticode code-signing certificate is required."
  foreach($item in ($notTrusted|Select-Object -First 8)){Write-Host ("publisher-untrusted: {0} ({1})" -f $item.path,$item.status)}
}
if($RequireTrustedSignatures -and ($notTrusted.Count -gt 0 -or -not $allCriticalValid)){
  throw "Publisher signature release gate failed: $($notTrusted.Count) unsigned or untrusted files. Do not publish as a Smart App Control compatible build."
}
