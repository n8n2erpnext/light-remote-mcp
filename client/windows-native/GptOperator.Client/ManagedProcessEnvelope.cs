using System.Runtime.InteropServices;
using System.Text;

namespace GptOperator.Client;

// Runs ONLY when launched by the already authorized Agent process registry.
// A suspended child is enrolled in a private kill-on-close Job Object before
// execution starts. Even a shell which exits naturally cannot orphan a child.
// This does not elevate privileges or change the allowed script/capabilities.
internal static class ManagedProcessEnvelope
{
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint HandleFlagInherit = 0x00000001;
    private const int StdInputHandle = -10, StdOutputHandle = -11, StdErrorHandle = -12;
    private const uint WaitFailed = 0xffffffff;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public uint cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string? applicationName, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags, IntPtr environment, string? currentDirectory,
        ref StartupInfo startupInfo, out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteFile(IntPtr handle, byte[] buffer, uint bytes, out uint written, IntPtr overlapped);

    private static string Quote(string arg)
    {
        if (arg.Length > 0 && !arg.Any(c => char.IsWhiteSpace(c) || c == '"')) return arg;
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var c in arg)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"')
            {
                result.Append('\\', slashes * 2 + 1).Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    private static void Error(string message)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes("gold_managed_process_envelope:" + message + "\n");
            WriteFile(GetStdHandle(StdErrorHandle), bytes, (uint)bytes.Length, out _, IntPtr.Zero);
        }
        catch { }
    }

    public static int Run(string[] args)
    {
        if (args.Length < 1 || string.IsNullOrWhiteSpace(args[0])) { Error("missing_executable"); return 125; }

        IntPtr job = IntPtr.Zero;
        var process = new ProcessInformation();
        bool created = false, assigned = false;
        try
        {
            var stdin = GetStdHandle(StdInputHandle);
            var stdout = GetStdHandle(StdOutputHandle);
            var stderr = GetStdHandle(StdErrorHandle);
            if (stdin == IntPtr.Zero || stdout == IntPtr.Zero || stderr == IntPtr.Zero ||
                !SetHandleInformation(stdin, HandleFlagInherit, HandleFlagInherit) ||
                !SetHandleInformation(stdout, HandleFlagInherit, HandleFlagInherit) ||
                !SetHandleInformation(stderr, HandleFlagInherit, HandleFlagInherit))
            {
                Error("standard_handles_unavailable");
                return 125;
            }
            job = AgentHost.CreateKillOnCloseJob();
            var command = new StringBuilder(string.Join(" ", args.Select(Quote)));
            var startup = new StartupInfo
            {
                cb = (uint)Marshal.SizeOf<StartupInfo>(),
                dwFlags = StartfUseStdHandles,
                hStdInput = stdin,
                hStdOutput = stdout,
                hStdError = stderr
            };
            if (!CreateProcess(null, command, IntPtr.Zero, IntPtr.Zero, true,
                CreateSuspended | CreateNoWindow, IntPtr.Zero, null, ref startup, out process))
            {
                Error("spawn_failed_win32_" + Marshal.GetLastWin32Error());
                return 126;
            }
            created = true;
            if (!AgentHost.AssignProcessToJobObject(job, process.hProcess))
            {
                Error("job_attach_failed_win32_" + Marshal.GetLastWin32Error());
                return 126;
            }
            assigned = true;
            if (ResumeThread(process.hThread) == WaitFailed)
            {
                Error("resume_failed_win32_" + Marshal.GetLastWin32Error());
                return 126;
            }
            if (WaitForSingleObject(process.hProcess, uint.MaxValue) == WaitFailed ||
                !GetExitCodeProcess(process.hProcess, out var exitCode))
            {
                Error("wait_failed_win32_" + Marshal.GetLastWin32Error());
                return 126;
            }
            return unchecked((int)exitCode);
        }
        catch (Exception e)
        {
            Error("unexpected_" + e.GetType().Name);
            return 126;
        }
        finally
        {
            // Even when the launched shell already exited, its grandchildren
            // are killed by closing the LAST job handle.
            if (job != IntPtr.Zero) AgentHost.CloseHandle(job);
            if (created)
            {
                // A failed AssignProcessToJobObject leaves the child suspended
                // and outside the job: terminate it explicitly, never orphan.
                if (!assigned) TerminateProcess(process.hProcess, 126);
                AgentHost.CloseHandle(process.hThread);
                AgentHost.CloseHandle(process.hProcess);
            }
        }
    }
}
