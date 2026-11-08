using LightRemote.Configuration;
using System.Text.Json;

namespace GptOperator.Client;

internal sealed record ConnectionSettings(string BridgeUrl, string HubUrl);

internal static class ConnectionConfig
{
#if LIGHT_REMOTE_GOLDABV2_V4
    // New V4 QA installs use the GoldABV2 backend. Existing saved enrollment
    // URLs are NEVER silently migrated: Owner must explicitly relink devices.
    public static string StablePublicEndpoint => CanonicalEndpoints.Gold.CloudOrigin("deviceChannel");
#else
    public const string StablePublicEndpoint = "https://gold.light-remote.thaiduy.digital";
#endif
    public static string DefaultBridgeUrl => StablePublicEndpoint;
    public static string DefaultHubUrl => StablePublicEndpoint;

    private static readonly string[] LegacyBridgeUrls =
    [
        "https://light-remote.thaiduy.digital",
        "https://light-remote-mcp.vercel.app",
        "https://lightremote.thaiduy.digital"
    ];

    private static readonly string[] LegacyHubUrls =
    [
        "https://light-remote.thaiduy.digital",
        "https://mcp.dashboard.thaiduy.store",
        "https://lightremote.thaiduy.digital"
    ];

    public static ConnectionSettings Load()
    {
#if LIGHT_REMOTE_GOLDABV2_V4
        // No production fallback, no inherited production env, no previous Gold
        // connection.json. This target's local enrollment is isolated by AppPaths.
        return new ConnectionSettings(DefaultBridgeUrl, DefaultHubUrl);
#else
        var envBridge = Environment.GetEnvironmentVariable("OPERATOR_AGENT_BASE_URL");
        var envHub = Environment.GetEnvironmentVariable("OPERATOR_AGENT_HUB_URL");
        if (!string.IsNullOrWhiteSpace(envBridge) || !string.IsNullOrWhiteSpace(envHub))
            return new ConnectionSettings(
                Normalize(envBridge, DefaultBridgeUrl, LegacyBridgeUrls),
                Normalize(envHub, DefaultHubUrl, LegacyHubUrls));

        try
        {
            if (File.Exists(AppPaths.ConnectionFile))
            {
                var saved = JsonSerializer.Deserialize<ConnectionSettings>(File.ReadAllText(AppPaths.ConnectionFile));
                if (saved is not null)
                    return new ConnectionSettings(
                        Normalize(saved.BridgeUrl, DefaultBridgeUrl, LegacyBridgeUrls),
                        Normalize(saved.HubUrl, DefaultHubUrl, LegacyHubUrls));
            }
        }
        catch { }
        return new ConnectionSettings(DefaultBridgeUrl, DefaultHubUrl);
#endif
    }

    public static void Save(string bridgeUrl, string hubUrl)
    {
#if LIGHT_REMOTE_GOLDABV2_V4
        if (!String.Equals(RequireHttps(bridgeUrl, "Light Remote bridge URL"), StablePublicEndpoint, StringComparison.OrdinalIgnoreCase) ||
            !String.Equals(RequireHttps(hubUrl, "Light Remote hub URL"), StablePublicEndpoint, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("goldabv2_wrong_server_endpoint");
#endif
        var settings = new ConnectionSettings(
            MigrateKnownDefault(RequireHttps(bridgeUrl, "Light Remote bridge URL"), LegacyBridgeUrls),
            MigrateKnownDefault(RequireHttps(hubUrl, "Light Remote hub URL"), LegacyHubUrls));
        AppPaths.EnsureDirectories();
        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(AppPaths.ConnectionFile, json + Environment.NewLine);
    }

    internal static bool PackageTargetSelfTest()
    {
#if LIGHT_REMOTE_GOLDABV2_V4
        var effective = Load();
        return effective.BridgeUrl == StablePublicEndpoint
            && effective.HubUrl == StablePublicEndpoint
            && CanonicalEndpoints.Gold.ProductId == "goldabv2-desktop-v4"
            && CanonicalEndpoints.Gold.UpdateOnHold
            && AppPaths.ConnectionFile.Contains("LightRemoteGoldABV2", StringComparison.Ordinal)
            && AppPaths.StateFile.Contains("gpt-operator-agent-goldabv2", StringComparison.Ordinal)
            && !AppPaths.StateFile.Contains("gpt-operator-agent\\device.json", StringComparison.OrdinalIgnoreCase);
#else
        return true;
#endif
    }

    public static string RequireHttps(string value, string label)
    {
        var normalized = (value ?? string.Empty).Trim().TrimEnd('/');
        if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || string.IsNullOrWhiteSpace(uri.Host))
            throw new InvalidOperationException($"{label} must be an HTTPS URL.");
        return normalized;
    }

    private static string Normalize(string? value, string fallback, string[] legacy)
    {
        try
        {
            var normalized = RequireHttps(string.IsNullOrWhiteSpace(value) ? fallback : value!, "Connection URL");
            return MigrateKnownDefault(normalized, legacy);
        }
        catch { return fallback; }
    }

    private static string MigrateKnownDefault(string normalized, string[] legacy) =>
#if LIGHT_REMOTE_GOLDABV2_V4
        // Preserve a previously configured Gold/legacy endpoint verbatim.
        // Switching authority with a stored device identity must be explicit.
        normalized;
#else
        legacy.Contains(normalized, StringComparer.OrdinalIgnoreCase) ? StablePublicEndpoint : normalized;
#endif
}
