using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LightRemote.Updater;

internal static class UpdateApplier
{
    public static async Task<int> ApplyAsync(string installer,string installDir,string currentVersion,int parentPid,string targetVersion,string txId)
    {
        RecoveryPaths.EnsureDirectories();var versionCore=currentVersion.Split('-',2)[0];
        if(!Path.IsPathFullyQualified(installer)||!Path.IsPathFullyQualified(installDir)||!Version.TryParse(versionCore,out _)||string.IsNullOrWhiteSpace(targetVersion)||!txId.StartsWith("ut_",StringComparison.Ordinal)){Log("apply_invalid_args");return 23;}
        try
        {
            var rollbackPreflight=RecoveryPaths.RollbackInstaller(currentVersion);
            if(!File.Exists(rollbackPreflight)||new FileInfo(rollbackPreflight).Length<=0)
            {
                Log($"apply_blocked rollback_preflight_missing path={rollbackPreflight}");
                WriteStatus("blocked",currentVersion,targetVersion,"LRU140");
                WriteReport("failed","LRU140","preflight",currentVersion,targetVersion,currentVersion,false,false,"rollback installer missing; current Core was not stopped");
                ClearTransaction();
                return 20;
            }
            Log($"rollback_preflight_ready path={rollbackPreflight} bytes={new FileInfo(rollbackPreflight).Length}");
            await WaitForParentAsync(parentPid);await StopBackgroundAgentTaskAsync();Log($"apply_start current={currentVersion} target={targetVersion}");await StopInstalledRuntimeAsync(installDir);
            if(await TryInstallAndVerifyAsync(installer,installDir))
            {
                TryRestartBackgroundAgentTask();WriteStatus("verifying_core",currentVersion,targetVersion,null);
                if(await WaitForCoreAckAsync(txId,targetVersion,TimeSpan.FromSeconds(35)))
                {
                    WriteStatus("core_healthy",targetVersion,targetVersion,null);
                    if(!await LaunchHelperPromotionAsync(installDir,currentVersion,targetVersion)){WriteStatus("core_healthy_helper_old",targetVersion,targetVersion,"LRU150");WriteReport("failed","LRU150","finalize_helper",currentVersion,targetVersion,targetVersion,false,false,"helper promotion launch failed; prior helper preserved");ClearTransaction();StartInstalledClient(installDir);return 24;}
                    WriteStatus("core_healthy_helper_pending",targetVersion,targetVersion,null);ClearTransaction();Log("apply_core_success helper_promotion_pending");StartInstalledClient(installDir);return 0;
                }
                Log("core_health_ack_timeout attempting_rollback");
            }
            else Log("apply_failed attempting_rollback");
            return await RollbackAsync(installDir,currentVersion,targetVersion,"LRU131","core health gate failed");
        }
        catch(Exception ex)
        {
            Log($"apply_exception {ex.GetType().Name}: {ex.Message}");try{return await RollbackAsync(installDir,currentVersion,targetVersion,"LRU199",ex.Message);}catch(Exception rollbackEx){Log($"rollback_exception {rollbackEx.GetType().Name}: {rollbackEx.Message}");var recovered=await RecoverRuntimeAsync(installDir);WriteStatus(recovered?"recovered":"failed",currentVersion,targetVersion,"LRU141");WriteReport("failed","LRU141","rollback",currentVersion,targetVersion,currentVersion,true,false,$"{rollbackEx.Message}; runtimeRecovered={recovered}");return 22;}
        }
    }
    internal static async Task<int> RestartAgentOnlyAsync(string installDir)
    {
        RecoveryPaths.EnsureDirectories();
        if(!Path.IsPathFullyQualified(installDir)||!File.Exists(Path.Combine(installDir,"GptOperator.Client.exe"))){Log("restart_agent_invalid_install");return 31;}
        Log($"restart_agent_begin helper={Environment.ProcessId}");
        try
        {
            await EndScheduledTaskAsync("LightRemoteDeviceAgent");
            var released=await WaitForWallStateAsync(false,TimeSpan.FromSeconds(12));
            if(!released){Log("restart_agent_release_timeout");await StopInstalledRuntimeAsync(installDir);released=await WaitForWallStateAsync(false,TimeSpan.FromSeconds(8));}
            if(!released){EnsureInstalledTray(installDir);Log("restart_agent_release_failed");return 32;}
            for(var attempt=1;attempt<=5;attempt++)
            {
                TryRestartBackgroundAgentTask();Log($"restart_agent_start_attempt attempt={attempt}");
                if(await WaitForWallStateAsync(true,TimeSpan.FromSeconds(6))){EnsureInstalledTray(installDir);Log($"restart_agent_success attempt={attempt}");return 0;}
                await Task.Delay(400);
            }
            EnsureInstalledTray(installDir);Log("restart_agent_start_failed");return 33;
        }
        catch(Exception ex){EnsureInstalledTray(installDir);Log($"restart_agent_exception {ex.GetType().Name}: {ex.Message}");return 34;}
    }
    private static bool WallPortListening(){try{return System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(ep=>ep.Port==5491);}catch{return false;}}
    private static async Task<bool> WaitForWallStateAsync(bool listening,TimeSpan timeout)
    {
        var deadline=DateTimeOffset.UtcNow+timeout;
        while(DateTimeOffset.UtcNow<deadline){if(WallPortListening()==listening){await Task.Delay(150);if(WallPortListening()==listening)return true;}await Task.Delay(120);}
        return WallPortListening()==listening;
    }
    private static void EnsureInstalledTray(string installDir)
    {
        try{var exe=Path.Combine(installDir,"GptOperator.Client.exe");if(!File.Exists(exe))return;Process.Start(new ProcessStartInfo(exe,"--background"){UseShellExecute=true})?.Dispose();Log("restart_agent_tray_ensure_requested");}
        catch(Exception ex){Log($"restart_agent_tray_ensure_failed {ex.GetType().Name}: {ex.Message}");}
    }
    private static async Task<int> RollbackAsync(string installDir,string currentVersion,string targetVersion,string code,string detail)
    {
        WriteStatus("rolling_back",currentVersion,targetVersion,code);var rollback=RecoveryPaths.RollbackInstaller(currentVersion);if(!File.Exists(rollback)){Log($"rollback_missing path={rollback}");var recovered=await RecoverRuntimeAsync(installDir);WriteStatus(recovered?"recovered":"failed",currentVersion,targetVersion,"LRU140");WriteReport("failed","LRU140","rollback",currentVersion,targetVersion,currentVersion,true,false,$"rollback installer missing; runtimeRecovered={recovered}");ClearTransaction();return 20;}
        await StopInstalledRuntimeAsync(installDir);if(!await TryInstallAndVerifyAsync(rollback,installDir)){Log("rollback_failed");var recovered=await RecoverRuntimeAsync(installDir);WriteStatus(recovered?"recovered":"failed",currentVersion,targetVersion,"LRU141");WriteReport("failed","LRU141","rollback",currentVersion,targetVersion,currentVersion,true,false,$"rollback install or health preflight failed; runtimeRecovered={recovered}");ClearTransaction();return 21;}
        WriteStatus("rollback",currentVersion,targetVersion,code);WriteReport("rollback",code,"verify_core",currentVersion,targetVersion,currentVersion,true,true,detail);ClearTransaction();Log("rollback_success");StartInstalledClient(installDir);return 0;
    }
    private static async Task<bool> RecoverRuntimeAsync(string installDir)
    {
        TryRestartBackgroundAgentTask();
        if(await WaitForWallStateAsync(true,TimeSpan.FromSeconds(8))){Log("runtime_recovery_task_success");return true;}
        try
        {
            var exe=Path.Combine(installDir,"GptOperator.Client.exe");
            if(File.Exists(exe))
            {
                var psi=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true};
                psi.ArgumentList.Add("--agent-host");
                Process.Start(psi)?.Dispose();
                Log("runtime_recovery_direct_agent_requested");
            }
        }
        catch(Exception ex){Log($"runtime_recovery_direct_agent_failed {ex.GetType().Name}: {ex.Message}");}
        if(await WaitForWallStateAsync(true,TimeSpan.FromSeconds(12))){Log("runtime_recovery_direct_agent_success");EnsureInstalledTray(installDir);return true;}
        EnsureInstalledTray(installDir);Log("runtime_recovery_failed");return false;
    }
    private static async Task StopBackgroundAgentTaskAsync(){try{await EndScheduledTaskAsync("LightRemoteDeviceAgent");await Task.Delay(350);Log("agent_task_stop");}catch(Exception ex){Log($"agent_task_stop_failed {ex.GetType().Name}: {ex.Message}");}}
    private static void TryRestartBackgroundAgentTask(){try{var psi=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"schtasks.exe")){UseShellExecute=false,CreateNoWindow=true};psi.ArgumentList.Add("/Run");psi.ArgumentList.Add("/TN");psi.ArgumentList.Add("LightRemoteDeviceAgent");Process.Start(psi)?.Dispose();Log("agent_task_restart_requested");}catch(Exception ex){Log($"agent_task_restart_failed {ex.GetType().Name}: {ex.Message}");}}
    private static async Task WaitForParentAsync(int parentPid){if(parentPid<=0)return;try{using var parent=Process.GetProcessById(parentPid);using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(30));await parent.WaitForExitAsync(timeout.Token);}catch(ArgumentException){}catch(OperationCanceledException){Log("parent_wait_timeout");}}
    private static async Task StopInstalledRuntimeAsync(string installDir)
    {
        await EndScheduledTaskAsync("LightRemoteDeviceAgent");var targets=new[]{Path.GetFullPath(Path.Combine(installDir,"GptOperator.Client.exe")),Path.GetFullPath(Path.Combine(installDir,"runtime","node.exe"))};
        foreach(var process in Process.GetProcesses()){try{var path=process.MainModule?.FileName;if(path is null||!targets.Any(target=>string.Equals(Path.GetFullPath(path),target,StringComparison.OrdinalIgnoreCase)))continue;Log($"stopping_runtime pid={process.Id} file={Path.GetFileName(path)}");process.Kill(entireProcessTree:false);using var stopTimeout=new CancellationTokenSource(TimeSpan.FromSeconds(5));try{await process.WaitForExitAsync(stopTimeout.Token);}catch(OperationCanceledException){Log($"stopping_runtime_timeout pid={process.Id} file={Path.GetFileName(path)}");}}catch{}finally{process.Dispose();}}
    }
    private static async Task EndScheduledTaskAsync(string taskName){try{var psi=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"schtasks.exe")){UseShellExecute=false,CreateNoWindow=true};psi.ArgumentList.Add("/End");psi.ArgumentList.Add("/TN");psi.ArgumentList.Add(taskName);using var process=Process.Start(psi);if(process is not null)await WaitForExitOrKillAsync(process,TimeSpan.FromSeconds(10),"task_end");}catch{}}
    private static async Task<bool> TryInstallAndVerifyAsync(string installer,string installDir)
    {
        if(!File.Exists(installer))return false;int exitCode;try{var psi=new ProcessStartInfo(installer){UseShellExecute=false,CreateNoWindow=true};foreach(var arg in new[]{"/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/CLOSEAPPLICATIONS",$"/DIR={installDir}"})psi.ArgumentList.Add(arg);using var process=Process.Start(psi);if(process is null)return false;if(!await WaitForExitOrKillAsync(process,TimeSpan.FromSeconds(120),"installer"))return false;exitCode=process.ExitCode;}catch(Exception ex){Log($"installer_start_failed {ex.GetType().Name}: {ex.Message}");return false;}if(exitCode!=0){Log($"installer_exit={exitCode}");return false;}
        var installedExe=Path.Combine(installDir,"GptOperator.Client.exe");if(!File.Exists(installedExe))return false;var result=Path.Combine(RecoveryPaths.CacheDir,$"health-{Guid.NewGuid():N}.json");
        try{using var health=Process.Start(new ProcessStartInfo(installedExe){UseShellExecute=false,CreateNoWindow=true,ArgumentList={"--self-test-output",result}});if(health is null)return false;if(!await WaitForExitOrKillAsync(health,TimeSpan.FromSeconds(30),"health"))return false;if(health.ExitCode!=0||!File.Exists(result))return false;using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(result));return doc.RootElement.TryGetProperty("ok",out var ok)&&ok.GetBoolean();}catch(Exception ex){Log($"health_check_failed {ex.GetType().Name}: {ex.Message}");return false;}finally{try{File.Delete(result);}catch{}}
    }
    private static async Task<bool> WaitForExitOrKillAsync(Process process,TimeSpan timeout,string phase){using var cts=new CancellationTokenSource(timeout);try{await process.WaitForExitAsync(cts.Token);return true;}catch(OperationCanceledException){Log($"{phase}_timeout seconds={(int)timeout.TotalSeconds}");try{if(!process.HasExited)process.Kill(entireProcessTree:true);}catch{}try{await process.WaitForExitAsync();}catch{}return false;}}
    private static async Task<bool> WaitForCoreAckAsync(string txId,string targetVersion,TimeSpan timeout)
    {
        var deadline=DateTimeOffset.UtcNow+timeout;while(DateTimeOffset.UtcNow<deadline){try{if(File.Exists(RecoveryPaths.AckFile)){using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(RecoveryPaths.AckFile));var root=doc.RootElement;if(root.TryGetProperty("txId",out var id)&&root.TryGetProperty("version",out var version)&&root.TryGetProperty("healthy",out var healthy)&&id.GetString()==txId&&version.GetString()==targetVersion&&healthy.GetBoolean())return true;}}catch{}await Task.Delay(250);}return false;
    }
    private static void WriteJson(string file,JsonObject value){RecoveryPaths.EnsureDirectories();var tmp=file+"."+Environment.ProcessId+".tmp";File.WriteAllText(tmp,value.ToJsonString());File.Move(tmp,file,true);}
    private static void WriteStatus(string state,string currentVersion,string? targetVersion,string? code)=>WriteJson(RecoveryPaths.StatusFile,new JsonObject{{"state",state},{"currentVersion",currentVersion},{"targetVersion",targetVersion},{"helperVersion",RecoveryPaths.HelperVersion()},{"code",code},{"updatedAt",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}});
    private static void WriteReport(string outcome,string? code,string phase,string fromVersion,string? targetVersion,string activeVersion,bool attemptedRollback,bool rollbackSuccess,string? detail)=>WriteJson(RecoveryPaths.ReportFile,new JsonObject{{"schemaVersion",1},{"reportId","ur_"+Guid.NewGuid().ToString("N")},{"outcome",outcome},{"code",code},{"phase",phase},{"fromVersion",fromVersion},{"targetVersion",targetVersion},{"activeVersion",activeVersion},{"helperVersion",RecoveryPaths.HelperVersion()},{"platform","windows-x64"},{"rollback",new JsonObject{{"attempted",attemptedRollback},{"success",rollbackSuccess}}},{"detail",detail},{"at",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}});
    private static void ClearTransaction(){try{File.Delete(RecoveryPaths.TransactionFile);}catch{}try{File.Delete(RecoveryPaths.AckFile);}catch{}}
    private static async Task<bool> LaunchHelperPromotionAsync(string installDir,string currentVersion,string targetVersion)
    {
        var candidate=Path.Combine(installDir,"helper-candidate");var candidateExe=Path.Combine(candidate,"LightRemote.Updater.exe");if(!File.Exists(candidateExe))return false;RecoveryPaths.EnsureDirectories();
        foreach(var stale in Directory.GetDirectories(RecoveryPaths.CacheDir,"helper-stage-*",SearchOption.TopDirectoryOnly)){try{Directory.Delete(stale,true);}catch{}}
        string stage=Path.Combine(RecoveryPaths.CacheDir,"helper-stage-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);CopyTree(candidate,stage);var stageExe=Path.Combine(stage,"LightRemote.Updater.exe");
        if(!await HelperSelfTestAsync(stageExe,installDir)){try{Directory.Delete(stage,true);}catch{}Log("helper_promotion_stage_health_failed");return false;}
        try{var psi=new ProcessStartInfo(stageExe){UseShellExecute=false,CreateNoWindow=true};foreach(var arg in new[]{"--promote-helper-stage",stage,installDir,Environment.ProcessId.ToString(),currentVersion,targetVersion})psi.ArgumentList.Add(arg);var promoter=Process.Start(psi);if(promoter is null)return false;Log($"helper_promotion_launched pid={promoter.Id} stage={stage}");promoter.Dispose();return true;}
        catch(Exception ex){Log($"helper_promotion_launch_failed {ex.GetType().Name}: {ex.Message}");try{Directory.Delete(stage,true);}catch{}return false;}
    }
    internal static async Task<int> PromoteHelperStageAsync(string stage,string installDir,int parentPid,string currentVersion,string targetVersion)
    {
        RecoveryPaths.EnsureDirectories();if(!Path.IsPathFullyQualified(stage)||!Path.IsPathFullyQualified(installDir)||!Directory.Exists(stage)){Log("helper_promotion_invalid_args");return 24;}
        await WaitForParentAsync(parentPid);string backup=Path.Combine(RecoveryPaths.CacheDir,"helper-backup-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(backup);var files=Directory.GetFiles(stage,"*",SearchOption.AllDirectories);var existed=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try{
            foreach(var src in files){string rel=Path.GetRelativePath(stage,src);string dst=Path.Combine(RecoveryPaths.Root,rel);string bak=Path.Combine(backup,rel);if(File.Exists(dst)){Directory.CreateDirectory(Path.GetDirectoryName(bak)!);File.Copy(dst,bak,true);existed.Add(rel);}Directory.CreateDirectory(Path.GetDirectoryName(dst)!);File.Copy(src,dst,true);}
            if(!await HelperSelfTestAsync(Path.Combine(RecoveryPaths.Root,"LightRemote.Updater.exe"),installDir))throw new InvalidOperationException("helper_candidate_health_failed");
            WriteStatus("success",targetVersion,targetVersion,null);WriteReport("success",null,"complete",currentVersion,targetVersion,targetVersion,false,false,null);Log($"helper_promotion_success stage={stage}");try{Directory.Delete(backup,true);}catch{}return 0;
        }catch(Exception ex){
            Log($"helper_promotion_failed {ex.GetType().Name}: {ex.Message}");foreach(var src in files){string rel=Path.GetRelativePath(stage,src);string dst=Path.Combine(RecoveryPaths.Root,rel);string bak=Path.Combine(backup,rel);try{if(existed.Contains(rel))File.Copy(bak,dst,true);else File.Delete(dst);}catch{}}
            try{Directory.Delete(backup,true);}catch{}WriteStatus("core_healthy_helper_old",targetVersion,targetVersion,"LRU150");WriteReport("failed","LRU150","finalize_helper",currentVersion,targetVersion,targetVersion,false,false,ex.Message);return 24;
        }
    }
    private static void CopyTree(string source,string destination){foreach(var dir in Directory.GetDirectories(source,"*",SearchOption.AllDirectories))Directory.CreateDirectory(Path.Combine(destination,Path.GetRelativePath(source,dir)));foreach(var file in Directory.GetFiles(source,"*",SearchOption.AllDirectories)){var dst=Path.Combine(destination,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(dst)!);File.Copy(file,dst,true);}}
    private static async Task<bool> HelperSelfTestAsync(string exe,string installDir){var output=Path.Combine(RecoveryPaths.CacheDir,"helper-health-"+Guid.NewGuid().ToString("N")+".json");try{var psi=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true};psi.ArgumentList.Add("--self-test-output");psi.ArgumentList.Add(output);psi.ArgumentList.Add(installDir);using var p=Process.Start(psi);if(p is null||!await WaitForExitOrKillAsync(p,TimeSpan.FromSeconds(30),"helper_health")||p.ExitCode!=0||!File.Exists(output))return false;using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(output));return doc.RootElement.TryGetProperty("ok",out var ok)&&ok.GetBoolean();}catch{return false;}finally{try{File.Delete(output);}catch{}}}
    private static void StartInstalledClient(string installDir){TryRestartBackgroundAgentTask();var exe=Path.Combine(installDir,"GptOperator.Client.exe");if(!File.Exists(exe))return;try{Process.Start(new ProcessStartInfo(exe,"--background"){UseShellExecute=true});}catch{}}
    internal static void Log(string text){try{RecoveryPaths.EnsureDirectories();File.AppendAllText(RecoveryPaths.UpdateLog,$"{DateTimeOffset.UtcNow:o} {text}{Environment.NewLine}");}catch{}}
}
