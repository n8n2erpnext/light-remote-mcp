param(
  [Parameter(Mandatory=$true)][string]$Title,
  [Parameter(Mandatory=$true)][string]$ButtonName,
  [int]$X=120,[int]$Y=120
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form=[System.Windows.Forms.Form]::new();$form.Text=$Title;$form.StartPosition='Manual'
$form.Location=[System.Drawing.Point]::new($X,$Y);$form.Size=[System.Drawing.Size]::new(520,280)
$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false;$form.MinimizeBox=$true
$label=[System.Windows.Forms.Label]::new();$label.Text=$Title;$label.AutoSize=$true
$label.Location=[System.Drawing.Point]::new(28,28);$label.Font=[System.Drawing.Font]::new('Segoe UI',16,[System.Drawing.FontStyle]::Bold)
$button=[System.Windows.Forms.Button]::new();$button.Name='ActionButton';$button.Text=$ButtonName;$button.AccessibleName=$ButtonName
$button.Size=[System.Drawing.Size]::new(420,76);$button.Location=[System.Drawing.Point]::new(42,88);$button.Font=[System.Drawing.Font]::new('Segoe UI',14)
$status=[System.Windows.Forms.Label]::new();$status.Name='StatusLabel';$status.Text='ready';$status.AccessibleName="$ButtonName Status Ready"
$status.AutoSize=$true;$status.Location=[System.Drawing.Point]::new(42,188)
$button.Add_Click({$button.Text="$ButtonName Accepted";$button.AccessibleName="$ButtonName Accepted";$status.Text='accepted';$status.AccessibleName="$ButtonName Status Accepted"})
$form.Controls.Add($label);$form.Controls.Add($button);$form.Controls.Add($status);$form.Add_Shown({$form.Activate()})
[System.Windows.Forms.Application]::Run($form)
