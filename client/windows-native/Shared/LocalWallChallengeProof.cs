using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LightRemote.Configuration;

// Nonce challenge for an OS-owned LOCAL Wall process. Current-user secret is
// not an Owner bearer or an AB approval. A malicious process with the same
// user's file access is outside this proof's trust boundary.
internal static class LocalWallChallengeProof
{
    private const string Domain="lr-goldabv2-wall-v1";
    private static string KeyPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".config","gpt-operator-agent-goldabv2","wall-instance.key");

    internal static string Message(string nonce,int pid,string product,string profile,int revision)
        => string.Join("\n",Domain,nonce,pid.ToString(CultureInfo.InvariantCulture),
            product,profile,revision.ToString(CultureInfo.InvariantCulture));

    internal static bool VerifyPayload(string json,string nonce,int expectedPid,
        byte[] key,int revision)
    {
        try
        {
            if (key.Length!=32||nonce.Length!=64||expectedPid<1)return false;
            using var doc=JsonDocument.Parse(json);
            var root=doc.RootElement;
            if (!root.TryGetProperty("ok",out var ok)||ok.ValueKind!=JsonValueKind.True ||
                !root.TryGetProperty("pid",out var pidRow)||pidRow.GetInt32()!=expectedPid ||
                !root.TryGetProperty("configRevision",out var rev)||
                rev.GetInt32()!=revision ||
                !root.TryGetProperty("productId",out var prod)||
                prod.GetString()!="goldabv2-desktop-v4"||
                !root.TryGetProperty("profile",out var profile)||
                profile.GetString()!="goldabv2-lab"||
                !root.TryGetProperty("mac",out var signature))return false;
            var macText=signature.GetString();
            if (macText is null||macText.Length!=64||
                macText.Any(c=>!((c>='0'&&c<='9')||(c>='a'&&c<='f'))))
                return false;
            var supplied=Convert.FromHexString(macText);
            var message=Message(nonce,expectedPid,"goldabv2-desktop-v4","goldabv2-lab",revision);
            var expected=HMACSHA256.HashData(key,Encoding.UTF8.GetBytes(message));
            return CryptographicOperations.FixedTimeEquals(supplied,expected);
        }
        catch {return false;}
    }

    internal static bool Probe(int port,int ownerPid)
    {
        try
        {
            var keyText=File.ReadAllText(KeyPath).Trim();
            if (keyText.Length!=64||keyText.Any(c=>!((c>='0'&&c<='9')||(c>='a'&&c<='f'))))
                return false;
            var key=Convert.FromHexString(keyText);
            var nonce=Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            var url=CanonicalEndpoints.Gold.Route("wallInstanceProof");
            if(!Uri.TryCreate(url,UriKind.Absolute,out var uri)||
                uri.Scheme!="http"||uri.Host!="127.0.0.1"||uri.Port!=port||
                uri.Query.Length>0||uri.Fragment.Length>0)return false;
            using var handler=new HttpClientHandler{
                AllowAutoRedirect=false,UseCookies=false,UseProxy=false
            };
            using var client=new HttpClient(handler){Timeout=TimeSpan.FromMilliseconds(700)};
            using var response=client.GetAsync(url+"?nonce="+nonce,
                HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult();
            if(response.StatusCode!=HttpStatusCode.OK)return false;
            using var body=response.Content.ReadAsStream();
            using var readTimeout=new CancellationTokenSource(TimeSpan.FromMilliseconds(700));
            var buffer=new byte[4097];
            var total=0;
            while(total<buffer.Length)
            {
                var n=body.ReadAsync(buffer.AsMemory(total,buffer.Length-total),
                    readTimeout.Token).AsTask().GetAwaiter().GetResult();
                if(n<=0)break;
                total+=n;
            }
            if(total<=0||total>4096)return false;
            return VerifyPayload(Encoding.UTF8.GetString(buffer,0,total),nonce,
                ownerPid,key,checked((int)CanonicalEndpoints.Gold.ConfigRevision));
        }
        catch {return false;}
    }
}
