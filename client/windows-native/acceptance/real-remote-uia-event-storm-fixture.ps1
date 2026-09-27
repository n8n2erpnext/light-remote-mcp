param([string]$Title='Light Remote UIA Event Storm',[Parameter(Mandatory=$true)][string]$TriggerPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$window=[System.Windows.Window]::new();$window.Title=$Title;$window.Width=760;$window.Height=560;$window.WindowStartupLocation='CenterScreen'
$root=[System.Windows.Controls.DockPanel]::new()
$header=[System.Windows.Controls.TextBlock]::new();$header.Text='UIA Structure Event Storm Fixture';$header.FontSize=20;$header.Margin='14'
[System.Windows.Controls.DockPanel]::SetDock($header,'Top');$root.Children.Add($header)|Out-Null
$status=[System.Windows.Controls.TextBlock]::new();$status.Text='Ready';$status.Margin='14';[System.Windows.Controls.DockPanel]::SetDock($status,'Bottom');$root.Children.Add($status)|Out-Null
$scroll=[System.Windows.Controls.ScrollViewer]::new();$items=[System.Windows.Controls.WrapPanel]::new();$scroll.Content=$items;$root.Children.Add($scroll)|Out-Null
$window.Content=$root
$done=$false
$timer=[System.Windows.Threading.DispatcherTimer]::new();$timer.Interval=[TimeSpan]::FromMilliseconds(50)
$timer.Add_Tick({
  if($done -or -not(Test-Path -LiteralPath $TriggerPath)){return}
  $script:done=$true;$timer.Stop();Remove-Item -LiteralPath $TriggerPath -Force -ErrorAction SilentlyContinue
  for($i=0;$i -lt 100;$i++){ $b=[System.Windows.Controls.Button]::new();$b.Content=('Dynamic '+$i);$b.Margin='2';$items.Children.Add($b)|Out-Null }
  $window.Dispatcher.Invoke([action]{},[System.Windows.Threading.DispatcherPriority]::Render)
  for($i=0;$i -lt 75;$i++){if($items.Children.Count -gt 0){$items.Children.RemoveAt($items.Children.Count-1)}}
  for($i=0;$i -lt 35;$i++){ $t=[System.Windows.Controls.TextBlock]::new();$t.Text=('New '+$i);$t.Margin='2';$items.Children.Add($t)|Out-Null }
  $status.Text='Burst Complete'
})
$timer.Start()
$null=$window.ShowDialog()
