param(
  [Parameter(Mandatory=$true)][string]$Title,
  [Parameter(Mandatory=$true)][string]$ButtonName,
  [int]$X=140,[int]$Y=120
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form=[System.Windows.Forms.Form]::new();$form.Text=$Title;$form.StartPosition='Manual'
$form.Location=[System.Drawing.Point]::new($X,$Y);$form.Size=[System.Drawing.Size]::new(680,420)
$form.FormBorderStyle='Sizable';$form.MaximizeBox=$true;$form.MinimizeBox=$true
$label=[System.Windows.Forms.Label]::new();$label.Text=$Title;$label.AutoSize=$true
$label.Location=[System.Drawing.Point]::new(38,38);$label.Font=[System.Drawing.Font]::new('Segoe UI',16,[System.Drawing.FontStyle]::Bold)
$button=[System.Windows.Forms.Button]::new();$button.Text=$ButtonName;$button.AccessibleName=$ButtonName
$button.Size=[System.Drawing.Size]::new(500,86);$button.Location=[System.Drawing.Point]::new(72,120);$button.Font=[System.Drawing.Font]::new('Segoe UI',14)
$status=[System.Windows.Forms.Label]::new();$status.Text='window ready';$status.AccessibleName="$ButtonName Status Ready"
$status.AutoSize=$true;$status.Location=[System.Drawing.Point]::new(72,250)
$button.Add_Click({
  $button.Text="$ButtonName Accepted";$button.AccessibleName="$ButtonName Accepted"
  $status.Text='accepted';$status.AccessibleName="$ButtonName Status Accepted"
})
$form.Controls.Add($label);$form.Controls.Add($button);$form.Controls.Add($status)
$form.Add_Shown({$form.Activate()})
[System.Windows.Forms.Application]::Run($form)
