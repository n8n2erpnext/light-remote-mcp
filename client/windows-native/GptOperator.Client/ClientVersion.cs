namespace GptOperator.Client;

internal static class ClientVersion
{
    private const string Fallback = "0.9.0-rc.6";
    public static string Display {
        get {
            try {
                var file = Path.Combine(AppContext.BaseDirectory, "VERSION");
                var value = File.Exists(file) ? File.ReadAllText(file).Trim() : "";
                return string.IsNullOrWhiteSpace(value) ? Fallback : value;
            } catch { return Fallback; }
        }
    }
    public const string DefaultManifestUrl = "https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json";
    public const string DefaultSignatureUrl = "https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json.sig";
}
