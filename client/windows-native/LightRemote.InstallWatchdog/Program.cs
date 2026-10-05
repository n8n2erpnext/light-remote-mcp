using System.Diagnostics;
using System.Net;
using System.Security.Principal;
using System.Text;

static class Program
{
    static int Main(string[] args)
    {
        var opt = Parse(args);
        var logPath = Require(opt, "log-path");
        if (opt.ContainsKey("register"))
        {
            try
            {
                return Register(opt, logPath);
            }
            catch (Exception ex)
            {
                Log(logPath, "watchdog_register_failed " + ex.Message);
                return 31;
            }
        }

        try
        {
            return Run(opt, logPath);
        }
        catch (Exception ex)
        {
            Log(logPath, "watchdog_failed " + ex.Message);
            return 32;
        }
        finally
        {
            TryRun("schtasks.exe", $"/Delete /TN \"{Get(opt, "watchdog-task", "LightRemoteInstallWatchdog")}\" /F", wait: true);
        }
    }

    static int Register(Dictionary<string, string> opt, string logPath)
    {
        var exe = Environment.ProcessPath ?? throw new InvalidOperationException("watchdog_executable_path_missing");
        var task = Get(opt, "watchdog-task", "LightRemoteInstallWatchdog");
        var childArgs = new List<string>();
        foreach (var key in new[] { "installer-pid", "commit-marker", "task-xml", "version-file", "install-root", "log-path", "task-name", "watchdog-task" })
        {
            var value = key == "task-name" ? Get(opt, key, "LightRemoteDeviceAgent") :
                        key == "watchdog-task" ? task : Require(opt, key);
            childArgs.Add("--" + key);
            childArgs.Add(Quote(value));
        }

        var actionArgs = string.Join(" ", childArgs);
        var taskXml = Path.Combine(Path.GetDirectoryName(logPath)!, "watchdog-task.xml");
        var sid = WindowsIdentity.GetCurrent().User?.Value
            ?? throw new InvalidOperationException("watchdog_user_sid_missing");
        var startBoundary = DateTimeOffset.Now.AddHours(1).ToString("yyyy-MM-dd'T'HH:mm:ss");
        var xml = $"""
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Light Remote installer transaction watchdog</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>{WebUtility.HtmlEncode(startBoundary)}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{WebUtility.HtmlEncode(sid)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{WebUtility.HtmlEncode(exe)}</Command>
      <Arguments>{WebUtility.HtmlEncode(actionArgs)}</Arguments>
    </Exec>
  </Actions>
</Task>
""";
        File.WriteAllText(taskXml, xml, Encoding.Unicode);

        var create = RunProcessArgs(
            "schtasks.exe",
            ["/Create", "/TN", task, "/XML", taskXml, "/F"],
            wait: true,
            timeoutMs: 30000);
        if (create != 0)
            throw new InvalidOperationException("watchdog_task_create_failed:" + create);

        var run = RunProcessArgs(
            "schtasks.exe",
            ["/Run", "/TN", task],
            wait: true,
            timeoutMs: 30000);
        if (run != 0)
            throw new InvalidOperationException("watchdog_task_start_failed:" + run);

        Log(logPath, $"watchdog_registered installerPid={Require(opt, "installer-pid")}");
        return 0;
    }

    static int Run(Dictionary<string, string> opt, string logPath)
    {
        var installerPid = int.Parse(Require(opt, "installer-pid"));
        var commitMarker = Require(opt, "commit-marker");
        var taskXml = Require(opt, "task-xml");
        var versionFile = Require(opt, "version-file");
        var taskName = Get(opt, "task-name", "LightRemoteDeviceAgent");

        Log(logPath, $"watchdog_started installerPid={installerPid}");
        var deadline = DateTimeOffset.UtcNow.AddMinutes(5);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (File.Exists(commitMarker))
            {
                Log(logPath, "commit_observed");
                return 0;
            }

            if (!ProcessAlive(installerPid))
                break;

            Thread.Sleep(250);
        }

        if (File.Exists(commitMarker))
        {
            Log(logPath, "commit_observed_after_exit");
            return 0;
        }

        Log(logPath, "recovery_begin");
        var version = File.Exists(versionFile) ? File.ReadAllText(versionFile).Trim() : string.Empty;
        var rollbackRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Light Remote", "Updater", "rollback");

