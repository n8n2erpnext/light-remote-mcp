using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace LightRemote.Configuration;

// Reads the ONE repo-authored JSON as an embedded, build-bound resource. No
// mutable per-user URL, environment fallback or browser-supplied authority.
internal sealed class CanonicalEndpoints
{
    private readonly Dictionary<string,string> _cloud;
    private readonly Dictionary<string,(string Host,int Port)> _local;
    private readonly Dictionary<string,(string Role,string Path,string? Fragment)> _routes;
    public int SchemaVersion { get; }
    public int ConfigRevision { get; }
    public string SelectedProfile { get; }
    public string ProductId { get; }
    public string? UpdateManifestUrl { get; }
    public string? UpdateSignatureUrl { get; }
    public string UpdateChannel { get; }
    public bool UpdateOnHold { get; }
    public string ContentSha256 { get; }

    private CanonicalEndpoints(byte[] bytes)
    {
        ContentSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        using var doc = JsonDocument.Parse(bytes);
        var root = doc.RootElement;
        SchemaVersion = root.GetProperty("schemaVersion").GetInt32();
        ConfigRevision = root.GetProperty("configRevision").GetInt32();
        SelectedProfile = root.GetProperty("selectedProfile").GetString() ?? "";
        if (SchemaVersion != 1 || ConfigRevision < 1 || SelectedProfile != "goldabv2-lab")
            throw new InvalidDataException("endpoint_schema_or_profile_invalid");
        var profile = root.GetProperty("profiles").GetProperty(SelectedProfile);
        ProductId = profile.GetProperty("productId").GetString() ?? "";
        if (ProductId != "goldabv2-desktop-v4")
            throw new InvalidDataException("endpoint_product_invalid");
        _cloud = new Dictionary<string,string>(StringComparer.Ordinal);
        foreach (var role in new[] { "owner", "operator", "deviceChannel", "mcp" })
        {
            var origin = profile.GetProperty("cloudOrigins").GetProperty(role).GetString() ?? "";
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) ||
                uri.Scheme != Uri.UriSchemeHttps || uri.AbsoluteUri != origin + "/" ||
                uri.UserInfo.Length > 0 || !uri.Host.StartsWith("goldabv2.", StringComparison.Ordinal) ||
                !uri.Host.EndsWith(".thaiduy.digital", StringComparison.Ordinal) || !uri.IsDefaultPort)
                throw new InvalidDataException("endpoint_untrusted_origin_" + role);
            _cloud.Add(role, origin);
        }
        _local = new Dictionary<string,(string,int)>(StringComparer.Ordinal);
        foreach (var role in new[] { "wall", "fleet" })
        {
            var item = profile.GetProperty("localServices").GetProperty(role);
            var host = item.GetProperty("host").GetString() ?? "";
            var port = item.GetProperty("port").GetInt32();
            if ((host != "127.0.0.1" && host != "::1") || port < 1024 || port > 65535)
                throw new InvalidDataException("endpoint_local_service_invalid_" + role);
            _local.Add(role, (host,port));
        }
        _routes = new Dictionary<string,(string,string,string?)>(StringComparer.Ordinal);
        foreach (var prop in root.GetProperty("routeCatalog").EnumerateObject())
        {
            var item = prop.Value;
            var role = item.GetProperty("originRole").GetString() ?? "";
            var route = item.GetProperty("path").GetString() ?? "";
            var fragment = item.TryGetProperty("fragment",out var f) ? f.GetString() : null;
            if (!(_cloud.ContainsKey(role) ||
                  (role.StartsWith("local.",StringComparison.Ordinal) &&
                   _local.ContainsKey(role["local.".Length..]))) ||
                !route.StartsWith("/",StringComparison.Ordinal) ||
                route.StartsWith("//",StringComparison.Ordinal) ||
                route.Contains("..",StringComparison.Ordinal) ||
                route.Contains("?",StringComparison.Ordinal) ||
                route.Contains("#",StringComparison.Ordinal) ||
                route.Contains("//",StringComparison.Ordinal))
                throw new InvalidDataException("endpoint_route_invalid_" + prop.Name);
            _routes.Add(prop.Name,(role,route,fragment));
        }
        foreach (var key in new[] { "wallHome", "wallStatus", "wallLogsPage",
            "ownerAuthorize", "ownerToken", "ownerRefresh", "ownerSession", "ownerSnapshot", "ownerLogout" })
            if (!_routes.ContainsKey(key)) throw new InvalidDataException("endpoint_route_missing_" + key);
        var update = profile.GetProperty("updates");
        if (update.GetProperty("productId").GetString() != ProductId ||
            update.GetProperty("channel").GetString() != "goldabv2-lab")
            throw new InvalidDataException("endpoint_update_profile_invalid");
        UpdateChannel = "goldabv2-lab";
        UpdateManifestUrl = update.GetProperty("manifestUrl").ValueKind == JsonValueKind.Null
            ? null : update.GetProperty("manifestUrl").GetString();
        UpdateSignatureUrl = update.GetProperty("signatureUrl").ValueKind == JsonValueKind.Null
            ? null : update.GetProperty("signatureUrl").GetString();
        UpdateOnHold = update.GetProperty("activationStatus").GetString() ==
            "HOLD_UNTIL_APPROVED_PRODUCT_FEED_EXISTS";
        if (!UpdateOnHold || UpdateManifestUrl != null || UpdateSignatureUrl != null ||
            root.GetProperty("releaseIntegrity").GetProperty("signedManifestRequired").GetBoolean() != true)
            throw new InvalidDataException("goldabv2_update_not_approved");
    }

    private static CanonicalEndpoints LoadEmbedded()
    {
        using var stream = typeof(CanonicalEndpoints).Assembly.GetManifestResourceStream(
            "LightRemote.Canonical.Endpoints.json")
            ?? throw new InvalidDataException("canonical_endpoint_resource_missing");
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return new CanonicalEndpoints(memory.ToArray());
    }

    private static readonly Lazy<CanonicalEndpoints> GoldLoader = new(LoadEmbedded, true);
    public static CanonicalEndpoints Gold => GoldLoader.Value;
    public string CloudOrigin(string role) => _cloud.TryGetValue(role,out var value)
        ? value : throw new InvalidDataException("endpoint_unknown_cloud_role");
    public int LocalPort(string name) => _local.TryGetValue(name,out var value)
        ? value.Port : throw new InvalidDataException("endpoint_unknown_local_service");
    public string LocalBase(string name)
    {
        if (!_local.TryGetValue(name,out var value))
            throw new InvalidDataException("endpoint_unknown_local_service");
        var host = value.Host == "::1" ? "[::1]" : value.Host;
        return "http://" + host + ":" + value.Port;
    }
    public string Route(string routeName)
    {
        if (!_routes.TryGetValue(routeName,out var route))
            throw new InvalidDataException("endpoint_unknown_route");
        var root = route.Role.StartsWith("local.",StringComparison.Ordinal)
            ? LocalBase(route.Role["local.".Length..])
            : CloudOrigin(route.Role);
        return root + route.Path + (route.Fragment == null ? "" : "#" + route.Fragment);
    }

    // Used only after the detached update signature has been checked; product
    // identity and channel remain independently mandatory.
    public void RequireSignedUpdateIdentity(JsonElement manifest)
    {
        if (!manifest.TryGetProperty("productId",out var product) ||
            product.GetString() != ProductId ||
            !manifest.TryGetProperty("profile",out var profile) ||
            profile.GetString() != SelectedProfile ||
            !manifest.TryGetProperty("channel",out var channel) ||
            channel.GetString() != UpdateChannel)
            throw new InvalidDataException("update_wrong_product_or_profile");
    }
}
