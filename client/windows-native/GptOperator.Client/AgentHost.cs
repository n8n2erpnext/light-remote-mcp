using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace GptOperator.Client;

internal static class AgentHost
{
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectExtendedLimitInformationClass = 9;
    private static readonly object LogGate = new();

    // The scheduled task only retries a finite number of times. A long-lived host
    // must also recover from transient daemon failures without requiring re-login.
    // Every attempt gets a NEW kill-on-close job so descendants of a crashed
    // daemon cannot retain the Wall port or hold stale pipes during its restart.
    private static readonly TimeSpan HealthyRunWindow = TimeSpan.FromMinutes(2);

    internal static int NextFailureCount(int previous, TimeSpan uptime)
        => uptime >= HealthyRunWindow ? 1 : Math.Min(Math.Max(previous, 0) + 1, 7);

    internal static TimeSpan RestartDelay(int failures)
        => TimeSpan.FromSeconds(Math.Min(30, 1 << Math.Min(Math.Max(failures - 1, 0), 5)));

    internal static bool SelfTestRestartPolicy()
        => NextFailureCount(0, TimeSpan.Zero) == 1
           && NextFailureCount(1, TimeSpan.Zero) == 2
           && NextFailureCount(6, TimeSpan.Zero) == 7
           && NextFailureCount(7, TimeSpan.Zero) == 7
           && NextFailureCount(7, HealthyRunWindow) == 1
           && RestartDelay(1) == TimeSpan.FromSeconds(1)
           && RestartDelay(2) == TimeSpan.FromSeconds(2)
           && RestartDelay(3) == TimeSpan.FromSeconds(4)
           && RestartDelay(6) == TimeSpan.FromSeconds(30)
           && RestartDelay(7) == TimeSpan.FromSeconds(30);

