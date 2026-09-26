$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form=[System.Windows.Forms.Form]::new();$form.Text='Light Remote UIA Mouse Buttons';$form.StartPosition='CenterScreen'
$form.Size=[System.Drawing.Size]::new(660,360);$form.FormBorderStyle='FixedDialog'
$label=[System.Windows.Forms.Label]::new();$label.Text='Right-click for native context menu; middle-click for direct action'
$label.AutoSize=$true;$label.Location=[System.Drawing.Point]::new(45,40)
$target=[System.Windows.Forms.Button]::new();$target.Text='Mouse Target';$target.AccessibleName='Light Remote Context Target'
$target.Size=[System.Drawing.Size]::new(520,100);$target.Location=[System.Drawing.Point]::new(55,95);$target.Font=[System.Drawing.Font]::new('Segoe UI',14)
$status=[System.Windows.Forms.Label]::new();$status.Text='mouse ready';$status.AccessibleName='Light Remote Mouse Ready'
$status.AutoSize=$true;$status.Location=[System.Drawing.Point]::new(55,235)
$menu=[System.Windows.Forms.ContextMenuStrip]::new()
$contextAction=[System.Windows.Forms.ToolStripMenuItem]::new('Context Action');$contextAction.AccessibleName='Light Remote Context Action'
$contextAction.Add_Click({$target.Text='Context Accepted';$target.AccessibleName='Light Remote Context Accepted';$status.Text='context accepted';$status.AccessibleName='Light Remote Context Accepted Status'})
$menu.Items.Add($contextAction)|Out-Null
$menu.Add_Opened({$status.Text='context open';$status.AccessibleName='Light Remote Context Open'})
$target.ContextMenuStrip=$menu
$target.Add_MouseDown({param($sender,$eventArgs);if($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Middle){$target.Text='Middle Accepted';$target.AccessibleName='Light Remote Middle Accepted';$status.Text='middle accepted';$status.AccessibleName='Light Remote Middle Accepted Status'}})
$form.Controls.AddRange(@($label,$target,$status));$form.Add_Shown({$form.Activate()})
[System.Windows.Forms.Application]::Run($form)
