using System.Diagnostics;
using System.Text.Json;

namespace GptOperator.Client;

internal static class UpdateApplier
{
    public static async Task<int> ApplyAsync(string installer, string installDir, string currentVersion, int parentPid)
    {
        AppPaths.EnsureDirectories();
        var versionCore = currentVersion.Split('-', 2)[0];
        if (!Path.IsPathFullyQualified(installer) || !Path.IsPathFullyQualified(installDir) ||
            !Version.TryParse(versionCore, out _))
        {
            Log($"apply_invalid_args installer={installer} installDir={installDir} current={currentVersion}");
            return 23;
        }
        try
        {
            await WaitForParentAsync(parentPid);
            await StopBackgroundAgentTaskAsync();
            Log($"apply_start current={currentVersion} installer={installer}");
            await StopInstalledRuntimeAsync(installDir);
            var installed = await TryInstallAndVerifyAsync(installer, installDir);
            if (installed)
            {
                Log("apply_success");
                StartInstalledClient(installDir);
                return 0;
            }

            Log("apply_failed attempting_rollback");
            var rollback = AppPaths.RollbackInstaller(currentVersion);
            if (!File.Exists(rollback))
            {
                Log($"rollback_missing path={rollback}");
                return 20;
            }
            await StopInstalledRuntimeAsync(installDir);
            var rolledBack = await TryInstallAndVerifyAsync(rollback, installDir);
            if (!rolledBack)
            {
                Log("rollback_failed");
                TryRestartBackgroundAgentTask();
                return 21;
            }

            Log("rollback_success");
            StartInstalledClient(installDir);
            return 0;
        }
        catch (Exception ex)
        {
            Log($"apply_exception {ex.GetType().Name}: {ex.Message}");
            try
            {
                var rollback = AppPaths.RollbackInstaller(currentVersion);
                if (File.Exists(rollback))
                {
                    await StopInstalledRuntimeAsync(installDir);
                }
                if (File.Exists(rollback) && await TryInstallAndVerifyAsync(rollback, installDir))
                {
                    Log("rollback_success_after_exception");
                    StartInstalledClient(installDir);
                    return 0;
                }
            }
            catch (Exception rollbackEx)
            {
                Log($"rollback_exception {rollbackEx.GetType().Name}: {rollbackEx.Message}");
            }
            TryRestartBackgroundAgentTask();
            return 22;
        }
    }

    private static async Task StopBackgroundAgentTaskAsync()
    {
        try
        {
            var psi = new ProcessStartInfo("schtasks.exe") { UseShellExecute = false, CreateNoWindow = true };
            psi.ArgumentList.Add("/End"); psi.ArgumentList.Add("/TN"); psi.ArgumentList.Add("LightRemoteDeviceAgent");
            using var process = Process.Start(psi);
            if (process is not null) await WaitForExitOrKillAsync(process, TimeSpan.FromSeconds(10), "agent_task_stop");
            await Task.Delay(350);
            Log($"agent_task_stop exit={(process is null ? -1 : process.ExitCode)}");
        }
        catch (Exception ex) { Log($"agent_task_stop_failed {ex.GetType().Name}: {ex.Message}"); }
    }

    private static void TryRestartBackgroundAgentTask()
    {
        try
        {
            var psi = new ProcessStartInfo("schtasks.exe") { UseShellExecute = false, CreateNoWindow = true };
            psi.ArgumentList.Add("/Run"); psi.ArgumentList.Add("/TN"); psi.ArgumentList.Add("LightRemoteDeviceAgent");
            Process.Start(psi)?.Dispose();
            Log("agent_task_restart_requested");
        }
        catch (Exception ex) { Log($"agent_task_restart_failed {ex.GetType().Name}: {ex.Message}"); }
    }

    private static async Task WaitForParentAsync(int parentPid)
    {
        if (parentPid <= 0) return;
        try
        {
            using var parent = Process.GetProcessById(parentPid);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            await parent.WaitForExitAsync(timeout.Token);
        }
        catch (ArgumentException) { }
        catch (OperationCanceledException) { Log("parent_wait_timeout"); }
    }

