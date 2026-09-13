using System.Text.Json;

namespace GptOperator.Client;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        AppPaths.EnsureDirectories();
        var selfTestIndex = Array.IndexOf(args, "--self-test-output");
        if (selfTestIndex >= 0 && selfTestIndex + 1 < args.Length)
        {
            var output = args[selfTestIndex + 1];
            Environment.ExitCode = RunSelfTestAsync(output).GetAwaiter().GetResult() ? 0 : 1;
            return;
        }

        if (args.Contains("--agent-host", StringComparer.OrdinalIgnoreCase)) { Environment.ExitCode = AgentHost.Run(); return; }
        if (args.Contains("--open-wall", StringComparer.OrdinalIgnoreCase)) { OpenWall(); return; }
        var launcher = args.Contains("--launch", StringComparer.OrdinalIgnoreCase);
        using var mutex = new Mutex(true, @"Local\GPT_OPERATOR_CLIENT_V09", out var firstInstance);
        if (!firstInstance) { if (launcher) OpenWall(); return; }
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApplicationContext());
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
            var result = new {
                ok = File.Exists(AppPaths.NodeExe) && File.Exists(AppPaths.AgentScript) && File.Exists(AppPaths.UpdatePublicKey) && semverOk,
                semanticVersion = semverOk ? "pass" : "fail",
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
