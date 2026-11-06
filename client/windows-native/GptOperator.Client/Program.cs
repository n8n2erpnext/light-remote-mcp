using System.Text.Json;

namespace GptOperator.Client;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length > 0 && string.Equals(args[0], "--managed-process", StringComparison.OrdinalIgnoreCase))
        {
            Environment.ExitCode = ManagedProcessEnvelope.Run(args.Skip(1).ToArray());
            return;
        }
        if (args.Length == 2 && string.Equals(args[0], "--boot-evidence-self-test", StringComparison.OrdinalIgnoreCase))
        {
            Environment.ExitCode = WindowsBootEvidence.SelfTest(args[1]) ? 0 : 1;
            return;
        }
        // Deterministic REAL WinForms visual probe for CI. Bypasses normal
        // agent/mutex and never touches account, device state or Local Wall.
        var previewIndex = Array.IndexOf(args, "--tray-ui-preview");
        if (previewIndex >= 0 && previewIndex + 1 < args.Length)
        {
            try
            {
                ApplicationConfiguration.Initialize();
                var target = args[previewIndex + 1];
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(target))!);
                using var popup = new TrayPopoverForm(_ => Task.CompletedTask);
                popup.UpdateState(
                    new TrayAgentSnapshot(true, true, true, "connected", "VIP",
                        "", true, null, null, "DESKTOP-VA16D27"),
                    TrayVisualState.Connected, true, true, true);
                popup.AssertLayoutFits();
                popup.SavePreview(target + "-overview.png", false);
                popup.SavePreview(target + "-advanced.png", true);
                Environment.ExitCode = 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.ToString());
                Environment.ExitCode = 1;
            }
            return;
        }
        AppPaths.EnsureDirectories();
        var selfTestIndex = Array.IndexOf(args, "--self-test-output");
        if (selfTestIndex >= 0 && selfTestIndex + 1 < args.Length)
        {
            var output = args[selfTestIndex + 1];
            Environment.ExitCode = RunSelfTestAsync(output).GetAwaiter().GetResult() ? 0 : 1;
            return;
        }

        if (args.Contains("--agent-host", StringComparer.OrdinalIgnoreCase)) { Environment.ExitCode = AgentHost.Run(); return; }
#if LIGHT_REMOTE_GOLDABV2_V4
        if (args.Length == 2 && args[0].Equals("--desktop-bridge", StringComparison.OrdinalIgnoreCase))
        {
            Environment.ExitCode = TrayApplicationContext.DesktopBridgeAsync(args[1]).GetAwaiter().GetResult();
            return;
        }
#endif
        if (args.Contains("--open-wall", StringComparer.OrdinalIgnoreCase)) { OpenWall(); return; }
#if LIGHT_REMOTE_GOLDABV2_V4
        // Desktop V4 is the ONLY user-facing GUI and native Tray owner.
        // This .NET binary remains only the internal scheduled Agent host and
        // explicitly bounded local Desktop bridge, never a second Tray app.
        TrayApplicationContext.OpenDesktopApp();
        return;
#else
        var launcher = args.Contains("--launch", StringComparer.OrdinalIgnoreCase);
        using var mutex = new Mutex(true, @"Local\GPT_OPERATOR_CLIENT_V09", out var firstInstance);
        if (!firstInstance) { if (launcher) OpenWall(); return; }
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApplicationContext());
#endif
    }

    private static void OpenWall()
    {
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("http://127.0.0.1:5491/") { UseShellExecute = true }); }
        catch { }
    }

    private static async Task<bool> RunSelfTestAsync(string output)
    {
        try
        {
            using var supervisor = new AgentSupervisor();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var status = await supervisor.ReadStatusAsync(timeout.Token);
            var semverOk = SemanticVersion.IsNewer("0.9.0-beta.2", "0.9.0-beta.1")
                && SemanticVersion.IsNewer("0.9.0-rc.1", "0.9.0-beta.9")
                && SemanticVersion.IsNewer("0.9.0", "0.9.0-rc.9")
                && !SemanticVersion.IsNewer("0.9.0-beta.1", "0.9.0-beta.1")
                && !SemanticVersion.IsNewer("0.9.0-beta.1", "0.9.0-rc.1");
            var trayLogicOk = TrayApplicationContext.SelfTest();
            var targetProfileOk = ConnectionConfig.PackageTargetSelfTest();
            var trayIconOk = TrayIconFactory.SelfTest();
            var agentHostRecoveryOk = AgentHost.SelfTestRestartPolicy();
            var result = new {
                ok = File.Exists(AppPaths.NodeExe) && File.Exists(AppPaths.AgentScript) && File.Exists(AppPaths.UpdatePublicKey) && semverOk && trayLogicOk && targetProfileOk && trayIconOk && agentHostRecoveryOk,
                semanticVersion = semverOk ? "pass" : "fail",
                trayLogic = trayLogicOk ? "pass" : "fail",
                targetProfile = targetProfileOk ? "pass" : "fail",
                agentHostRecovery = agentHostRecoveryOk ? "pass" : "fail",
                trayIcons = trayIconOk ? "pass" : "fail",
                clientVersion = ClientVersion.Display,
                agentVersion = status.Version,
                platformAdapter = status.PlatformAdapter,
                enrolled = status.Enrolled,
                node = AppPaths.NodeExe,
                agent = AppPaths.AgentScript
            };
            File.WriteAllText(output, JsonSerializer.Serialize(result));
            return result.ok && status.PlatformAdapter == "win32";
        }
        catch (Exception ex)
        {
            File.WriteAllText(output, JsonSerializer.Serialize(new { ok = false, error = ex.Message }));
            return false;
        }
    }
}
