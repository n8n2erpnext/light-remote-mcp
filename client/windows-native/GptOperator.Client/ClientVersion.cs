namespace GptOperator.Client;

internal static class ClientVersion
{
    public const string Display = "0.9.0-dev";
    public static readonly Version SemVer = new(0, 9, 0);
    public const string DefaultManifestUrl = "https://github.com/n8n2erpnext/light-remote-mcp/releases/latest/download/client-update.json";
    public const string DefaultSignatureUrl = "https://github.com/n8n2erpnext/light-remote-mcp/releases/latest/download/client-update.json.sig";
}
