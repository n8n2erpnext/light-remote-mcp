using System.Text.Json.Nodes;

namespace LightRemote.Updater;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        try
        {
            var apply=Array.IndexOf(args,"--apply-update");if(apply>=0&&apply+6<args.Length){_=int.TryParse(args[apply+4],out var parentPid);return await UpdateApplier.ApplyAsync(args[apply+1],args[apply+2],args[apply+3],parentPid,args[apply+5],args[apply+6]);}
            var verify=Array.IndexOf(args,"--verify-update-fixture");if(verify>=0&&verify+3<args.Length)return VerifyFixture(args[verify+1],args[verify+2],args[verify+3])?0:1;
            var self=Array.IndexOf(args,"--self-test-output");if(self>=0&&self+2<args.Length)return SelfTest(args[self+1],args[self+2])?0:1;
            var check=Array.IndexOf(args,"--check-update");if(check>=0&&check+2<args.Length&&string.Equals(args[check+1],"--install-dir",StringComparison.OrdinalIgnoreCase))return await RunCheckUpdateAsync(args[check+2]);
            var now=Array.IndexOf(args,"--apply-update-now");if(now>=0&&now+2<args.Length&&string.Equals(args[now+1],"--install-dir",StringComparison.OrdinalIgnoreCase))return await RunApplyUpdateNowAsync(args[now+2]);
            var scheduled=Array.IndexOf(args,"--scheduled-update");if(scheduled>=0&&scheduled+2<args.Length&&string.Equals(args[scheduled+1],"--install-dir",StringComparison.OrdinalIgnoreCase))return await RunCheckUpdateAsync(args[scheduled+2]);
            return 2;
        }
        catch(FileNotFoundException){return 0;}
        catch(Exception ex){UpdateApplier.Log($"updater_failed {ex.GetType().Name}: {ex.Message}");return 1;}
    }

    private static string CurrentVersion(string installDir){if(!Path.IsPathFullyQualified(installDir))throw new InvalidOperationException("Install directory must be absolute.");var file=Path.Combine(installDir,"VERSION");if(!File.Exists(file))throw new FileNotFoundException("Installed VERSION file is missing.",file);return File.ReadAllText(file).Trim();}
    private static void WriteJson(string file,JsonObject value){RecoveryPaths.EnsureDirectories();var tmp=file+"."+Environment.ProcessId+".tmp";File.WriteAllText(tmp,value.ToJsonString());File.Move(tmp,file,true);}
    private static void WriteStatus(string state,string currentVersion,string? targetVersion=null,string? code=null)=>WriteJson(RecoveryPaths.StatusFile,new JsonObject{{"state",state},{"currentVersion",currentVersion},{"targetVersion",targetVersion},{"helperVersion",RecoveryPaths.HelperVersion()},{"code",code},{"updatedAt",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}});
    private static async Task<int> RunCheckUpdateAsync(string installDir)
    {
        var current=CurrentVersion(installDir);WriteStatus("checking",current);try{var update=await new UpdateClient().CheckAsync(current);WriteStatus(update is null?"idle":"available",current,update?.Version);return 0;}catch(FileNotFoundException){WriteStatus("idle",current);return 0;}catch{WriteStatus("failed",current,null,"LRU100");throw;}
    }
    private static async Task<int> RunApplyUpdateNowAsync(string installDir)
    {
        var current=CurrentVersion(installDir);WriteStatus("checking",current);var client=new UpdateClient();UpdateInfo? update;try{update=await client.CheckAsync(current);}catch(FileNotFoundException){WriteStatus("idle",current);return 0;}catch{WriteStatus("failed",current,null,"LRU100");throw;}if(update is null){WriteStatus("idle",current);return 0;}WriteStatus("downloading",current,update.Version);var installer=await client.DownloadAndVerifyAsync(update);var txId="ut_"+Guid.NewGuid().ToString("N");WriteJson(RecoveryPaths.TransactionFile,new JsonObject{{"schemaVersion",1},{"txId",txId},{"fromVersion",current},{"targetVersion",update.Version},{"startedAt",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}});try{File.Delete(RecoveryPaths.AckFile);}catch{}WriteStatus("installing_core",current,update.Version);client.LaunchApplyHelper(installer,installDir,current,update.Version,txId);return 0;
    }
    private static bool VerifyFixture(string manifest,string signature,string output){try{UpdateClient.VerifySignedManifest(File.ReadAllBytes(manifest),File.ReadAllText(signature).Trim(),RecoveryPaths.UpdatePublicKey);File.WriteAllText(output,new JsonObject{{"ok",true},{"updateSignature","valid"},{"runtime","independent-updater"}}.ToJsonString());return true;}catch(Exception ex){File.WriteAllText(output,new JsonObject{{"ok",false},{"error",ex.Message}}.ToJsonString());return false;}}
    private static bool SelfTest(string output,string installDir){try{var process=Environment.ProcessPath??"";var appExe=Path.Combine(installDir,"GptOperator.Client.exe");var ok=File.Exists(process)&&File.Exists(RecoveryPaths.UpdatePublicKey)&&Path.IsPathFullyQualified(installDir);var outside=!IsUnder(process,installDir);var result=new JsonObject{{"ok",ok},{"runtime","independent-updater"},{"helperVersion",RecoveryPaths.HelperVersion()},{"updater",process},{"app",appExe},{"updaterOutsideApp",outside}};File.WriteAllText(output,result.ToJsonString());return ok&&outside;}catch(Exception ex){File.WriteAllText(output,new JsonObject{{"ok",false},{"error",ex.Message}}.ToJsonString());return false;}}
    private static bool IsUnder(string file,string root){var f=Path.GetFullPath(file).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;var r=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;return f.StartsWith(r,StringComparison.OrdinalIgnoreCase);}
}
