using System.Text.Json;

namespace GptOperator.Client;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        AppPaths.EnsureDirectories();
        var applyIndex = Array.IndexOf(args, "--apply-update");
        if (applyIndex >= 0 && applyIndex + 4 < args.Length)
        {
            _ = int.TryParse(args[applyIndex + 4], out var parentPid);
            Environment.ExitCode = UpdateApplier.ApplyAsync(
                args[applyIndex + 1], args[applyIndex + 2], args[applyIndex + 3], parentPid).GetAwaiter().GetResult();
            return;
        }

        var verifyIndex = Array.IndexOf(args, "--verify-update-fixture");
        if (verifyIndex >= 0 && verifyIndex + 3 < args.Length)
        {
            Environment.ExitCode = VerifyUpdateFixture(args[verifyIndex + 1], args[verifyIndex + 2], args[verifyIndex + 3]) ? 0 : 1;
            return;
        }

        var selfTestIndex = Array.IndexOf(args, "--self-test-output");
        if (selfTestIndex >= 0 && selfTestIndex + 1 < args.Length)
        {
            var output = args[selfTestIndex + 1];
            Environment.ExitCode = RunSelfTestAsync(output).GetAwaiter().GetResult() ? 0 : 1;
            return;
        }

        if (args.Contains("--open-wall", StringComparer.OrdinalIgnoreCase)) { try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("http://127.0.0.1:5491/") { UseShellExecute = true }); } catch { } return; }
        if (args.Contains("--scheduled-update", StringComparer.OrdinalIgnoreCase)) { Environment.ExitCode = RunScheduledUpdateAsync().GetAwaiter().GetResult(); return; }
        using var mutex = new Mutex(true, @"Local\GPT_OPERATOR_CLIENT_V09", out var firstInstance);
        if (!firstInstance) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApplicationContext());
    }

    private static async Task<int> RunScheduledUpdateAsync()
    {
        try { var client=new UpdateClient(); var update=await client.CheckAsync(); if(update is null)return 0; var installer=await client.DownloadAndVerifyAsync(update); client.LaunchInstaller(installer,update); return 0; }
        catch(FileNotFoundException){return 0;}
        catch(Exception ex){try{AppPaths.EnsureDirectories();File.AppendAllText(AppPaths.UpdateLog,$"{DateTimeOffset.UtcNow:o} scheduled_update_failed {ex.Message}{Environment.NewLine}");}catch{}return 1;}
    }

    private static bool VerifyUpdateFixture(string manifest, string signature, string output)
    {
        try
        {
            UpdateClient.VerifySignedManifest(File.ReadAllBytes(manifest), File.ReadAllText(signature).Trim(), AppPaths.UpdatePublicKey);
            File.WriteAllText(output, JsonSerializer.Serialize(new { ok = true, updateSignature = "valid" }));
            return true;
        }
        catch (Exception ex)
        {
            File.WriteAllText(output, JsonSerializer.Serialize(new { ok = false, error = ex.Message }));
            return false;
        }
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
