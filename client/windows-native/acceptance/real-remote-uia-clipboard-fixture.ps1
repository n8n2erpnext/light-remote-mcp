$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form=[System.Windows.Forms.Form]::new();$form.Text='Light Remote UIA Clipboard';$form.StartPosition='CenterScreen'
$form.Size=[System.Drawing.Size]::new(650,360);$form.FormBorderStyle='FixedDialog'
$sourceLabel=[System.Windows.Forms.Label]::new();$sourceLabel.Text='Source';$sourceLabel.AutoSize=$true;$sourceLabel.Location=[System.Drawing.Point]::new(50,45)
$source=[System.Windows.Forms.TextBox]::new();$source.AccessibleName='Light Remote Clipboard Source'
$source.Size=[System.Drawing.Size]::new(520,34);$source.Location=[System.Drawing.Point]::new(50,75);$source.Font=[System.Drawing.Font]::new('Segoe UI',12)
$destLabel=[System.Windows.Forms.Label]::new();$destLabel.Text='Destination';$destLabel.AutoSize=$true;$destLabel.Location=[System.Drawing.Point]::new(50,135)
$dest=[System.Windows.Forms.TextBox]::new();$dest.AccessibleName='Light Remote Clipboard Destination'
$dest.Size=[System.Drawing.Size]::new(520,34);$dest.Location=[System.Drawing.Point]::new(50,165);$dest.Font=[System.Drawing.Font]::new('Segoe UI',12)
$status=[System.Windows.Forms.Label]::new();$status.Text='clipboard ready';$status.AccessibleName='Light Remote Clipboard Ready'
$status.AutoSize=$true;$status.Location=[System.Drawing.Point]::new(50,235)
$source.Add_TextChanged({
  if($source.Text.Length -gt 0){$source.AccessibleName='Light Remote Clipboard Source Filled'}
  else{$source.AccessibleName='Light Remote Clipboard Source'}
})
$dest.Add_TextChanged({
  if($dest.Text.Length -gt 0 -and $dest.Text -eq $source.Text){
    $dest.AccessibleName='Light Remote Clipboard Paste Accepted'
    $status.Text='clipboard accepted';$status.AccessibleName='Light Remote Clipboard Accepted'
    try{[System.Windows.Forms.Clipboard]::Clear()}catch{}
  }else{$dest.AccessibleName='Light Remote Clipboard Destination'}
})
$form.Controls.AddRange(@($sourceLabel,$source,$destLabel,$dest,$status))
$form.Add_Shown({$form.Activate()})
[System.Windows.Forms.Application]::Run($form)
