using System.Text.Json;

namespace GptOperator.Client;

internal sealed record ConnectionSettings(string BridgeUrl, string HubUrl);

internal static class ConnectionConfig
{
    public const string DefaultBridgeUrl = "https://light-remote-mcp.vercel.app";
    public const string DefaultHubUrl = "https://mcp.dashboard.thaiduy.store";

    public static ConnectionSettings Load()
    {
        var envBridge = Environment.GetEnvironmentVariable("OPERATOR_AGENT_BASE_URL");
        var envHub = Environment.GetEnvironmentVariable("OPERATOR_AGENT_HUB_URL");
        if (!string.IsNullOrWhiteSpace(envBridge) || !string.IsNullOrWhiteSpace(envHub))
            return new ConnectionSettings(Normalize(envBridge, DefaultBridgeUrl), Normalize(envHub, DefaultHubUrl));

        try
        {
            if (File.Exists(AppPaths.ConnectionFile))
            {
                var saved = JsonSerializer.Deserialize<ConnectionSettings>(File.ReadAllText(AppPaths.ConnectionFile));
                if (saved is not null) return new ConnectionSettings(Normalize(saved.BridgeUrl, DefaultBridgeUrl), Normalize(saved.HubUrl, DefaultHubUrl));
            }
        }
        catch { }
        return new ConnectionSettings(DefaultBridgeUrl, DefaultHubUrl);
    }
    public static void Save(string bridgeUrl, string hubUrl)
    {
        var settings = new ConnectionSettings(RequireHttps(bridgeUrl, "Vercel bridge URL"), RequireHttps(hubUrl, "Server/Hub URL"));
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

    private static string Normalize(string? value, string fallback)
    {
        try { return RequireHttps(string.IsNullOrWhiteSpace(value) ? fallback : value!, "Connection URL"); }
        catch { return fallback; }
    }
}
