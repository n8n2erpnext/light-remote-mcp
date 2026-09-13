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

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(ConfigDir);
        Directory.CreateDirectory(CacheDir);
        Directory.CreateDirectory(RollbackDir);
        Directory.CreateDirectory(LogDir);
    }

    public static string RollbackInstaller(string version)
        => Path.Combine(RollbackDir, $"Light-Remote-MCP-Setup-{version}-x64.exe");
}
