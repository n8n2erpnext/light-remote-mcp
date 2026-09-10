using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace GptOperator.Client;

internal sealed record UpdateArtifact(string Url, string Sha256, long Size, string? InstallerArgs);
internal sealed record UpdateInfo(string Version, string? Notes, UpdateArtifact Artifact);

internal sealed class UpdateClient
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly string _manifestUrl;
    private readonly string _signatureUrl;

    public UpdateClient()
    {
        _manifestUrl = Environment.GetEnvironmentVariable("GPT_OPERATOR_UPDATE_MANIFEST_URL") ?? ClientVersion.DefaultManifestUrl;
        _signatureUrl = Environment.GetEnvironmentVariable("GPT_OPERATOR_UPDATE_SIGNATURE_URL") ?? ClientVersion.DefaultSignatureUrl;
    }

    public async Task<UpdateInfo?> CheckAsync(CancellationToken cancellationToken = default)
    {
        var manifestBytes = await DownloadRequiredAsync(_manifestUrl, cancellationToken);
        var signatureText = System.Text.Encoding.UTF8.GetString(await DownloadRequiredAsync(_signatureUrl, cancellationToken)).Trim();
        VerifySignedManifest(manifestBytes, signatureText, AppPaths.UpdatePublicKey);
        using var doc = JsonDocument.Parse(manifestBytes);
        var root = doc.RootElement;
        if (root.GetProperty("schemaVersion").GetInt32() != 1) throw new InvalidOperationException("Unsupported update manifest schema.");
        var versionText = root.GetProperty("version").GetString() ?? throw new InvalidOperationException("Update version missing.");
        if (!Version.TryParse(versionText.TrimStart('v'), out var version)) throw new InvalidOperationException("Invalid update version.");
        if (version <= ClientVersion.SemVer) return null;
        var platforms = root.GetProperty("artifacts");
        if (!platforms.TryGetProperty("windows-x64", out var item)) return null;
        var artifact = new UpdateArtifact(
            item.GetProperty("url").GetString() ?? "",
            item.GetProperty("sha256").GetString() ?? "",
            item.GetProperty("size").GetInt64(),
            item.TryGetProperty("installerArgs", out var args) ? args.GetString() : null);
        if (!Uri.TryCreate(artifact.Url, UriKind.Absolute, out _)) throw new InvalidOperationException("Invalid update artifact URL.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(artifact.Sha256, "^[a-fA-F0-9]{64}$")) throw new InvalidOperationException("Invalid update artifact SHA256.");
        return new UpdateInfo(versionText, root.TryGetProperty("notes", out var notes) ? notes.GetString() : null, artifact);
    }

    public async Task<string> DownloadAndVerifyAsync(UpdateInfo update, CancellationToken cancellationToken = default)
    {
        AppPaths.EnsureDirectories();
        var file = Path.Combine(AppPaths.UpdateDir, $"GPT-Operator-Setup-{update.Version}-x64.exe");
        using var response = await _http.GetAsync(update.Artifact.Url, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken))
        await using (var output = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.None))
            await input.CopyToAsync(output, cancellationToken);
        var info = new FileInfo(file);
        if (update.Artifact.Size > 0 && info.Length != update.Artifact.Size) { File.Delete(file); throw new InvalidOperationException("Update size mismatch."); }
        var actual = Convert.ToHexString(await SHA256.HashDataAsync(File.OpenRead(file), cancellationToken)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(actual), Convert.FromHexString(update.Artifact.Sha256)))
        { File.Delete(file); throw new InvalidOperationException("Update SHA256 mismatch."); }
        return file;
    }
    public void LaunchInstaller(string installerPath, UpdateInfo update)
    {
        AppPaths.EnsureDirectories();
        var helper = Path.Combine(AppPaths.UpdateDir, $"update-helper-{Guid.NewGuid():N}.exe");
        File.Copy(Application.ExecutablePath, helper, overwrite: true);
        var psi = new ProcessStartInfo(helper) { UseShellExecute = false, CreateNoWindow = true };
        psi.ArgumentList.Add("--apply-update");
        psi.ArgumentList.Add(installerPath);
        psi.ArgumentList.Add(AppPaths.Root);
        psi.ArgumentList.Add(ClientVersion.Display);
        psi.ArgumentList.Add(Environment.ProcessId.ToString());
        Process.Start(psi);
    }

    internal static void VerifySignedManifest(byte[] manifestBytes, string signatureText, string publicKeyFile)
    {
        if (!File.Exists(publicKeyFile)) throw new FileNotFoundException("Update public key is missing.", publicKeyFile);
        byte[] signature;
        try { signature = Convert.FromBase64String(signatureText); }
        catch { throw new InvalidOperationException("Update manifest signature encoding is invalid."); }
        using var ecdsa = ECDsa.Create();
        ecdsa.ImportFromPem(File.ReadAllText(publicKeyFile));
        if (!ecdsa.VerifyData(manifestBytes, signature, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence))
            throw new CryptographicException("Update manifest signature is invalid.");
    }

    private async Task<byte[]> DownloadRequiredAsync(string url, CancellationToken cancellationToken)
    {
        using var response = await _http.GetAsync(url, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            throw new FileNotFoundException("No update release manifest is published yet.");
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }
}