    private static async Task StopInstalledRuntimeAsync(string installDir)
    {
        await EndScheduledTaskAsync("LightRemoteDeviceAgent");
        var targets = new[] {
            Path.GetFullPath(Path.Combine(installDir, "GptOperator.Client.exe")),
            Path.GetFullPath(Path.Combine(installDir, "runtime", "node.exe"))
        };
        foreach (var process in Process.GetProcesses())
        {
            try
            {
                var path = process.MainModule?.FileName;
                if (path is null || !targets.Any(target => string.Equals(Path.GetFullPath(path), target, StringComparison.OrdinalIgnoreCase))) continue;
                Log($"stopping_runtime pid={process.Id} file={Path.GetFileName(path)}");
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync();
            }
            catch { }
            finally { process.Dispose(); }
        }
    }

    private static async Task EndScheduledTaskAsync(string taskName)
    {
        try
        {
            var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "schtasks.exe"))
            {
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("/End");
            psi.ArgumentList.Add("/TN");
            psi.ArgumentList.Add(taskName);
            using var process = Process.Start(psi);
            if (process is not null) await WaitForExitOrKillAsync(process, TimeSpan.FromSeconds(10), "task_end");
        }
        catch { }
    }

    private static async Task<bool> TryInstallAndVerifyAsync(string installer, string installDir)
    {
        if (!File.Exists(installer)) return false;
        int exitCode;
        try
        {
            var psi = new ProcessStartInfo(installer)
            {
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("/VERYSILENT");
            psi.ArgumentList.Add("/SUPPRESSMSGBOXES");
            psi.ArgumentList.Add("/NORESTART");
            psi.ArgumentList.Add("/CLOSEAPPLICATIONS");
            psi.ArgumentList.Add($"/DIR={installDir}");
            using var process = Process.Start(psi);
            if (process is null) return false;
            if (!await WaitForExitOrKillAsync(process, TimeSpan.FromSeconds(120), "installer")) return false;
            exitCode = process.ExitCode;
        }
        catch (Exception ex)
        {
            Log($"installer_start_failed {ex.GetType().Name}: {ex.Message}");
            return false;
        }
        if (exitCode != 0) { Log($"installer_exit={exitCode}"); return false; }

        var installedExe = Path.Combine(installDir, "GptOperator.Client.exe");
        if (!File.Exists(installedExe)) return false;
        var result = Path.Combine(AppPaths.UpdateDir, $"health-{Guid.NewGuid():N}.json");
        try
        {
            using var health = Process.Start(new ProcessStartInfo(installedExe)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                ArgumentList = { "--self-test-output", result }
            });
            if (health is null) return false;
            if (!await WaitForExitOrKillAsync(health, TimeSpan.FromSeconds(30), "health")) return false;
            if (health.ExitCode != 0 || !File.Exists(result)) return false;
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(result));
            return doc.RootElement.TryGetProperty("ok", out var ok) && ok.GetBoolean();
        }
        catch (Exception ex)
        {
            Log($"health_check_failed {ex.GetType().Name}: {ex.Message}");
            return false;
        }
        finally { try { File.Delete(result); } catch { } }
    }

    private static async Task<bool> WaitForExitOrKillAsync(Process process, TimeSpan timeout, string phase)
    {
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await process.WaitForExitAsync(cts.Token);
            return true;
        }
        catch (OperationCanceledException)
        {
            Log($"{phase}_timeout seconds={(int)timeout.TotalSeconds}");
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
            try { await process.WaitForExitAsync(); } catch { }
            return false;
        }
    }

    private static void StartInstalledClient(string installDir)
    {
        var exe = Path.Combine(installDir, "GptOperator.Client.exe");
        if (!File.Exists(exe)) return;
        Process.Start(new ProcessStartInfo(exe, "--background") { UseShellExecute = true });
    }

    private static void Log(string text)
    {
        try { File.AppendAllText(AppPaths.UpdateLog, $"{DateTimeOffset.UtcNow:o} {text}{Environment.NewLine}"); }
        catch { }
    }
}
