using System.Diagnostics;
using System.Text.Json;

namespace GptOperator.Client;

internal sealed partial class TrayApplicationContext
{
    private readonly ToolStripMenuItem _remote=new("Real Remote · checking…"){Enabled=false,Visible=false};
    private readonly ToolStripMenuItem _remotePermissions=new("Real Remote permissions",null,(_,_)=>OpenRemotePermissions()){Visible=false};
    private string _remoteMode="idle";

    private static void OpenRemotePermissions(){try{Process.Start(new ProcessStartInfo(WallUrl+"permissions"){UseShellExecute=true});}catch{}}

    private void ApplyRealRemoteState(JsonElement root)
    {
        var available=false;var enabled=false;var control=false;var mode="idle";
        if(root.TryGetProperty("realRemote",out var rr)&&rr.ValueKind==JsonValueKind.Object)
        {
            available=rr.TryGetProperty("available",out var a)&&a.GetBoolean();
            enabled=rr.TryGetProperty("enabled",out var e)&&e.GetBoolean();
            control=rr.TryGetProperty("controlAllowed",out var c)&&c.GetBoolean();
            mode=rr.TryGetProperty("mode",out var m)?m.GetString()??"idle":"idle";
            if(mode!="viewing"&&mode!="controlling")mode="idle";
        }
        _remote.Visible=available;_remotePermissions.Visible=available;
        _remote.Text=!enabled?"Real Remote · Off":mode=="controlling"?"Real Remote · Agent controlling":mode=="viewing"?"Real Remote · Agent viewing":control?"Real Remote · Ready · control allowed":"Real Remote · Ready · view only";
        if(available&&enabled&&mode=="viewing"&&_remoteMode=="idle")_tray.ShowBalloonTip(3500,"Light Remote RM","An authorized Agent is viewing this device.",ToolTipIcon.Info);
        else if(available&&enabled&&mode=="controlling"&&_remoteMode!="controlling")_tray.ShowBalloonTip(3500,"Light Remote RM","An authorized Agent is controlling this device.",ToolTipIcon.Info);
        _remoteMode=available&&enabled?mode:"idle";
    }

    private string RemoteTooltipSuffix()=>_remoteMode=="controlling"?" · Agent controlling":_remoteMode=="viewing"?" · Agent viewing":"";
}
