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

        using var mutex = new Mutex(true, @"Local\GPT_OPERATOR_CLIENT_V09", out var firstInstance);
        if (!firstInstance) return;
        ApplicationConfiguration.Initialize();
        using var form = new MainForm();
        if (args.Contains("--background", StringComparer.OrdinalIgnoreCase))
            form.Shown += (_, _) => form.Hide();
        Application.Run(form);
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
            var status = await supervisor.ReadStatusAsync();
            var result = new {
                ok = File.Exists(AppPaths.NodeExe) && File.Exists(AppPaths.AgentScript) && File.Exists(AppPaths.UpdatePublicKey),
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
