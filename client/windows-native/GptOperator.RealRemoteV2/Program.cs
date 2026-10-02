using System.IO;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
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
        Application.Run(new RobotContext(pipeName));
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
            var agentCursorVisualOk=AgentCursorForm.StateSelfTest();
            var allOk=semanticJournalOk && visualLeasePolicyOk && browserLoopbackPolicyOk && rectSanitizationOk && semanticScopeOk && smoothMoveMathOk && agentCursorVisualOk;
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
                agentCursorVisualOk
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
