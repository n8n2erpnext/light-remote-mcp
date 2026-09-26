$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$main=[System.Windows.Forms.Form]::new();$main.Text='Light Remote UIA Modal Parent';$main.StartPosition='CenterScreen'
$main.Size=[System.Drawing.Size]::new(560,300);$main.FormBorderStyle='FixedDialog'
$open=[System.Windows.Forms.Button]::new();$open.Text='Open Modal';$open.AccessibleName='Light Remote Open Modal'
$open.Size=[System.Drawing.Size]::new(420,76);$open.Location=[System.Drawing.Point]::new(55,70);$open.Font=[System.Drawing.Font]::new('Segoe UI',14)
$status=[System.Windows.Forms.Label]::new();$status.Text='parent ready';$status.AccessibleName='Light Remote Parent Ready';$status.AutoSize=$true;$status.Location=[System.Drawing.Point]::new(55,180)
$open.Add_Click({
  $dialog=[System.Windows.Forms.Form]::new();$dialog.Text='Light Remote UIA Modal Dialog';$dialog.StartPosition='CenterParent'
  $dialog.Size=[System.Drawing.Size]::new(500,290);$dialog.FormBorderStyle='FixedDialog';$dialog.MaximizeBox=$false;$dialog.MinimizeBox=$false
  $action=[System.Windows.Forms.Button]::new();$action.Text='Modal Action';$action.AccessibleName='Light Remote Modal Action'
  $action.Size=[System.Drawing.Size]::new(380,68);$action.Location=[System.Drawing.Point]::new(48,45)
  $close=[System.Windows.Forms.Button]::new();$close.Text='Close Modal';$close.AccessibleName='Light Remote Close Modal'
  $close.Size=[System.Drawing.Size]::new(380,58);$close.Location=[System.Drawing.Point]::new(48,135)
  $action.Add_Click({$action.Text='Modal Accepted';$action.AccessibleName='Light Remote Modal Accepted'})
  $close.Add_Click({$dialog.Close()})
  $dialog.Controls.Add($action);$dialog.Controls.Add($close)
  $null=$dialog.ShowDialog($main)
  $dialog.Dispose()
  $status.Text='modal closed';$status.AccessibleName='Light Remote Modal Closed'
})
$main.Controls.Add($open);$main.Controls.Add($status)
[System.Windows.Forms.Application]::Run($main)
