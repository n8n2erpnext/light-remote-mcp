namespace GptOperator.Client;

internal static class AppPaths
{
    public static readonly string Root = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    public static readonly string NodeExe = Path.Combine(Root, "runtime", "node.exe");
    public static readonly string AgentScript = Path.Combine(Root, "agent", "device-agent", "operator-agent.mjs");
    public static readonly string UpdatePublicKey = Path.Combine(Root, "config", "client-update-public.pem");
#if LIGHT_REMOTE_GOLDABV2_V4
    // QA V4 must not reuse production Gold enrollment, token or connection.json.
    public static readonly string LocalData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LightRemoteGoldABV2");
#else
    public static readonly string LocalData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GPTOperatorAgent");
#endif
    public static readonly string LogDir = Path.Combine(LocalData, "logs");
    public static readonly string UpdateDir = Path.Combine(LocalData, "updates");
    public static readonly string RollbackDir = Path.Combine(UpdateDir, "rollback");
    public static readonly string UpdateLog = Path.Combine(LogDir, "update.log");
#if LIGHT_REMOTE_GOLDABV2_V4
    public static readonly string StateFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "gpt-operator-agent-goldabv2", "device.json");
#else
    public static readonly string StateFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "gpt-operator-agent", "device.json");
#endif
    public static readonly string ConnectionFile = Path.Combine(LocalData, "connection.json");
    public static readonly string AgentLog = Path.Combine(LogDir, "agent.log");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(LogDir);
        Directory.CreateDirectory(UpdateDir);
        Directory.CreateDirectory(RollbackDir);
        Directory.CreateDirectory(Path.GetDirectoryName(StateFile)!);
    }

    public static string RollbackInstaller(string version)
        => Path.Combine(RollbackDir, $"GPT-Operator-Setup-{version}-x64.exe");
}
