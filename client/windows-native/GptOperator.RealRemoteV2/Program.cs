using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Any(arg => String.Equals(arg, "--restore-cursors", StringComparison.OrdinalIgnoreCase)))
        {
            SystemCursorOverride.ForceRestore();
            Environment.ExitCode = 0;
            return;
        }

        var guardianIndex = Array.IndexOf(args, "--cursor-guardian");
        if (guardianIndex >= 0 && guardianIndex + 1 < args.Length)
        {
            Environment.ExitCode = RunCursorGuardian(args[guardianIndex + 1]);
            return;
        }

        var selfTest = Array.IndexOf(args, "--self-test-output");
        if (selfTest >= 0 && selfTest + 1 < args.Length)
        {
            Environment.ExitCode = RunSelfTest(args[selfTest + 1]) ? 0 : 1;
            return;
        }

        var pipeIndex = Array.IndexOf(args, "--pipe");
        if (pipeIndex < 0 || pipeIndex + 1 >= args.Length)
        {
            Environment.ExitCode = 2;
            return;
        }

        var pipeName = args[pipeIndex + 1];
        if (!RobotRpcServer.IsValidPipeName(pipeName))
        {
            Environment.ExitCode = 2;
            return;
        }

        ApplicationConfiguration.Initialize();
        StartCursorGuardian();
        Application.ApplicationExit += (_, _) => SystemCursorOverride.ForceRestore();
        Application.ThreadException += (_, _) => SystemCursorOverride.ForceRestore();
        AppDomain.CurrentDomain.ProcessExit += (_, _) => SystemCursorOverride.ForceRestore();
        AppDomain.CurrentDomain.UnhandledException += (_, _) => SystemCursorOverride.ForceRestore();
        try
        {
            Application.Run(new RobotContext(pipeName));
        }
        finally
        {
            SystemCursorOverride.ForceRestore();
        }
    }

    private static void StartCursorGuardian()
    {
        try
        {
            var executable = Environment.ProcessPath;
            if (String.IsNullOrWhiteSpace(executable)) return;

            var start = new ProcessStartInfo
            {
                FileName = executable,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            start.ArgumentList.Add("--cursor-guardian");
            start.ArgumentList.Add(Environment.ProcessId.ToString());
            using var guardian = Process.Start(start);
        }
        catch { }
    }

    private static int RunCursorGuardian(string parentPidText)
    {
        try
        {
            if (!Int32.TryParse(parentPidText, out var parentPid) || parentPid <= 0)
                return 2;

            using var parent = Process.GetProcessById(parentPid);
            parent.WaitForExit();
        }
        catch (ArgumentException)
        {
            // Parent already exited before guardian opened the process handle.
        }
        catch
        {
            // Restoration is still safe and idempotent if waiting failed.
        }

        SystemCursorOverride.ForceRestore();
        return 0;
    }
    private static bool RunSelfTest(string output)
    {
        try
        {
            var semanticJournalOk=SemanticJournal.SelfTest();
            var visualLeasePolicyOk=VisualSessionManager.SelfTest();
            var browserLoopbackPolicyOk=BrowserSemanticProvider.SelfTest();
            var rectSanitizationOk=UiSensor.RectSanitizationSelfTest();
            var semanticScopeOk=SemanticSessionManager.ScopeSelfTest();
            var smoothMoveMathOk=NativeInput.SmoothMoveMathSelfTest();
            var agentCursorVisualOk=AgentCursorVisualState.SelfTest();
            var systemCursorOverrideOk=SystemCursorOverride.SelfTest();
            var allOk=semanticJournalOk && visualLeasePolicyOk && browserLoopbackPolicyOk && rectSanitizationOk && semanticScopeOk && smoothMoveMathOk && agentCursorVisualOk && systemCursorOverrideOk;
            var result = new
            {
                ok = allOk,
                runtime = "real-remote-v2-companion",
                processId = Environment.ProcessId,
                userInteractive = Environment.UserInteractive,
                os = Environment.OSVersion.VersionString,
                architecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
                semanticJournalOk,
                visualLeasePolicyOk,
                browserLoopbackPolicyOk,
                rectSanitizationOk,
                semanticScopeOk,
                smoothMoveMathOk,
                agentCursorVisualOk,
                systemCursorOverrideOk
            };
            File.WriteAllText(output, JsonSerializer.Serialize(result));
            return allOk;
        }
        catch (Exception ex)
        {
            try { File.WriteAllText(output, JsonSerializer.Serialize(new { ok = false, error = ex.Message })); } catch { }
            return false;
        }
    }}
