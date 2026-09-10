using System.Diagnostics;
using System.Text.Json;

namespace GptOperator.Client;

internal static class UpdateApplier
{
    private const string SilentArgs = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS";

    public static async Task<int> ApplyAsync(string installer, string installDir, string currentVersion, int parentPid)
    {
        AppPaths.EnsureDirectories();
        try
        {
            await WaitForParentAsync(parentPid);
            Log($"apply_start current={currentVersion} installer={installer}");
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
            var rolledBack = await TryInstallAndVerifyAsync(rollback, installDir);
            if (!rolledBack)
            {
                Log("rollback_failed");
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
            return 22;
        }
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

    private static async Task<bool> TryInstallAndVerifyAsync(string installer, string installDir)
    {
        if (!File.Exists(installer)) return false;
        int exitCode;
        try
        {
            using var process = Process.Start(new ProcessStartInfo(installer, SilentArgs)
            {
                UseShellExecute = false,
                CreateNoWindow = true
            });
            if (process is null) return false;
            await process.WaitForExitAsync();
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
            await health.WaitForExitAsync();
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
