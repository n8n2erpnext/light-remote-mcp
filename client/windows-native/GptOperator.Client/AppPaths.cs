namespace GptOperator.Client;

internal static class AppPaths
{
    public static readonly string Root = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    public static readonly string NodeExe = Path.Combine(Root, "runtime", "node.exe");
    public static readonly string AgentScript = Path.Combine(Root, "agent", "device-agent", "operator-agent.mjs");
    public static readonly string UpdatePublicKey = Path.Combine(Root, "config", "client-update-public.pem");
    public static readonly string LocalData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GPTOperatorAgent");
    public static readonly string LogDir = Path.Combine(LocalData, "logs");
    public static readonly string UpdateDir = Path.Combine(LocalData, "updates");
    public static readonly string StateFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "gpt-operator-agent", "device.json");
    public static readonly string AgentLog = Path.Combine(LogDir, "agent.log");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(LogDir);
        Directory.CreateDirectory(UpdateDir);
        Directory.CreateDirectory(Path.GetDirectoryName(StateFile)!);
    }
}
