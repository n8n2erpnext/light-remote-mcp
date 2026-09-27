param([string]$Title='Light Remote UIA Event Storm')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form=[System.Windows.Forms.Form]::new();$form.Text=$Title;$form.StartPosition='CenterScreen';$form.Size=[System.Drawing.Size]::new(720,520)
$burst=[System.Windows.Forms.Button]::new();$burst.Text='Burst Structure Events';$burst.AccessibleName='Burst Structure Events';$burst.Size=[System.Drawing.Size]::new(260,54);$burst.Location=[System.Drawing.Point]::new(20,20)
$status=[System.Windows.Forms.Label]::new();$status.Text='Ready';$status.AccessibleName='Event Storm Ready';$status.AutoSize=$true;$status.Location=[System.Drawing.Point]::new(310,38)
$panel=[System.Windows.Forms.FlowLayoutPanel]::new();$panel.Location=[System.Drawing.Point]::new(20,92);$panel.Size=[System.Drawing.Size]::new(660,360);$panel.AutoScroll=$true
$burst.Add_Click({
  $burst.Enabled=$false
  for($i=0;$i -lt 90;$i++){
    $c=[System.Windows.Forms.Label]::new();$c.Text=('Dynamic '+$i);$c.AccessibleName=('Dynamic '+$i);$c.AutoSize=$true;$c.Margin=[System.Windows.Forms.Padding]::new(3)
    $panel.Controls.Add($c)
  }
  [System.Windows.Forms.Application]::DoEvents()
  for($i=0;$i -lt 70;$i++){if($panel.Controls.Count -gt 0){$c=$panel.Controls[$panel.Controls.Count-1];$panel.Controls.Remove($c);$c.Dispose()}}
  for($i=0;$i -lt 30;$i++){
    $c=[System.Windows.Forms.Button]::new();$c.Text=('New '+$i);$c.AccessibleName=('New '+$i);$c.AutoSize=$true;$panel.Controls.Add($c)
  }
  $status.Text='Burst Complete';$status.AccessibleName='Event Storm Complete';$burst.Enabled=$true
})
$form.Controls.Add($burst);$form.Controls.Add($status);$form.Controls.Add($panel)
[System.Windows.Forms.Application]::Run($form)
