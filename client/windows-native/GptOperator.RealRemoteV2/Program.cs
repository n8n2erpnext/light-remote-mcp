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
            Environment.ExitCode = SystemCursorOverride.ForceRestore()?0:1;
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
        Application.Run(new RobotContext(pipeName));
    }

    // Legacy CLI switch retained without an automatic system-scheme reload.
    private static int RunCursorGuardian(string parentPidText) => 0;
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
            var frameCacheOk=GdiFrameCache.SelfTest() && DesktopVisual.CropSelfTest() && DxgiCapture.SelfTest() && DesktopVisual.CleanupSelfTest();
            var interactionProfileOk=InteractionProfile.SelfTest();
            var rpcSchedulerOk=RpcWorkScheduler.SelfTest() && RobotRpcServer.AuthoritySelfTest();
            var logicalPacketGuardsOk=NativeInput.LogicalPacketSelfTest();
            var deliveryPollingOk=TypingTarget.DeliveryPollingSelfTest();
            var nativeLineBreakPolicyOk=TypingTarget.NativeLineBreakPolicySelfTest() && NativeEditReadback.SelfTest();
            var controlActivityOk=ControlActivity.SelfTest() && CursorGlowOverlay.SelfTest();
            var allOk=nativeLineBreakPolicyOk && deliveryPollingOk && logicalPacketGuardsOk && frameCacheOk && interactionProfileOk && rpcSchedulerOk && controlActivityOk && semanticJournalOk && visualLeasePolicyOk && browserLoopbackPolicyOk && rectSanitizationOk && semanticScopeOk && smoothMoveMathOk && agentCursorVisualOk && systemCursorOverrideOk;
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
                systemCursorOverrideOk,
                controlActivityOk,
                rpcSchedulerOk,
                logicalPacketGuardsOk,
                nativeLineBreakPolicyOk,
                deliveryPollingOk,
                interactionProfileOk,frameCacheOk
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
