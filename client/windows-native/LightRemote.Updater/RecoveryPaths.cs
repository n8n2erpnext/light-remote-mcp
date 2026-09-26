namespace LightRemote.Updater;

internal static class RecoveryPaths
{
    public static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Light Remote", "Updater");
    public static readonly string ConfigDir = Path.Combine(Root, "config");
    public static string UpdatePublicKey { get { var adjacent=Path.Combine(AppContext.BaseDirectory,"config","client-update-public.pem"); return File.Exists(adjacent)?adjacent:Path.Combine(ConfigDir,"client-update-public.pem"); } }
    public static readonly string CacheDir = Path.Combine(Root, "cache");
    public static readonly string RollbackDir = Path.Combine(Root, "rollback");
    public static readonly string LogDir = Path.Combine(Root, "logs");
    public static readonly string UpdateLog = Path.Combine(LogDir, "update.log");
    public static readonly string StateDir = Path.Combine(Root, "state");
    public static readonly string StatusFile = Path.Combine(StateDir, "status.json");
    public static readonly string ReportFile = Path.Combine(StateDir, "pending-report.json");
    public static readonly string TransactionFile = Path.Combine(StateDir, "transaction.json");
    public static readonly string AckFile = Path.Combine(StateDir, "core-health-ack.json");

    public static string HelperVersion()
    {
        foreach(var file in new[]{Path.Combine(AppContext.BaseDirectory,"VERSION"),Path.Combine(Root,"VERSION")})
        {
            try { if(File.Exists(file)){var value=File.ReadAllText(file).Trim();if(!string.IsNullOrWhiteSpace(value))return value;} } catch {}
        }
        return "unknown";
    }

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(ConfigDir);
        Directory.CreateDirectory(CacheDir);
        Directory.CreateDirectory(RollbackDir);
        Directory.CreateDirectory(LogDir);
        Directory.CreateDirectory(StateDir);
    }

    public static string RollbackInstaller(string version)
        => Path.Combine(RollbackDir, $"Light-Remote-Setup-{version}-x64.exe");

    public static string LegacyRollbackInstaller(string version)
        => Path.Combine(RollbackDir, $"Light-Remote-MCP-Setup-{version}-x64.exe");

    public static string? ResolveRollbackInstaller(string version)
    {
        foreach(var candidate in new[]{RollbackInstaller(version),LegacyRollbackInstaller(version)})
            if(File.Exists(candidate))return candidate;
        return null;
    }
}
