using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace GptOperator.Client;

// These are in-process native entry points. No managed Main, bridge process,
// HTTP listener, renderer-selected path or Owner credential is involved.
public static class EmbeddedHostExports
{
    private const int MaximumRequestBytes = 256 * 1024;
    private const int MaximumResponseBytes = 8192;

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int Run(IntPtr request, int length, IntPtr response)
    {
        try
        {
            if (response == IntPtr.Zero) return 125;
            Marshal.WriteIntPtr(response, IntPtr.Zero);
            if (request == IntPtr.Zero || length <= 0 || length > MaximumRequestBytes) return 125;
            var bytes = new byte[length];
            Marshal.Copy(request, bytes, 0, length);
            var args = JsonSerializer.Deserialize<string[]>(bytes);
            if (args is null || args.Length == 0 || args.Any(a => a is null)) return 125;
            switch (args[0])
            {
                case "--managed-process":
                    return ManagedProcessEnvelope.Run(args.Skip(1).ToArray());
                case "--agent-host" when args.Length == 1:
                    return AgentHost.Run();
                case "--stop-agent-host" when args.Length == 1:
                    return OwnedAgentHostStopper.Stop();
                case "--boot-evidence-self-test" when args.Length == 2:
                    return WindowsBootEvidence.SelfTest(args[1]) ? 0 : 1;
                case "--wall-listener-self-test-output" when args.Length == 2:
                    return Program.WallListenerSelfTest(args[1]) ? 0 : 1;
                case "--self-test-output" when args.Length == 2:
                    AppPaths.EnsureDirectories();
                    return Program.RunSelfTestAsync(args[1]).GetAwaiter().GetResult() ? 0 : 1;
                case "--desktop-bridge" when args.Length == 2:
                    return ReturnJson(TrayApplicationContext.DesktopBridgeJsonAsync(args[1]).GetAwaiter().GetResult(), response);
                case "--open-wall" when args.Length == 1:
                    return ReturnJson(TrayApplicationContext.DesktopBridgeJsonAsync("open-wall").GetAwaiter().GetResult(), response);
                case "--host-component-self-test-output" when args.Length == 2:
                {
                    var value = new
                    {
                        ok = typeof(EmbeddedHostExports).Assembly.EntryPoint is null
                            && File.Exists(AppPaths.NodeExe) && File.Exists(AppPaths.AgentScript)
                            && AgentHost.SelfTestRestartPolicy() && AgentHost.SelfTestDesktopOwnerAbv2Environment()
                            && Path.GetFullPath(typeof(object).Assembly.Location).StartsWith(
                                Path.Combine(AppPaths.Root, "windows-host", "runtime") + Path.DirectorySeparatorChar,
                                StringComparison.OrdinalIgnoreCase),
                        runtime = "in-process-managed-component",
                        assemblyHasNoEntryPoint = typeof(EmbeddedHostExports).Assembly.EntryPoint is null,
                        process = Environment.ProcessPath,
                        installRoot = AppPaths.Root,
                        managedProcessHelper = AppPaths.CoreExecutable,
                        node = AppPaths.NodeExe,
                        profile = LightRemote.Configuration.CanonicalEndpoints.Gold.SelectedProfile,
                        clrVersion = Environment.Version.ToString()
                        ,runtimeCoreLibrary = typeof(object).Assembly.Location
                    };
                    File.WriteAllText(args[1], JsonSerializer.Serialize(value));
                    return value.ok ? 0 : 1;
                }
                default:
                    return 2;
            }
        }
        catch
        {
            // Exception details can contain local state/arguments. Keep the
            // ABI failure opaque and let the owned caller report its phase.
            return 126;
        }
    }

    private static int ReturnJson(string json, IntPtr response)
    {
        if (Encoding.UTF8.GetByteCount(json) > MaximumResponseBytes) return 126;
        Marshal.WriteIntPtr(response, Marshal.StringToCoTaskMemUTF8(json));
        return 0;
    }

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    public static void Free(IntPtr memory)
    {
        if (memory != IntPtr.Zero) Marshal.FreeCoTaskMem(memory);
    }
}
