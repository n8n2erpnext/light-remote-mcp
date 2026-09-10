using System.Diagnostics;
using System.Text.Json;

namespace GptOperator.Client;

internal sealed record AgentStatus(
    bool Enrolled,
    string? DeviceId,
    string? NodeId,
    string? AccountId,
    string? Version,
    string? PlatformAdapter,
    string[] EffectiveCapabilities);

internal sealed record EnrollmentInfo(string ActivationUrl, string DeviceCode, int ExpiresInSeconds);

internal sealed class AgentSupervisor : IDisposable
{
    private readonly object _gate = new();
    private Process? _daemon;
    private CancellationTokenSource? _restartCts;
    private int _restartFailures;
    private bool _disposed;

    public bool DesiredConnected { get; private set; } = true;
    public bool IsRunning { get { lock (_gate) return _daemon is { HasExited: false }; } }
    public string? LastError { get; private set; }
    public event Action? Changed;
    public async Task<AgentStatus> ReadStatusAsync(CancellationToken cancellationToken = default)
    {
        var result = await RunAgentAsync("status", cancellationToken);
        using var doc = JsonDocument.Parse(result.Stdout);
        var root = doc.RootElement;
        var caps = root.TryGetProperty("effectiveCapabilities", out var c) && c.ValueKind == JsonValueKind.Array
            ? c.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToArray()
            : Array.Empty<string>();
        return new AgentStatus(
            root.TryGetProperty("enrolled", out var e) && e.GetBoolean(),
            Text(root, "deviceId"), Text(root, "nodeId"), Text(root, "accountId"),
            Text(root, "version"), Text(root, "platformAdapter"), caps);
    }

    public async Task<EnrollmentInfo> BeginEnrollmentAsync(CancellationToken cancellationToken = default)
    {
        var result = await RunAgentAsync("login --no-wait", cancellationToken);
        var activation = LineValue(result.Stdout, "Activation URL:");
        var code = LineValue(result.Stdout, "Device code:");
        var expiresRaw = LineValue(result.Stdout, "Expires in:").TrimEnd('s');
        if (string.IsNullOrWhiteSpace(activation) || string.IsNullOrWhiteSpace(code))
            throw new InvalidOperationException("Enrollment response did not contain activation URL and device code.");
        _ = int.TryParse(expiresRaw, out var expires);
        return new EnrollmentInfo(activation, code, expires);
    }

    public async Task<bool> PollEnrollmentAsync(CancellationToken cancellationToken = default)
    {
        var result = await RunAgentAsync("poll", cancellationToken, allowFailure: true);
        if (result.ExitCode != 0) return false;
        using var doc = JsonDocument.Parse(result.Stdout);
        return doc.RootElement.TryGetProperty("state", out var state) && state.GetString() == "approved";
    }
    public async Task StartAsync()
    {
        DesiredConnected = true;
        var status = await ReadStatusAsync();
        if (!status.Enrolled) { Changed?.Invoke(); return; }
        StartDaemon();
    }

    public Task StopAsync()
    {
        DesiredConnected = false;
        _restartCts?.Cancel();
        lock (_gate)
        {
            if (_daemon is { HasExited: false })
            {
                try { _daemon.Kill(entireProcessTree: true); } catch { }
            }
            _daemon?.Dispose();
            _daemon = null;
        }
        Changed?.Invoke();
        return Task.CompletedTask;
    }

    public async Task RestartAsync()
    {
        await StopAsync();
        await Task.Delay(400);
        DesiredConnected = true;
        await StartAsync();
    }

    private void StartDaemon()
    {
        lock (_gate)
        {
            if (_disposed || !DesiredConnected || _daemon is { HasExited: false }) return;
            var psi = BaseStartInfo();
            psi.ArgumentList.Add(AppPaths.AgentScript);
            psi.ArgumentList.Add("daemon");
            var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, e) => { if (e.Data != null) AppendLog("OUT", e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) AppendLog("ERR", e.Data); };
            process.Exited += (_, _) => OnDaemonExited(process);
            if (!process.Start()) throw new InvalidOperationException("Could not start operator agent.");
            process.BeginOutputReadLine(); process.BeginErrorReadLine();
            _daemon = process; _restartFailures = 0; LastError = null;
        }
        Changed?.Invoke();
    }
    private async void OnDaemonExited(Process process)
    {
        int exitCode;
        try { exitCode = process.ExitCode; } catch { exitCode = -1; }
        AppendLog("SYS", $"agent exited code={exitCode}");
        lock (_gate)
        {
            if (ReferenceEquals(_daemon, process)) _daemon = null;
        }
        process.Dispose();
        Changed?.Invoke();
        if (!DesiredConnected || _disposed) return;
        _restartFailures++;
        var delay = TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, Math.Min(_restartFailures, 5))));
        _restartCts?.Cancel();
        _restartCts = new CancellationTokenSource();
        try
        {
            await Task.Delay(delay, _restartCts.Token);
            if (DesiredConnected && !_disposed) StartDaemon();
        }
        catch (OperationCanceledException) { }
    }

    private static ProcessStartInfo BaseStartInfo()
    {
        if (!File.Exists(AppPaths.NodeExe)) throw new FileNotFoundException("Bundled Node runtime is missing.", AppPaths.NodeExe);
        if (!File.Exists(AppPaths.AgentScript)) throw new FileNotFoundException("Bundled operator agent is missing.", AppPaths.AgentScript);
        var psi = new ProcessStartInfo(AppPaths.NodeExe) {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
        psi.Environment["OPERATOR_AGENT_STATE"] = AppPaths.StateFile;
        psi.Environment["HOME"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return psi;
    }
    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunAgentAsync(string arguments, CancellationToken cancellationToken, bool allowFailure = false)
    {
        var psi = BaseStartInfo();
        psi.ArgumentList.Add(AppPaths.AgentScript);
        foreach (var part in arguments.Split(' ', StringSplitOptions.RemoveEmptyEntries)) psi.ArgumentList.Add(part);
        using var process = new Process { StartInfo = psi };
        process.Start();
        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var stdout = await stdoutTask; var stderr = await stderrTask;
        if (!allowFailure && process.ExitCode != 0)
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? $"Agent exited {process.ExitCode}." : stderr.Trim());
        return (process.ExitCode, stdout, stderr);
    }

    private static string? Text(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string LineValue(string text, string prefix)
        => text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)
            .FirstOrDefault(line => line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))?
            .Substring(prefix.Length).Trim() ?? "";

    private static void AppendLog(string kind, string line)
    {
        try
        {
            AppPaths.EnsureDirectories();
            File.AppendAllText(AppPaths.AgentLog, $"{DateTimeOffset.UtcNow:o} [{kind}] {line}{Environment.NewLine}");
        }
        catch { }
    }

    public void Dispose()
    {
        _disposed = true; DesiredConnected = false; _restartCts?.Cancel();
        lock (_gate) { try { if (_daemon is { HasExited: false }) _daemon.Kill(true); } catch { } _daemon?.Dispose(); _daemon = null; }
        _restartCts?.Dispose();
    }
}
