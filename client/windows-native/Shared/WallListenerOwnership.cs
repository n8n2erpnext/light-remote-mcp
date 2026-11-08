using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace LightRemote.Configuration;

// A TCP LISTEN is never Agent identity. In the GoldABV2 product we require
// the listener's OS-owned PID, exact installed Node runtime path, and matching
// package product/profile marker; no process is killed by this probe.
// The proof is LOCAL process ownership, not a remote Owner/B authorization.
internal static class WallListenerOwnership
{
    private const int AfInet=2, OwnerPidListenerTable=3, ErrorInsufficientBuffer=122;
    private const int RowBytes=24, MaxTableBytes=2*1024*1024;
    [DllImport("iphlpapi.dll", SetLastError=true)]
    private static extern uint GetExtendedTcpTable(
        IntPtr table, ref int tableLength, bool order, int ipVersion,
        int tableClass, uint reserved);

    private static IEnumerable<int> ReadListenerPids(int port)
    {
        if (!OperatingSystem.IsWindows() || port<1024 || port>65535)
            return Array.Empty<int>();
        int length=0;
        var query=GetExtendedTcpTable(IntPtr.Zero,ref length,false,AfInet,OwnerPidListenerTable,0);
        if (query!=ErrorInsufficientBuffer || length<4 || length>MaxTableBytes)
            return Array.Empty<int>();
        var table=Marshal.AllocHGlobal(length);
        try
        {
            if (GetExtendedTcpTable(table,ref length,false,AfInet,OwnerPidListenerTable,0)!=0
                || length<4 || length>MaxTableBytes) return Array.Empty<int>();
            var count=Marshal.ReadInt32(table,0);
            if (count<0 || count>(length-4)/RowBytes) return Array.Empty<int>();
            var result=new HashSet<int>();
            for (var i=0;i<count;i++)
            {
                var start=4+i*RowBytes;
                if (Marshal.ReadInt32(table,start)!=2) continue; // TCP_STATE_LISTEN
                var rawAddress=(uint)Marshal.ReadInt32(table,start+4);
                if (rawAddress!=0x0100007F) continue; // exact 127.0.0.1 only
                var rawPort=(ushort)(Marshal.ReadInt32(table,start+8)&0xFFFF);
                var localPort=(ushort)System.Net.IPAddress.NetworkToHostOrder(unchecked((short)rawPort));
                if (localPort!=port) continue;
                var pid=Marshal.ReadInt32(table,start+20);
                if (pid>0)result.Add(pid);
            }
            return result.ToArray();
        }
        catch { return Array.Empty<int>(); }
        finally { Marshal.FreeHGlobal(table); }
    }

    public static bool HasLoopbackListener(int port)
        => ReadListenerPids(port).Any();

    public static bool PackageMatches(string installDir)
    {
        try
        {
            var marker=Path.Combine(installDir,"agent","device-agent","goldabv2-package-profile.json");
            if (!File.Exists(marker))return false;
            using var json=JsonDocument.Parse(File.ReadAllText(marker));
            var root=json.RootElement;
            var expected=CanonicalEndpoints.Gold;
            return root.TryGetProperty("productId",out var product)&&
                product.GetString()==expected.ProductId&&
                root.TryGetProperty("configProfile",out var profile)&&
                profile.GetString()==expected.SelectedProfile&&
                root.TryGetProperty("configRevision",out var revision)&&
                revision.ValueKind==JsonValueKind.Number&&
                revision.GetInt32()>0;
        }
        catch { return false; }
    }

    public static bool IsExactInstalledRuntimePath(string? processPath,string installDir)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(processPath))return false;
            var expected=Path.GetFullPath(Path.Combine(installDir,"runtime","node.exe"));
            return string.Equals(Path.GetFullPath(processPath),expected,
                StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static bool IsExpectedWall(int port,string installDir)
    {
        if (!PackageMatches(installDir))return false;
        foreach (var pid in ReadListenerPids(port))
        {
            try
            {
                using var process=Process.GetProcessById(pid);
                if (IsExactInstalledRuntimePath(process.MainModule?.FileName,installDir) &&
                    LocalWallChallengeProof.Probe(port,pid))
                    return true;
            }
            catch { /* Inaccessible PID is unknown, never trusted. */ }
        }
        return false;
    }
}