        string? rollback = null;
        if (Directory.Exists(rollbackRoot) && !string.IsNullOrWhiteSpace(version))
        {
            rollback = new DirectoryInfo(rollbackRoot)
                .GetFiles($"Light-Remote-MCP-Setup-{version}*-x64.exe")
                .OrderByDescending(x => x.LastWriteTimeUtc)
                .Select(x => x.FullName)
                .FirstOrDefault();
        }

        if (!string.IsNullOrWhiteSpace(rollback))
        {
            Log(logPath, "rollback_begin " + rollback);
            TryRun("schtasks.exe", $"/End /TN \"{taskName}\"", wait: true);
            var rollbackExit = RunProcess(
                rollback!,
                "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-",
                wait: true,
                timeoutMs: 180000);
            Log(logPath, "rollback_exit " + rollbackExit);
        }
        else
        {
            Log(logPath, "rollback_missing version=" + version);
        }

        if (File.Exists(taskXml))
        {
            var create = TryRun("schtasks.exe", $"/Create /TN \"{taskName}\" /XML \"{taskXml}\" /F", wait: true);
            Log(logPath, "task_restore_exit " + create);
        }

        var run = TryRun("schtasks.exe", $"/Run /TN \"{taskName}\"", wait: true);
        Log(logPath, "task_restart_exit " + run);

        if (WaitWall(TimeSpan.FromSeconds(20)))
        {
            Log(logPath, "rollback_restore_wall_healthy");
            return 0;
        }

        throw new InvalidOperationException("rollback_restore_wall_failed");
    }

    static bool ProcessAlive(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return !p.HasExited;
        }
        catch
        {
            return false;
        }
    }

    static bool WaitWall(TimeSpan timeout)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTimeOffset.UtcNow + timeout;
        var stable = 0;
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                using var res = client.GetAsync("http://127.0.0.1:5491/").GetAwaiter().GetResult();
                stable = res.StatusCode == HttpStatusCode.OK ? stable + 1 : 0;
            }
            catch
            {
                stable = 0;
            }

            if (stable >= 2)
                return true;

            Thread.Sleep(300);
        }

        return false;
    }

    static int TryRun(string file, string arguments, bool wait)
    {
        try
        {
            return RunProcess(file, arguments, wait, 30000);
        }
        catch
        {
            return -1;
        }
    }

    static int RunProcess(string file, string arguments, bool wait, int timeoutMs)
    {
        using var p = Process.Start(new ProcessStartInfo
        {
            FileName = file,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        }) ?? throw new InvalidOperationException("process_start_failed:" + file);

        if (!wait)
            return 0;

        if (!p.WaitForExit(timeoutMs))
        {
            try { p.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException("process_timeout:" + file);
        }

        return p.ExitCode;
    }

    static int RunProcessArgs(string file, IEnumerable<string> arguments, bool wait, int timeoutMs)
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        foreach (var argument in arguments)
            psi.ArgumentList.Add(argument);

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("process_start_failed:" + file);
        if (!wait)
            return 0;

        if (!p.WaitForExit(timeoutMs))
        {
            try { p.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException("process_timeout:" + file);
        }

        return p.ExitCode;
    }

    static Dictionary<string, string> Parse(string[] args)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < args.Length; i++)
        {
            var key = args[i];
            if (!key.StartsWith("--", StringComparison.Ordinal))
                continue;
            key = key[2..];
            if (i + 1 >= args.Length || args[i + 1].StartsWith("--", StringComparison.Ordinal))
            {
                result[key] = "true";
                continue;
            }
            result[key] = args[++i];
        }
        return result;
    }

    static string Quote(string value)
        => "\"" + value.Replace("\"", "\\\"") + "\"";

    static string EscapeForTask(string value)
        => value.Replace("\"", "\\\"");

    static string Require(Dictionary<string, string> opt, string key)
        => opt.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new ArgumentException("missing_required:" + key);

    static string Get(Dictionary<string, string> opt, string key, string fallback)
        => opt.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : fallback;

    static void Log(string path, string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.AppendAllText(path, $"[{DateTimeOffset.Now:O}] {message}{Environment.NewLine}");
        }
        catch { }
    }
}
