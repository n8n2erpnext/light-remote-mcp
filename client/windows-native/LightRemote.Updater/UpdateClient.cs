using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace LightRemote.Updater;

internal sealed record UpdateArtifact(string Url,string Sha256,long Size,string? InstallerArgs);
internal sealed record UpdateInfo(string Version,string? Notes,UpdateArtifact Artifact);

internal sealed class UpdateClient
{
    private const string DefaultManifestUrl="https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json";
    private const string DefaultSignatureUrl="https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json.sig";
    private readonly HttpClient _http=new(){Timeout=TimeSpan.FromSeconds(30)};
    private readonly string _manifestUrl=Environment.GetEnvironmentVariable("GPT_OPERATOR_UPDATE_MANIFEST_URL")??DefaultManifestUrl;
    private readonly string _signatureUrl=Environment.GetEnvironmentVariable("GPT_OPERATOR_UPDATE_SIGNATURE_URL")??DefaultSignatureUrl;

    public async Task<UpdateInfo?> CheckAsync(string currentVersion,CancellationToken cancellationToken=default)
    {
        var manifestBytes=await DownloadRequiredAsync(_manifestUrl,cancellationToken);var signatureText=System.Text.Encoding.UTF8.GetString(await DownloadRequiredAsync(_signatureUrl,cancellationToken)).Trim();
        VerifySignedManifest(manifestBytes,signatureText,RecoveryPaths.UpdatePublicKey);using var doc=JsonDocument.Parse(manifestBytes);var root=doc.RootElement;
        if(root.GetProperty("schemaVersion").GetInt32()!=1)throw new InvalidOperationException("Unsupported update manifest schema.");
        var versionText=root.GetProperty("version").GetString()??throw new InvalidOperationException("Update version missing.");
        if(!SemanticVersion.TryParse(versionText,out var candidate)||candidate is null)throw new InvalidOperationException("Invalid update version.");
        if(!SemanticVersion.TryParse(currentVersion,out var current)||current is null)throw new InvalidOperationException("Invalid current version.");
        if(candidate.CompareTo(current)<=0)return null;var platforms=root.GetProperty("artifacts");if(!platforms.TryGetProperty("windows-x64",out var item))return null;
        var artifact=new UpdateArtifact(item.GetProperty("url").GetString()??"",item.GetProperty("sha256").GetString()??"",item.GetProperty("size").GetInt64(),item.TryGetProperty("installerArgs",out var args)?args.GetString():null);
        if(!Uri.TryCreate(artifact.Url,UriKind.Absolute,out _))throw new InvalidOperationException("Invalid update artifact URL.");
        if(!System.Text.RegularExpressions.Regex.IsMatch(artifact.Sha256,"^[a-fA-F0-9]{64}$"))throw new InvalidOperationException("Invalid update artifact SHA256.");return new UpdateInfo(versionText,root.TryGetProperty("notes",out var notes)?notes.GetString():null,artifact);
    }

    public async Task<string> DownloadAndVerifyAsync(UpdateInfo update,CancellationToken cancellationToken=default)
    {
        RecoveryPaths.EnsureDirectories();var file=Path.Combine(RecoveryPaths.CacheDir,$"Light-Remote-MCP-Setup-{update.Version}-x64.exe");
        using var response=await _http.GetAsync(update.Artifact.Url,HttpCompletionOption.ResponseHeadersRead,cancellationToken);response.EnsureSuccessStatusCode();
        await using(var input=await response.Content.ReadAsStreamAsync(cancellationToken))await using(var output=new FileStream(file,FileMode.Create,FileAccess.Write,FileShare.None))await input.CopyToAsync(output,cancellationToken);
        var info=new FileInfo(file);if(update.Artifact.Size>0&&info.Length!=update.Artifact.Size){File.Delete(file);throw new InvalidOperationException("Update size mismatch.");}
        string actual;await using(var stream=File.OpenRead(file))actual=Convert.ToHexString(await SHA256.HashDataAsync(stream,cancellationToken)).ToLowerInvariant();
        if(!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(actual),Convert.FromHexString(update.Artifact.Sha256))){File.Delete(file);throw new InvalidOperationException("Update SHA256 mismatch.");}return file;
    }

    public void LaunchApplyHelper(string installerPath,string installDir,string currentVersion,string targetVersion,string txId)
    {
        RecoveryPaths.EnsureDirectories();var helper=Path.Combine(RecoveryPaths.CacheDir,$"updater-helper-{Guid.NewGuid():N}.exe");File.Copy(Environment.ProcessPath??throw new InvalidOperationException("Updater executable path unavailable."),helper,true);
        var psi=new ProcessStartInfo(helper){UseShellExecute=false,CreateNoWindow=true};psi.ArgumentList.Add("--apply-update");psi.ArgumentList.Add(installerPath);psi.ArgumentList.Add(installDir);psi.ArgumentList.Add(currentVersion);psi.ArgumentList.Add(Environment.ProcessId.ToString());psi.ArgumentList.Add(targetVersion);psi.ArgumentList.Add(txId);Process.Start(psi);
    }

    internal static void VerifySignedManifest(byte[] manifestBytes,string signatureText,string publicKeyFile)
    {
        if(!File.Exists(publicKeyFile))throw new FileNotFoundException("Update public key is missing.",publicKeyFile);byte[] signature;try{signature=Convert.FromBase64String(signatureText);}catch{throw new InvalidOperationException("Update manifest signature encoding is invalid.");}
        using var ecdsa=ECDsa.Create();ecdsa.ImportFromPem(File.ReadAllText(publicKeyFile));if(!ecdsa.VerifyData(manifestBytes,signature,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence))throw new CryptographicException("Update manifest signature is invalid.");
    }
    private async Task<byte[]> DownloadRequiredAsync(string url,CancellationToken cancellationToken){using var response=await _http.GetAsync(url,cancellationToken);if(response.StatusCode==System.Net.HttpStatusCode.NotFound)throw new FileNotFoundException("No update release manifest is published yet.");response.EnsureSuccessStatusCode();return await response.Content.ReadAsByteArrayAsync(cancellationToken);}
}
