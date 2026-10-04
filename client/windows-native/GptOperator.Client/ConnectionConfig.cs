using System.Text.Json;

namespace GptOperator.Client;

internal sealed record ConnectionSettings(string BridgeUrl, string HubUrl);

internal static class ConnectionConfig
{
    public const string StablePublicEndpoint = "https://light-remote.thaiduy.digital";
    public const string DefaultBridgeUrl = StablePublicEndpoint;
    public const string DefaultHubUrl = StablePublicEndpoint;

    private static readonly string[] LegacyBridgeUrls =
    [
        "https://light-remote-mcp.vercel.app",
        "https://lightremote.thaiduy.digital"
    ];

    private static readonly string[] LegacyHubUrls =
    [
        "https://mcp.dashboard.thaiduy.store",
        "https://lightremote.thaiduy.digital"
    ];

    public static ConnectionSettings Load()
    {
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
    }

    public static void Save(string bridgeUrl, string hubUrl)
    {
        var settings = new ConnectionSettings(
            MigrateKnownDefault(RequireHttps(bridgeUrl, "Light Remote bridge URL"), LegacyBridgeUrls),
            MigrateKnownDefault(RequireHttps(hubUrl, "Light Remote hub URL"), LegacyHubUrls));
        AppPaths.EnsureDirectories();
        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(AppPaths.ConnectionFile, json + Environment.NewLine);
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
        legacy.Contains(normalized, StringComparer.OrdinalIgnoreCase) ? StablePublicEndpoint : normalized;
}
