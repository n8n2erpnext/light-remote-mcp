using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Text.Json;

namespace GptOperator.Client;

internal sealed class TrayApplicationContext : ApplicationContext
{
    private const string AgentTask="LightRemoteDeviceAgent", UpdateTask="LightRemoteUpdater", WallUrl="http://127.0.0.1:5491/";
    private readonly NotifyIcon _tray; private readonly ToolStripMenuItem _state=new("Starting\\u2026"){Enabled=false}; private readonly ToolStripMenuItem _connect=new("Connect"); private readonly System.Windows.Forms.Timer _timer=new(){Interval=5000}; private bool _busy;
    public TrayApplicationContext(){
        ClientEvent("tray_started",new{version=Application.ProductVersion});
        var menu=new ContextMenuStrip();UiTheme.StyleMenu(menu);menu.Items.Add(_state);menu.Items.Add(new ToolStripSeparator());menu.Items.Add(new ToolStripMenuItem("Open Local Wall",null,(_,_)=>OpenWall()));menu.Items.Add(_connect);menu.Items.Add(new ToolStripMenuItem("Restart Light Remote",null,async(_,_)=>await TaskActionAsync("/End /TN \""+AgentTask+"\"",restart:true)));menu.Items.Add(new ToolStripMenuItem("Check for updates",null,async(_,_)=>await TaskActionAsync("/Run /TN \""+UpdateTask+"\"")));menu.Items.Add(new ToolStripMenuItem("Stop Light Remote",null,async(_,_)=>await TaskActionAsync("/End /TN \""+AgentTask+"\"")));menu.Items.Add(new ToolStripSeparator());menu.Items.Add(new ToolStripMenuItem("Quit tray",null,(_,_)=>ExitThread()));
        _connect.Click+=async(_,_)=>await ToggleConnectionAsync();_tray=new NotifyIcon{Visible=true,Text="Light Remote",ContextMenuStrip=menu,Icon=TrayIconFactory.Create(false,false)};_tray.DoubleClick+=(_,_)=>OpenWall();_timer.Tick+=async(_,_)=>await RefreshAsync();_timer.Start();_=RefreshAsync();
    }
    private static void OpenWall(){try{Process.Start(new ProcessStartInfo(WallUrl){UseShellExecute=true});}catch(Exception ex){ClientEvent("wall_open_failed",new{error=ex.Message});}}
    private static ProcessStartInfo AgentStart(params string[] args){var p=new ProcessStartInfo(AppPaths.NodeExe){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)};p.ArgumentList.Add(AppPaths.AgentScript);foreach(var a in args)p.ArgumentList.Add(a);p.Environment["OPERATOR_AGENT_STATE"]=AppPaths.StateFile;p.Environment["HOME"]=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);var c=ConnectionConfig.Load();p.Environment["OPERATOR_AGENT_BASE_URL"]=c.BridgeUrl;p.Environment["OPERATOR_AGENT_HUB_URL"]=c.HubUrl;return p;}
    private static async Task<(int Code,string Out,string Err)> AgentAsync(params string[] args){using var p=new Process{StartInfo=AgentStart(args)};p.Start();var o=p.StandardOutput.ReadToEndAsync();var e=p.StandardError.ReadToEndAsync();await p.WaitForExitAsync();return(p.ExitCode,await o,await e);}
    private static bool TaskRunning(){try{using var p=Process.Start(new ProcessStartInfo("schtasks.exe",$"/Query /TN \"{AgentTask}\" /FO LIST /V"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true});if(p is null)return false;var text=p.StandardOutput.ReadToEnd();p.WaitForExit(3000);return p.ExitCode==0&&text.Contains("Running",StringComparison.OrdinalIgnoreCase);}catch{return false;}}
    private static bool WallPortListening(){try{foreach(var ep in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())if(ep.Port==5491)return true;return false;}catch{return true;}}
    private static bool WaitForAgentReleased(int timeoutMs=8000){var sw=Stopwatch.StartNew();while(sw.ElapsedMilliseconds<timeoutMs){if(!WallPortListening()&&!TaskRunning()){Thread.Sleep(150);if(!WallPortListening()&&!TaskRunning())return true;}Thread.Sleep(150);}return false;}
    private static void ClientEvent(string name,object? data=null){try{var dir=Path.Combine(AppContext.BaseDirectory,"logs");Directory.CreateDirectory(dir);var line=JsonSerializer.Serialize(new{at=DateTimeOffset.UtcNow.ToString("O"),@event=name,pid=Environment.ProcessId,data});File.AppendAllText(Path.Combine(dir,"client-events.jsonl"),line+Environment.NewLine);}catch{}}
    private async Task RefreshAsync(){if(_busy)return;_busy=true;try{var r=await AgentAsync("status");bool enrolled=false,connected=false;string plan="";if(r.Code==0){using var d=JsonDocument.Parse(r.Out);var root=d.RootElement;enrolled=root.TryGetProperty("enrolled",out var en)&&en.GetBoolean();connected=root.TryGetProperty("cloudDesiredConnected",out var dc)&&dc.GetBoolean()&&root.TryGetProperty("cloudState",out var cs)&&cs.GetString()=="connected";plan=root.TryGetProperty("connectionPlan",out var cp)?cp.GetString()??"":"";}var running=TaskRunning();var label=!running?"Stopped":!enrolled?"Running \\u00B7 not linked":connected?"Connected"+(plan.Length>0?" \\u00B7 "+plan.ToUpperInvariant():""):"Running \\u00B7 dormant";_state.Text=label;_connect.Text=connected?"Disconnect":"Connect";_connect.Enabled=running&&enrolled;var title="Light Remote \\u2014 "+label;_tray.Text=title[..Math.Min(63,title.Length)];var old=_tray.Icon;_tray.Icon=TrayIconFactory.Create(connected,enrolled);old?.Dispose();}catch(Exception ex){_state.Text="Status unavailable";ClientEvent("tray_refresh_failed",new{error=ex.Message});}finally{_busy=false;}}
    private async Task ToggleConnectionAsync(){if(_busy)return;_busy=true;try{var r=await AgentAsync("status");using var d=JsonDocument.Parse(r.Out);var root=d.RootElement;var connected=root.TryGetProperty("cloudDesiredConnected",out var dc)&&dc.GetBoolean()&&root.TryGetProperty("cloudState",out var cs)&&cs.GetString()=="connected";ClientEvent("cloud_toggle_requested",new{from=connected?"connected":"dormant"});var result=await AgentAsync(connected?"disconnect":"connect");ClientEvent("cloud_toggle_completed",new{exitCode=result.Code});}catch(Exception e){ClientEvent("cloud_toggle_failed",new{error=e.Message});_tray.ShowBalloonTip(3000,"Light Remote",e.Message,ToolTipIcon.Warning);}finally{_busy=false;await RefreshAsync();}}
    private async Task TaskActionAsync(string args,bool restart=false){
        var outcome=await Task.Run(()=>{
            try{
                ClientEvent(restart?"restart_end_requested":"task_action_requested",new{restart});
                using var p=Process.Start(new ProcessStartInfo("schtasks.exe",args){UseShellExecute=false,CreateNoWindow=true});p?.WaitForExit(5000);
                ClientEvent("task_action_completed",new{restart,exitCode=p?.HasExited==true?p.ExitCode:-1});
                if(!restart)return (Ok:true,Message:"");
                var sw=Stopwatch.StartNew();var released=WaitForAgentReleased();ClientEvent("restart_barrier_completed",new{released,elapsedMs=sw.ElapsedMilliseconds,wallPortListening=WallPortListening(),taskRunning=TaskRunning()});
                if(!released)return (Ok:false,Message:"Old Light Remote runtime did not release port 5491. Restart aborted to prevent a duplicate agent.");
                using var r=Process.Start(new ProcessStartInfo("schtasks.exe",$"/Run /TN \"{AgentTask}\""){UseShellExecute=false,CreateNoWindow=true});r?.WaitForExit(5000);var ok=r?.HasExited==true&&r.ExitCode==0;ClientEvent("restart_run_completed",new{ok,exitCode=r?.HasExited==true?r.ExitCode:-1});return (Ok:ok,Message:ok?"":"Scheduled Task restart failed.");
            }catch(Exception ex){ClientEvent("task_action_failed",new{restart,error=ex.Message});return (Ok:false,Message:ex.Message);}
        });
        if(!outcome.Ok&&!string.IsNullOrWhiteSpace(outcome.Message))_tray.ShowBalloonTip(5000,"Light Remote",outcome.Message,ToolTipIcon.Warning);
        await RefreshAsync();
    }
    protected override void ExitThreadCore(){ClientEvent("tray_stopped");_timer.Stop();_timer.Dispose();_tray.Visible=false;_tray.Icon?.Dispose();_tray.Dispose();base.ExitThreadCore();}
}