    public static int Run()
    {
        AppPaths.EnsureDirectories();
        using var singleton = new Mutex(true, @"Local\LightRemoteDeviceAgentHost", out var createdNew);
        if (!createdNew)
        {
            Log("SYS", "duplicate agent host suppressed");
            return 0;
        }

        var failures = 0;
        while (true)
        {
            Process? child = null;
            EventHandler? exitHandler = null;
            IntPtr job = IntPtr.Zero;
            var uptime = Stopwatch.StartNew();
            try
            {
                job = CreateKillOnCloseJob();
                var psi = CreateStartInfo();
                child = new Process { StartInfo = psi, EnableRaisingEvents = true };
                child.OutputDataReceived += (_, e) => { if (e.Data is not null) Log("OUT", e.Data); };
                child.ErrorDataReceived += (_, e) => { if (e.Data is not null) Log("ERR", e.Data); };
                exitHandler = (_, _) => StopChild(child);
                AppDomain.CurrentDomain.ProcessExit += exitHandler;
                if (!child.Start()) throw new InvalidOperationException("Could not start operator agent.");
                if (!AssignProcessToJobObject(job, child.Handle))
                {
                    var error = Marshal.GetLastWin32Error();
                    throw new InvalidOperationException($"Agent job binding failed (win32={error}).");
                }
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
                Log("SYS", $"agent host started host={Environment.ProcessId} child={child.Id} job=kill-on-close");
                child.WaitForExit();
                Log("SYS", $"agent child exited code={child.ExitCode} child={child.Id}");
            }
            catch (Exception ex)
            {
                Log("ERR", $"agent host attempt failed: {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                if (exitHandler is not null) AppDomain.CurrentDomain.ProcessExit -= exitHandler;
                StopChild(child);
                child?.Dispose();
                // Reap ALL children of this attempt, including orphaned RM helpers.
                if (job != IntPtr.Zero) CloseHandle(job);
            }

            failures = NextFailureCount(failures, uptime.Elapsed);
            var delay = RestartDelay(failures);
            Log("SYS", $"agent host recovery scheduled failure={failures} delaySeconds={delay.TotalSeconds:0}");
            Thread.Sleep(delay);
            // Scheduler /End terminates the host and closes the job automatically.
            // Never change enrollment, permissions, cloud desired-state or Memory.
        }
    }

    internal static IntPtr CreateKillOnCloseJob()
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new InvalidOperationException($"CreateJobObject failed: {Marshal.GetLastWin32Error()}");
        var info = new JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation { LimitFlags = JobObjectLimitKillOnJobClose }
        };
        var size = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
        var ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, ptr, (uint)size))
            {
                var error = Marshal.GetLastWin32Error();
                CloseHandle(job);
                throw new InvalidOperationException($"SetInformationJobObject failed: {error}");
            }
            return job;
        }
        finally { Marshal.FreeHGlobal(ptr); }
    }

    private static ProcessStartInfo CreateStartInfo()
    {
        if (!File.Exists(AppPaths.NodeExe)) throw new FileNotFoundException("Bundled Node runtime is missing.", AppPaths.NodeExe);
        if (!File.Exists(AppPaths.AgentScript)) throw new FileNotFoundException("Bundled operator agent is missing.", AppPaths.AgentScript);
        var psi = new ProcessStartInfo(AppPaths.NodeExe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
        psi.ArgumentList.Add(AppPaths.AgentScript);
        psi.ArgumentList.Add("daemon");
        psi.Environment["OPERATOR_AGENT_STATE"] = AppPaths.StateFile;
        psi.Environment["LIGHT_REMOTE_MANAGED_PROCESS_HELPER"] = Path.Combine(AppPaths.Root, "GptOperator.Client.exe");
        psi.Environment["HOME"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var connection = ConnectionConfig.Load();
        psi.Environment["OPERATOR_AGENT_BASE_URL"] = connection.BridgeUrl;
        psi.Environment["OPERATOR_AGENT_HUB_URL"] = connection.HubUrl;
        ConfigureRealRemoteEnvironment(psi);
        WindowsBootEvidence.Configure(psi);
        return psi;
    }

    // Every invocation of the bundled Agent (daemon, status, login, poll, rescan)
    // must discover the same optional RM V2 companion. Do not rely on inherited
    // environment variables: Tray and AgentHost are separate processes.
    internal static void ConfigureRealRemoteEnvironment(ProcessStartInfo psi)
    {
        var companion = Path.Combine(AppContext.BaseDirectory, "realremote-v2", "LightRemote.RM.exe");
        if (File.Exists(companion))
        {
            psi.Environment["LIGHT_REMOTE_REAL_REMOTE"] = "1";
            psi.Environment["LIGHT_REMOTE_CLIENT_EXE"] = companion;
            psi.Environment["LIGHT_REMOTE_RMV2_IDLE_MS"] = "60000";
        }
        else
        {
            // An inherited opt-in or arbitrary companion path cannot supply rights.
            psi.Environment.Remove("LIGHT_REMOTE_REAL_REMOTE");
            psi.Environment.Remove("LIGHT_REMOTE_CLIENT_EXE");
            psi.Environment.Remove("LIGHT_REMOTE_RMV2_IDLE_MS");
        }
    }

    private static void StopChild(Process? child)
    {
        if (child is null) return;
        try
        {
            if (!child.HasExited)
            {
                Log("SYS", $"stopping agent child={child.Id}");
                child.Kill(entireProcessTree: true);
                child.WaitForExit(5000);
            }
        }
        catch (Exception ex) { Log("ERR", $"stop child failed: {ex.Message}"); }
    }

    private static void Log(string kind, string message)
    {
        var line = $"{DateTimeOffset.UtcNow:o} [{kind}] {message}{Environment.NewLine}";
        lock (LogGate)
        {
            Append(AppPaths.AgentLog, line);
            var installAgentLog = Path.Combine(AppContext.BaseDirectory, "logs", "agent.log");
            if (!string.Equals(AppPaths.AgentLog, installAgentLog, StringComparison.OrdinalIgnoreCase))
                Append(installAgentLog, line);
        }
    }

    private static void Append(string path, string line)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.AppendAllText(path, line, new UTF8Encoding(false));
        }
        catch { }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll")]
    internal static extern bool CloseHandle(IntPtr hObject);
}
