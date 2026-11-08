using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace GptOperator.Client;

// Agent-only recovery must never terminate the GUI (the same EXE), another
// user's process, a managed command wrapper or a process guessed from a port.
internal static class OwnedAgentHostStopper
{
    [DllImport("shell32.dll", SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string command, out int count);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    private static bool IsHostCommand(string command, string expected)
    {
        var memory = CommandLineToArgvW(command, out var count);
        if (memory == IntPtr.Zero) return false;
        try
        {
            if (count != 2) return false;
            var exe = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, 0));
            var role = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, IntPtr.Size));
            return exe is not null && Path.IsPathFullyQualified(exe) &&
                string.Equals(Path.GetFullPath(exe), expected, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(role, "--agent-host", StringComparison.OrdinalIgnoreCase);
        }
        finally { LocalFree(memory); }
    }

    internal static int Stop()
    {
        try
        {
            var expected = Path.GetFullPath(AppPaths.CoreExecutable);
            var sid = WindowsIdentity.GetCurrent().User?.Value;
            if (sid is null || !string.Equals(Path.GetFileName(expected), "LightRemote.exe", StringComparison.OrdinalIgnoreCase)) return 1;
            using var search = new ManagementObjectSearcher(new ManagementScope("root\\CIMV2"),
                new ObjectQuery("SELECT ProcessId,ExecutablePath,CommandLine,CreationDate FROM Win32_Process WHERE Name='LightRemote.exe'"),
                new System.Management.EnumerationOptions { ReturnImmediately = false, Timeout = TimeSpan.FromSeconds(4) });
            using var rows = search.Get();
            foreach (ManagementObject row in rows)
            {
                using (row)
                {
                    if (row["ExecutablePath"] is not string path ||
                        !string.Equals(Path.GetFullPath(path), expected, StringComparison.OrdinalIgnoreCase) ||
                        row["CommandLine"] is not string command || !IsHostCommand(command, expected)) continue;
                    var id = Convert.ToInt32(row["ProcessId"]);
                    if (id == Environment.ProcessId) continue;
                    using var owner = row.InvokeMethod("GetOwnerSid", null, new InvokeMethodOptions { Timeout = TimeSpan.FromSeconds(2) });
                    if (owner is null || Convert.ToUInt32(owner["ReturnValue"]) != 0 || owner["Sid"] as string != sid) return 1;
                    try
                    {
                        using var process = Process.GetProcessById(id);
                        // Guard PID reuse between WMI enumeration and opening the process.
                        var born = ManagementDateTimeConverter.ToDateTime((string)row["CreationDate"]).ToUniversalTime();
                        if (Math.Abs((process.StartTime.ToUniversalTime() - born).TotalMilliseconds) > 10 ||
                            !string.Equals(process.MainModule?.FileName, expected, StringComparison.OrdinalIgnoreCase)) return 1;
                        process.Kill(entireProcessTree: false); // Closing this host closes its owned attempt Job Object.
                        if (!process.WaitForExit(4000)) return 1;
                    }
                    catch (ArgumentException) { /* The verified host already exited. */ }
                }
            }
            return 0;
        }
        catch { return 1; } // No unverified process-name or port fallback.
    }
}
