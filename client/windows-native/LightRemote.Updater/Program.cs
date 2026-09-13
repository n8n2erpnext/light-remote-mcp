using System.Text.Json;

namespace LightRemote.Updater;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        RecoveryPaths.EnsureDirectories();
        try
        {
            var apply=Array.IndexOf(args,"--apply-update");if(apply>=0&&apply+4<args.Length){_=int.TryParse(args[apply+4],out var parentPid);return await UpdateApplier.ApplyAsync(args[apply+1],args[apply+2],args[apply+3],parentPid);}
            var verify=Array.IndexOf(args,"--verify-update-fixture");if(verify>=0&&verify+3<args.Length)return VerifyFixture(args[verify+1],args[verify+2],args[verify+3])?0:1;
            var self=Array.IndexOf(args,"--self-test-output");if(self>=0&&self+2<args.Length)return SelfTest(args[self+1],args[self+2])?0:1;
            var scheduled=Array.IndexOf(args,"--scheduled-update");if(scheduled>=0&&scheduled+2<args.Length&&string.Equals(args[scheduled+1],"--install-dir",StringComparison.OrdinalIgnoreCase))return await RunScheduledUpdateAsync(args[scheduled+2]);
            return 2;
        }
        catch(FileNotFoundException){return 0;}
        catch(Exception ex){UpdateApplier.Log($"updater_failed {ex.GetType().Name}: {ex.Message}");return 1;}
    }

    private static async Task<int> RunScheduledUpdateAsync(string installDir)
    {
        if(!Path.IsPathFullyQualified(installDir))throw new InvalidOperationException("Install directory must be absolute.");var versionFile=Path.Combine(installDir,"VERSION");if(!File.Exists(versionFile))throw new FileNotFoundException("Installed VERSION file is missing.",versionFile);var currentVersion=File.ReadAllText(versionFile).Trim();
        var client=new UpdateClient();var update=await client.CheckAsync(currentVersion);if(update is null)return 0;var installer=await client.DownloadAndVerifyAsync(update);client.LaunchApplyHelper(installer,installDir,currentVersion);return 0;
    }
    private static bool VerifyFixture(string manifest,string signature,string output){try{UpdateClient.VerifySignedManifest(File.ReadAllBytes(manifest),File.ReadAllText(signature).Trim(),RecoveryPaths.UpdatePublicKey);File.WriteAllText(output,JsonSerializer.Serialize(new{ok=true,updateSignature="valid",runtime="independent-updater"}));return true;}catch(Exception ex){File.WriteAllText(output,JsonSerializer.Serialize(new{ok=false,error=ex.Message}));return false;}}
    private static bool SelfTest(string output,string installDir){try{var process=Environment.ProcessPath??"";var appExe=Path.Combine(installDir,"GptOperator.Client.exe");var result=new{ok=File.Exists(process)&&File.Exists(RecoveryPaths.UpdatePublicKey)&&Path.IsPathFullyQualified(installDir),runtime="independent-updater",updater=process,app=appExe,updaterOutsideApp=!IsUnder(process,installDir)};File.WriteAllText(output,JsonSerializer.Serialize(result));return result.ok&&result.updaterOutsideApp;}catch(Exception ex){File.WriteAllText(output,JsonSerializer.Serialize(new{ok=false,error=ex.Message}));return false;}}
    private static bool IsUnder(string file,string root){var f=Path.GetFullPath(file).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;var r=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;return f.StartsWith(r,StringComparison.OrdinalIgnoreCase);}
}
