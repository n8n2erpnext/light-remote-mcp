using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LightRemote.Configuration;

// Installer-owned layout metadata may select only these two fixed names.
// It is not a general executable path supplied by JSON, HTTP or WebView.
internal static class CoreLayout
{
    internal const string PrimaryId = "lightremote-primary-hosted-v1";
    internal const string LegacyId = "legacy-dotnet-v1";
    internal const string PrimaryName = "LightRemote.exe";
    internal const string LegacyName = "GptOperator.Client.exe";

    internal static string? ResolveCore(string installDir)
    {
        try
        {
            if (!Path.IsPathFullyQualified(installDir)) return null;
            var root = Path.GetFullPath(installDir);
            var legacy = Path.Combine(root, LegacyName);
            var marker = Path.Combine(root, "config", "core-layout.json");
            if (!File.Exists(marker)) return File.Exists(legacy) ? legacy : null;
            if (new FileInfo(marker).Length > 16384) return null;
            using var json = JsonDocument.Parse(File.ReadAllText(marker));
            var row = json.RootElement;
            var canonical = CanonicalEndpoints.Gold;
            if (row.GetProperty("schemaVersion").GetInt32() != 1 ||
                row.GetProperty("productId").GetString() != canonical.ProductId ||
                row.GetProperty("profile").GetString() != canonical.SelectedProfile) return null;
            var id = row.GetProperty("layoutId").GetString();
            var entry = row.GetProperty("entryPoint").GetString();
            if (id == LegacyId && entry == LegacyName) return File.Exists(legacy) ? legacy : null;
            if (id != PrimaryId || entry != PrimaryName) return null;
#if !LIGHT_REMOTE_GOLDABV2_V4
            // A regular Gold helper is never a cross-product migration tool.
            return null;
#else
            var installedVersion = Path.Combine(root, "VERSION");
            if (!File.Exists(installedVersion)) return null;
            if (row.GetProperty("version").GetString() != File.ReadAllText(installedVersion).Trim())
            {
                // A verified older installer can leave unknown newer files.
                // Its restored VERSION and old core select the rollback layout.
                return File.Exists(legacy) ? legacy : null;
            }
            var primary = Path.Combine(root, PrimaryName);
            return File.Exists(primary) ? primary : null;
#endif
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or
                                   InvalidOperationException or KeyNotFoundException or ArgumentException or FormatException or OverflowException)
        { return null; }
    }

    internal static bool IsPrimary(string installDir)
        => string.Equals(Path.GetFileName(ResolveCore(installDir)), PrimaryName, StringComparison.OrdinalIgnoreCase);

    internal static string? ResolveGui(string installDir)
    {
        var core = ResolveCore(installDir);
        if (core is null || IsPrimary(installDir)) return core;
#if LIGHT_REMOTE_GOLDABV2_V4
        var desktop = Path.Combine(installDir, "desktop-v4", "LightRemote.Desktop.exe");
        return File.Exists(desktop) ? desktop : core;
#else
        return core;
#endif
    }

    internal static string[] RuntimeFiles(string installDir) => new[]
    {
        Path.GetFullPath(Path.Combine(installDir, LegacyName)),
        Path.GetFullPath(Path.Combine(installDir, PrimaryName)),
        Path.GetFullPath(Path.Combine(installDir, "desktop-v4", "LightRemote.Desktop.exe")),
        Path.GetFullPath(Path.Combine(installDir, "runtime", "node.exe"))
    };

    internal static async Task<bool> StopPrimaryAgentAsync(string installDir)
    {
        var core = ResolveCore(installDir);
        if (core is null || !IsPrimary(installDir)) return false;
        using var process = Process.Start(new ProcessStartInfo(core)
        {
            UseShellExecute = false, CreateNoWindow = true, ArgumentList = { "--stop-agent-host" }
        });
        if (process is null) return false;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        try { await process.WaitForExitAsync(timeout.Token); return process.ExitCode == 0; }
        catch (OperationCanceledException)
        {
            // Terminate only this diagnostic worker, never the GUI or a PID
            // guessed from a port. An unverified stop remains a failure.
            try { if (!process.HasExited) process.Kill(entireProcessTree: false); } catch { }
            return false;
        }
    }

    internal static bool SelfTest()
    {
        var root = Path.Combine(Path.GetTempPath(), "lr-core-layout-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "config"));
            var legacy = Path.Combine(root, LegacyName);
            var primary = Path.Combine(root, PrimaryName);
            File.WriteAllText(legacy, "fixture");
            var oldOk = ResolveCore(root) == legacy;
            File.WriteAllText(primary, "fixture");
            File.WriteAllText(Path.Combine(root, "VERSION"), "0.10.1-dev.2");
            var row = new JsonObject { ["schemaVersion"] = 1, ["layoutId"] = PrimaryId,
                ["entryPoint"] = PrimaryName, ["productId"] = CanonicalEndpoints.Gold.ProductId,
                ["profile"] = CanonicalEndpoints.Gold.SelectedProfile, ["version"] = "0.10.1-dev.2" };
            var marker = Path.Combine(root, "config", "core-layout.json");
            File.WriteAllText(marker, row.ToJsonString());
#if LIGHT_REMOTE_GOLDABV2_V4
            var newOk = ResolveCore(root) == primary;
#else
            var newOk = ResolveCore(root) is null;
#endif
            row["entryPoint"] = "../untrusted.exe";
            File.WriteAllText(marker, row.ToJsonString());
            var pathRejected = ResolveCore(root) is null;
            row["entryPoint"] = PrimaryName; row["productId"] = "wrong-product";
            File.WriteAllText(marker, row.ToJsonString());
            var wrongProductRejected = ResolveCore(root) is null;
            row["productId"] = CanonicalEndpoints.Gold.ProductId;
            File.WriteAllText(marker, row.ToJsonString());
            File.WriteAllText(Path.Combine(root, "VERSION"), "0.10.0-dev.1");
#if LIGHT_REMOTE_GOLDABV2_V4
            var rollbackOk = ResolveCore(root) == legacy;
#else
            var rollbackOk = ResolveCore(root) is null;
#endif
            return oldOk && newOk && pathRejected && wrongProductRejected && rollbackOk;
        }
        finally { try { Directory.Delete(root, recursive: true); } catch { } }
    }
}
