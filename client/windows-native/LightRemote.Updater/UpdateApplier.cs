using System.Diagnostics;
using System.Text.Json;

namespace LightRemote.Updater;

internal static class UpdateApplier
{
    public static async Task<int> ApplyAsync(string installer,string installDir,string currentVersion,int parentPid,string targetVersion,string txId)
    {
        RecoveryPaths.EnsureDirectories();var versionCore=currentVersion.Split('-',2)[0];
        if(!Path.IsPathFullyQualified(installer)||!Path.IsPathFullyQualified(installDir)||!Version.TryParse(versionCore,out _)||string.IsNullOrWhiteSpace(targetVersion)||!txId.StartsWith("ut_",StringComparison.Ordinal)){Log("apply_invalid_args");return 23;}
        try
        {
            await WaitForParentAsync(parentPid);await StopBackgroundAgentTaskAsync();Log($"apply_start current={currentVersion} target={targetVersion}");await StopInstalledRuntimeAsync(installDir);
            if(await TryInstallAndVerifyAsync(installer,installDir))
            {
                TryRestartBackgroundAgentTask();WriteStatus("verifying_core",currentVersion,targetVersion,null);
                if(await WaitForCoreAckAsync(txId,targetVersion,TimeSpan.FromSeconds(35)))
                {
                    WriteStatus("core_healthy",targetVersion,targetVersion,null);
                    if(!await FinalizeHelperCandidateAsync(installDir)){WriteStatus("core_healthy_helper_old",targetVersion,targetVersion,"LRU150");WriteReport("failed","LRU150","finalize_helper",currentVersion,targetVersion,targetVersion,false,false,"helper finalize failed; prior helper preserved");ClearTransaction();StartInstalledClient(installDir);return 24;}
                    WriteStatus("success",targetVersion,targetVersion,null);WriteReport("success",null,"complete",currentVersion,targetVersion,targetVersion,false,false,null);ClearTransaction();Log("apply_success");StartInstalledClient(installDir);return 0;
                }
                Log("core_health_ack_timeout attempting_rollback");
            }
            else Log("apply_failed attempting_rollback");
            return await RollbackAsync(installDir,currentVersion,targetVersion,"LRU131","core health gate failed");
        }
        catch(Exception ex)
        {
            Log($"apply_exception {ex.GetType().Name}: {ex.Message}");try{return await RollbackAsync(installDir,currentVersion,targetVersion,"LRU199",ex.Message);}catch(Exception rollbackEx){Log($"rollback_exception {rollbackEx.GetType().Name}: {rollbackEx.Message}");WriteStatus("failed",currentVersion,targetVersion,"LRU141");WriteReport("failed","LRU141","rollback",currentVersion,targetVersion,currentVersion,true,false,rollbackEx.Message);TryRestartBackgroundAgentTask();return 22;}
        }
    }
    private static async Task<int> RollbackAsync(string installDir,string currentVersion,string targetVersion,string code,string detail)
    {
        WriteStatus("rolling_back",currentVersion,targetVersion,code);var rollback=RecoveryPaths.RollbackInstaller(currentVersion);if(!File.Exists(rollback)){Log($"rollback_missing path={rollback}");WriteReport("failed","LRU140","rollback",currentVersion,targetVersion,currentVersion,true,false,"rollback installer missing");ClearTransaction();TryRestartBackgroundAgentTask();return 20;}
        await StopInstalledRuntimeAsync(installDir);if(!await TryInstallAndVerifyAsync(rollback,installDir)){Log("rollback_failed");WriteStatus("failed",currentVersion,targetVersion,"LRU141");WriteReport("failed","LRU141","rollback",currentVersion,targetVersion,currentVersion,true,false,"rollback install or health preflight failed");ClearTransaction();TryRestartBackgroundAgentTask();return 21;}
        WriteStatus("rollback",currentVersion,targetVersion,code);WriteReport("rollback",code,"verify_core",currentVersion,targetVersion,currentVersion,true,true,detail);ClearTransaction();Log("rollback_success");StartInstalledClient(installDir);return 0;
    }
    private static async Task StopBackgroundAgentTaskAsync(){try{await EndScheduledTaskAsync("LightRemoteDeviceAgent");await Task.Delay(350);Log("agent_task_stop");}catch(Exception ex){Log($"agent_task_stop_failed {ex.GetType().Name}: {ex.Message}");}}
    private static void TryRestartBackgroundAgentTask(){try{var psi=new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"schtasks.exe")){UseShellExecute=false,CreateNoWindow=true};psi.ArgumentList.Add("/Run");psi.ArgumentList.Add("/TN");psi.ArgumentList.Add("LightRemoteDeviceAgent");Process.Start(psi)?.Dispose();Log("agent_task_restart_requested");}catch(Exception ex){Log($"agent_task_restart_failed {ex.GetType().Name}: {ex.Message}");}}
    private static async Task WaitForParentAsync(int parentPid){if(parentPid<=0)return;try{using var parent=Process.GetProcessById(parentPid);using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(30));await parent.WaitForExitAsync(timeout.Token);}catch(ArgumentException){}catch(OperationCanceledException){Log("parent_wait_timeout");}}
    private static async Task StopInstalledRuntimeAsync(string installDir)
    {
        await EndScheduledTaskAsync("LightRemoteDeviceAgent");var targets=new[]{Path.GetFullPath(Path.Combine(installDir,"GptOperator.Client.exe")),Path.GetFullPath(Path.Combine(installDir,"runtime","node.exe"))};
        foreach(var process in Process.GetProcesses()){try{var path=process.MainModule?.FileName;if(path is null||!targets.Any(target=>string.Equals(Path.GetFullPath(path),target,StringComparison.OrdinalIgnoreCase)))continue;Log($"stopping_runtime pid={process.Id} file={Path.GetFileName(path)}");process.Kill(entireProcessTree:true);await process.WaitForExitAsync();}catch{}finally{process.Dispose();}}
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
    private static void WriteJson(string file,object value){RecoveryPaths.EnsureDirectories();var tmp=file+"."+Environment.ProcessId+".tmp";File.WriteAllText(tmp,JsonSerializer.Serialize(value));File.Move(tmp,file,true);}
    private static void WriteStatus(string state,string currentVersion,string? targetVersion,string? code)=>WriteJson(RecoveryPaths.StatusFile,new{state,currentVersion,targetVersion,helperVersion=typeof(UpdateApplier).Assembly.GetName().Version?.ToString(),code,updatedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()});
    private static void WriteReport(string outcome,string? code,string phase,string fromVersion,string? targetVersion,string activeVersion,bool attemptedRollback,bool rollbackSuccess,string? detail)=>WriteJson(RecoveryPaths.ReportFile,new{schemaVersion=1,reportId="ur_"+Guid.NewGuid().ToString("N"),outcome,code,phase,fromVersion,targetVersion,activeVersion,helperVersion=typeof(UpdateApplier).Assembly.GetName().Version?.ToString(),platform="windows-x64",rollback=new{attempted=attemptedRollback,success=rollbackSuccess},detail,at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()});
    private static void ClearTransaction(){try{File.Delete(RecoveryPaths.TransactionFile);}catch{}try{File.Delete(RecoveryPaths.AckFile);}catch{}}
    private static async Task<bool> FinalizeHelperCandidateAsync(string installDir)
    {
        var candidate=Path.Combine(installDir,"helper-candidate");var candidateExe=Path.Combine(candidate,"LightRemote.Updater.exe");if(!File.Exists(candidateExe))return false;RecoveryPaths.EnsureDirectories();
        string stage=Path.Combine(RecoveryPaths.CacheDir,"helper-stage-"+Guid.NewGuid().ToString("N"));string backup=Path.Combine(RecoveryPaths.CacheDir,"helper-backup-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);Directory.CreateDirectory(backup);CopyTree(candidate,stage);
        if(!await HelperSelfTestAsync(Path.Combine(stage,"LightRemote.Updater.exe"),installDir)){Directory.Delete(stage,true);Directory.Delete(backup,true);return false;}
        var files=Directory.GetFiles(stage,"*",SearchOption.AllDirectories);var existed=new HashSet<string>(StringComparer.OrdinalIgnoreCase);try{foreach(var src in files){string rel=Path.GetRelativePath(stage,src);string dst=Path.Combine(RecoveryPaths.Root,rel);string bak=Path.Combine(backup,rel);if(File.Exists(dst)){Directory.CreateDirectory(Path.GetDirectoryName(bak)!);File.Copy(dst,bak,true);existed.Add(rel);}Directory.CreateDirectory(Path.GetDirectoryName(dst)!);File.Copy(src,dst,true);}var ok=await HelperSelfTestAsync(Path.Combine(RecoveryPaths.Root,"LightRemote.Updater.exe"),installDir);if(ok){Directory.Delete(stage,true);Directory.Delete(backup,true);return true;}throw new InvalidOperationException("helper_candidate_health_failed");}
        catch{foreach(var src in files){string rel=Path.GetRelativePath(stage,src);string dst=Path.Combine(RecoveryPaths.Root,rel);string bak=Path.Combine(backup,rel);try{if(existed.Contains(rel))File.Copy(bak,dst,true);else File.Delete(dst);}catch{}}try{Directory.Delete(stage,true);}catch{}try{Directory.Delete(backup,true);}catch{}return false;}
    }
    private static void CopyTree(string source,string destination){foreach(var dir in Directory.GetDirectories(source,"*",SearchOption.AllDirectories))Directory.CreateDirectory(Path.Combine(destination,Path.GetRelativePath(source,dir)));foreach(var file in Directory.GetFiles(source,"*",SearchOption.AllDirectories)){var dst=Path.Combine(destination,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(dst)!);File.Copy(file,dst,true);}}
    private static async Task<bool> HelperSelfTestAsync(string exe,string installDir){var output=Path.Combine(RecoveryPaths.CacheDir,"helper-health-"+Guid.NewGuid().ToString("N")+".json");try{var psi=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true};psi.ArgumentList.Add("--self-test-output");psi.ArgumentList.Add(output);psi.ArgumentList.Add(installDir);using var p=Process.Start(psi);if(p is null||!await WaitForExitOrKillAsync(p,TimeSpan.FromSeconds(30),"helper_health")||p.ExitCode!=0||!File.Exists(output))return false;using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(output));return doc.RootElement.TryGetProperty("ok",out var ok)&&ok.GetBoolean();}catch{return false;}finally{try{File.Delete(output);}catch{}}}
    private static void StartInstalledClient(string installDir){TryRestartBackgroundAgentTask();var exe=Path.Combine(installDir,"GptOperator.Client.exe");if(!File.Exists(exe))return;try{Process.Start(new ProcessStartInfo(exe,"--background"){UseShellExecute=true});}catch{}}
    internal static void Log(string text){try{RecoveryPaths.EnsureDirectories();File.AppendAllText(RecoveryPaths.UpdateLog,$"{DateTimeOffset.UtcNow:o} {text}{Environment.NewLine}");}catch{}}
}
