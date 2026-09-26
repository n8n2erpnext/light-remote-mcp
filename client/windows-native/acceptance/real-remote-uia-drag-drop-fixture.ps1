$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form=[System.Windows.Forms.Form]::new();$form.Text='Light Remote UIA Drag Drop';$form.StartPosition='CenterScreen'
$form.Size=[System.Drawing.Size]::new(780,380);$form.FormBorderStyle='FixedDialog'
$source=[System.Windows.Forms.Button]::new();$source.Text='Drag Source';$source.AccessibleName='Light Remote Drag Source'
$source.Size=[System.Drawing.Size]::new(220,110);$source.Location=[System.Drawing.Point]::new(70,90);$source.Font=[System.Drawing.Font]::new('Segoe UI',14)
$target=[System.Windows.Forms.Button]::new();$target.Text='Drop Target';$target.AccessibleName='Light Remote Drop Target'
$target.Size=[System.Drawing.Size]::new(220,110);$target.Location=[System.Drawing.Point]::new(460,90);$target.Font=[System.Drawing.Font]::new('Segoe UI',14)
$status=[System.Windows.Forms.Label]::new();$status.Text='drag ready';$status.AccessibleName='Light Remote Drag Ready'
$status.AutoSize=$true;$status.Location=[System.Drawing.Point]::new(70,250)
$script:dragging=$false
$source.Add_MouseDown({
  param($sender,$eventArgs)
  if($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left){
    $script:dragging=$true;$source.Capture=$true
    $status.Text='dragging';$status.AccessibleName='Light Remote Dragging'
  }
})
$source.Add_MouseUp({
  param($sender,$eventArgs)
  if($script:dragging -and $eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left){
    $screenPoint=[System.Windows.Forms.Control]::MousePosition
    $targetRect=$target.RectangleToScreen($target.ClientRectangle)
    if($targetRect.Contains($screenPoint)){
      $source.Text='Drag Accepted';$source.AccessibleName='Light Remote Drag Accepted'
      $target.Text='Drop Accepted';$target.AccessibleName='Light Remote Drop Accepted'
      $status.Text='drag accepted';$status.AccessibleName='Light Remote Drag Drop Accepted'
    }else{
      $status.Text='drag missed';$status.AccessibleName='Light Remote Drag Missed'
    }
    $source.Capture=$false;$script:dragging=$false
  }
})
$form.Controls.Add($source);$form.Controls.Add($target);$form.Controls.Add($status)
$form.Add_Shown({$form.Activate()})
[System.Windows.Forms.Application]::Run($form)
