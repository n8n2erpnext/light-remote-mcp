using System.Diagnostics;
using System.Globalization;
using System.Management;
using System.Text.Json;

namespace GptOperator.Client;

// WMI is queried directly in the already-trusted native host before Node
// startup. No PowerShell/WMIC, arbitrary command text, M4 scheduler dispatch,
// or remote execution path is involved. This is OS-reported health telemetry,
// not hardware attestation or signed evidence that old work completed.
internal static class WindowsBootEvidence
{
    internal const string BootTimeKey = "LIGHT_REMOTE_NATIVE_BOOT_AT_MS";
    internal const string ObservedTimeKey = "LIGHT_REMOTE_NATIVE_BOOT_OBSERVED_AT_MS";
    internal const string SourceKey = "LIGHT_REMOTE_NATIVE_BOOT_SOURCE";
    internal const string Source = "win32_wmi_lastbootuptime";
    private static readonly TimeSpan CaptureDeadline = TimeSpan.FromSeconds(3);

    internal static long? Validate(long bootAtMs, long observedAtMs)
    {
        // Tolerate a small source/host clock offset but reject impossible dates.
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
        // WMI can be slow or unavailable on consumer Windows PCs. A health
        // sample must NEVER block the Agent host or prevent remote connectivity.
        try
        {
            var task = Task.Run(CaptureDirect);
            return task.Wait(CaptureDeadline) ? task.Result : null;
        }
        catch { return null; }
    }

    internal static void Configure(ProcessStartInfo psi)
    {
        // Never inherit user-controlled/injected evidence through process env.
        psi.Environment.Remove(BootTimeKey);
        psi.Environment.Remove(ObservedTimeKey);
        psi.Environment.Remove(SourceKey);
        var observation = Capture();
        if (observation is null) return;
        psi.Environment[BootTimeKey] = observation.Value.BootAtMs.ToString(CultureInfo.InvariantCulture);
        psi.Environment[ObservedTimeKey] = observation.Value.ObservedAtMs.ToString(CultureInfo.InvariantCulture);
        psi.Environment[SourceKey] = Source;
    }

    internal static bool SelfTest(string destination)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var valid = Validate(now - 3600000, now) is not null &&
                    Validate(now + 3600000, now) is null &&
                    Validate(0, now) is null;
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
