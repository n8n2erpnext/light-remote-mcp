using System.Diagnostics;
using System.Text;

namespace GptOperator.Client;

internal static class AgentHost
{
    private static readonly object LogGate = new();

    public static int Run()
    {
        AppPaths.EnsureDirectories();
        Process? child = null;
        EventHandler? exitHandler = null;
        try
        {
            var psi = CreateStartInfo();
            child = new Process { StartInfo = psi, EnableRaisingEvents = true };
            child.OutputDataReceived += (_, e) => { if (e.Data is not null) Log("OUT", e.Data); };
            child.ErrorDataReceived += (_, e) => { if (e.Data is not null) Log("ERR", e.Data); };
            exitHandler = (_, _) => StopChild(child);
            AppDomain.CurrentDomain.ProcessExit += exitHandler;
            if (!child.Start()) return 2;
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            Log("SYS", $"agent host started child={child.Id}");
            child.WaitForExit();
            var code = child.ExitCode;
            Log("SYS", $"agent child exited code={code}");
            return code;
        }
        catch (Exception ex)
        {
            Log("ERR", $"agent host failed: {ex.Message}");
            return 1;
        }
        finally
        {
            if (exitHandler is not null) AppDomain.CurrentDomain.ProcessExit -= exitHandler;
            StopChild(child);
            child?.Dispose();
        }
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
        psi.Environment["LIGHT_REMOTE_CLIENT_EXE"] = Environment.ProcessPath ?? Path.Combine(AppPaths.Root, "GptOperator.Client.exe");
        psi.Environment["LIGHT_REMOTE_REAL_REMOTE"] = "1";
        psi.Environment["HOME"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var connection = ConnectionConfig.Load();
        psi.Environment["OPERATOR_AGENT_BASE_URL"] = connection.BridgeUrl;
        psi.Environment["OPERATOR_AGENT_HUB_URL"] = connection.HubUrl;
        return psi;
    }

    private static void StopChild(Process? child)
    {
        if (child is null) return;
        try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch { }
    }

    private static void Log(string kind, string message)
    {
        try
        {
            lock (LogGate)
            {
                File.AppendAllText(AppPaths.AgentLog,
                    $"{DateTimeOffset.UtcNow:o} [{kind}] {message}{Environment.NewLine}",
                    new UTF8Encoding(false));
            }
        }
        catch { }
    }
}
