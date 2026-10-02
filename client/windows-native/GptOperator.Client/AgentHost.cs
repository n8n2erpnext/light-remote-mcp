using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace GptOperator.Client;

internal static class AgentHost
{
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectExtendedLimitInformationClass = 9;
    private static readonly object LogGate = new();

    public static int Run()
    {
        AppPaths.EnsureDirectories();
        using var singleton = new Mutex(true, @"Local\LightRemoteDeviceAgentHost", out var createdNew);
        if (!createdNew)
        {
            Log("SYS", "duplicate agent host suppressed");
            return 0;
        }

        Process? child = null;
        EventHandler? exitHandler = null;
        IntPtr job = IntPtr.Zero;
        try
        {
            job = CreateKillOnCloseJob();
            var psi = CreateStartInfo();
            child = new Process { StartInfo = psi, EnableRaisingEvents = true };
            child.OutputDataReceived += (_, e) => { if (e.Data is not null) Log("OUT", e.Data); };
            child.ErrorDataReceived += (_, e) => { if (e.Data is not null) Log("ERR", e.Data); };
            exitHandler = (_, _) => StopChild(child);
            AppDomain.CurrentDomain.ProcessExit += exitHandler;
            if (!child.Start()) return 2;
            if (!AssignProcessToJobObject(job, child.Handle))
            {
                var error = Marshal.GetLastWin32Error();
                Log("ERR", $"failed to bind child to kill-on-close job win32={error} child={child.Id}");
                StopChild(child);
                return 3;
            }
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            Log("SYS", $"agent host started host={Environment.ProcessId} child={child.Id} job=kill-on-close");
            child.WaitForExit();
            var code = child.ExitCode;
            Log("SYS", $"agent child exited code={code} child={child.Id}");
            return code;
        }
        catch (Exception ex)
        {
            Log("ERR", $"agent host failed: {ex}");
            return 1;
        }
        finally
        {
            if (exitHandler is not null) AppDomain.CurrentDomain.ProcessExit -= exitHandler;
            StopChild(child);
            child?.Dispose();
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }

    private static IntPtr CreateKillOnCloseJob()
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
        psi.Environment["HOME"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var connection = ConnectionConfig.Load();
        psi.Environment["OPERATOR_AGENT_BASE_URL"] = connection.BridgeUrl;
        psi.Environment["OPERATOR_AGENT_HUB_URL"] = connection.HubUrl;
        var realRemoteV2 = Path.Combine(AppContext.BaseDirectory, "realremote-v2", "LightRemote.RM.exe");
        if (File.Exists(realRemoteV2))
        {
            psi.Environment["LIGHT_REMOTE_REAL_REMOTE"] = "1";
            psi.Environment["LIGHT_REMOTE_CLIENT_EXE"] = realRemoteV2;
            psi.Environment["LIGHT_REMOTE_RMV2_IDLE_MS"] = "60000";
        }
        return psi;
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
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr hObject);
}
