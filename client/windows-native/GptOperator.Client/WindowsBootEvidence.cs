using System.Diagnostics;
using System.Globalization;
using System.Management;
using System.Text.Json;

namespace GptOperator.Client;

// Fixed, OS-local WMI health observation by the trusted native host. Neither
// boot timestamps nor the recovery cache attest process exit or release M4 locks.
// No PowerShell, WMIC, scheduler job or remote command is used.
internal static class WindowsBootEvidence
{
    internal const string BootTimeKey = "LIGHT_REMOTE_NATIVE_BOOT_AT_MS";
    internal const string ObservedTimeKey = "LIGHT_REMOTE_NATIVE_BOOT_OBSERVED_AT_MS";
    internal const string SourceKey = "LIGHT_REMOTE_NATIVE_BOOT_SOURCE";
    internal const string RecoveryPathKey = "LIGHT_REMOTE_NATIVE_BOOT_RECOVERY_PATH";
    internal const string Source = "win32_wmi_lastbootuptime";
    private static readonly TimeSpan CaptureDeadline = TimeSpan.FromSeconds(3);
    private const int RecoveryAttempts = 12;
    private static readonly TimeSpan RetryInterval = TimeSpan.FromSeconds(15);

    internal static long? Validate(long bootAtMs, long observedAtMs)
    {
        const long year2020 = 1577836800000L;
        if (bootAtMs < year2020 || observedAtMs < year2020 ||
            bootAtMs > observedAtMs + 30000L || observedAtMs > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 30000L)
            return null;
        return bootAtMs;
    }

    internal static (long BootAtMs, long ObservedAtMs)? CaptureDirect()
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            using var searcher = new ManagementObjectSearcher(
                @"root\CIMV2", "SELECT LastBootUpTime FROM Win32_OperatingSystem");
            using var rows = searcher.Get();
            foreach (ManagementObject row in rows)
            {
                using (row)
                {
                    if (row["LastBootUpTime"] is not string raw || raw.Length > 40 || raw.Length < 20) continue;
                    var local = ManagementDateTimeConverter.ToDateTime(raw);
                    var bootAtMs = new DateTimeOffset(local).ToUnixTimeMilliseconds();
                    var observedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    if (Validate(bootAtMs, observedAtMs) is not null)
                        return (bootAtMs, observedAtMs);
                }
            }
        }
        catch (ManagementException) { }
        catch (System.Runtime.InteropServices.COMException) { }
        catch (UnauthorizedAccessException) { }
        catch (PlatformNotSupportedException) { }
        catch (ArgumentException) { }
        return null;
    }

    internal static (long BootAtMs, long ObservedAtMs)? Capture()
    {
        // The daemon must remain available even if WMI hangs during cold boot.
        try
        {
            var task = Task.Run(CaptureDirect);
            return task.Wait(CaptureDeadline) ? task.Result : null;
        }
        catch { return null; }
    }

    // Return a unique, per-daemon recovery path ONLY if startup WMI is missing.
    // The Node child can read this narrow file after the native host recovers
    // WMI; the host never restarts an active daemon to repair health telemetry.
    internal static string? Configure(ProcessStartInfo psi)
    {
        psi.Environment.Remove(BootTimeKey);
        psi.Environment.Remove(ObservedTimeKey);
        psi.Environment.Remove(SourceKey);
        psi.Environment.Remove(RecoveryPathKey);
        var observation = Capture();
        if (observation is not null)
        {
            psi.Environment[BootTimeKey] = observation.Value.BootAtMs.ToString(CultureInfo.InvariantCulture);
            psi.Environment[ObservedTimeKey] = observation.Value.ObservedAtMs.ToString(CultureInfo.InvariantCulture);
            psi.Environment[SourceKey] = Source;
            return null;
        }
        try
        {
            Directory.CreateDirectory(AppPaths.LocalData);
            var path = Path.Combine(AppPaths.LocalData, "native-boot-" + Guid.NewGuid().ToString("N") + ".json");
            psi.Environment[RecoveryPathKey] = path;
            return path;
        }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    internal static async Task RecoverAsync(string path, CancellationToken cancellationToken)
    {
        var temporary = path + ".tmp";
        try
        {
            for (var attempt = 0; attempt < RecoveryAttempts; attempt++)
            {
                if (attempt > 0) await Task.Delay(RetryInterval, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                var observation = Capture();
                if (observation is null) continue;
                var payload = JsonSerializer.Serialize(new
                {
                    nativeSource = Source,
                    nativeBootAtMs = observation.Value.BootAtMs,
                    nativeObservedAtMs = observation.Value.ObservedAtMs
                });
                await File.WriteAllTextAsync(temporary, payload, cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();
                File.Move(temporary, path, overwrite: true);
                return;
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        finally { try { File.Delete(temporary); } catch { } }
    }

    internal static void DeleteRecoveryFile(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { File.Delete(path); } catch { }
        try { File.Delete(path + ".tmp"); } catch { }
    }

    internal static bool SelfTest(string destination)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var valid = Validate(now - 3600000, now) is not null &&
                    Validate(now + 3600000, now) is null &&
                    Validate(0, now) is null &&
                    RecoveryAttempts > 0 && RetryInterval > TimeSpan.Zero;
        var osRead = Capture();
        var result = new
        {
            ok = valid && osRead.HasValue,
            logic = valid ? "pass" : "fail",
            wmi = osRead.HasValue ? "pass" : "unavailable",
            source = Source,
            bootAtMs = osRead?.BootAtMs,
            observedAtMs = osRead?.ObservedAtMs
        };
        File.WriteAllText(destination, JsonSerializer.Serialize(result));
        return result.ok;
    }
}
