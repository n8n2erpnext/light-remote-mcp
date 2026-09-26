$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$main=[System.Windows.Forms.Form]::new();$main.Text='Light Remote UIA File Picker Parent';$main.StartPosition='CenterScreen'
$main.Size=[System.Drawing.Size]::new(580,310);$main.FormBorderStyle='FixedDialog'
$open=[System.Windows.Forms.Button]::new();$open.Text='Open File Picker';$open.AccessibleName='Light Remote Open File Picker'
$open.Size=[System.Drawing.Size]::new(430,76);$open.Location=[System.Drawing.Point]::new(60,70);$open.Font=[System.Drawing.Font]::new('Segoe UI',14)
$status=[System.Windows.Forms.Label]::new();$status.Text='file picker ready';$status.AccessibleName='Light Remote File Picker Ready'
$status.AutoSize=$true;$status.Location=[System.Drawing.Point]::new(60,180)
$open.Add_Click({
  $picker=[System.Windows.Forms.OpenFileDialog]::new()
  try{
    $picker.Title='Light Remote Native File Picker'
    $picker.Filter='Text files (*.txt)|*.txt|All files (*.*)|*.*'
    $picker.CheckFileExists=$true;$picker.Multiselect=$false;$picker.RestoreDirectory=$true
    if($env:RUNNER_TEMP -and (Test-Path -LiteralPath $env:RUNNER_TEMP)){$picker.InitialDirectory=$env:RUNNER_TEMP}
    $null=$picker.ShowDialog($main)
  }finally{$picker.Dispose()}
  $status.Text='file picker closed';$status.AccessibleName='Light Remote File Picker Closed'
})
$main.Controls.Add($open);$main.Controls.Add($status)
[System.Windows.Forms.Application]::Run($main)
