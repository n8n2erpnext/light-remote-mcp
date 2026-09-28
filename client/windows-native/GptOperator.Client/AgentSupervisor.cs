using System.Diagnostics;
using System.Text.Json;
using System.Text;

namespace GptOperator.Client;

internal sealed record AgentStatus(
    bool Enrolled,
    string? DeviceId,
    string? NodeId,
    string? AccountId,
    string? Version,
    string? PlatformAdapter,
    string[] EffectiveCapabilities,
    bool CloudDesiredConnected,
    string? CloudState,
    long? HardExpiresAt,
    long? ReconnectGraceMs,
    string? ConnectionPlan,
    string? LocalWallUrl);

internal sealed record EnrollmentInfo(string ActivationUrl, string DeviceCode, int ExpiresInSeconds);

internal sealed class AgentSupervisor : IDisposable
{
    private static readonly object LogGate = new();
    private static bool _logEncodingChecked;
    private readonly object _gate = new();
    private Process? _daemon;
    private CancellationTokenSource? _restartCts;
    private int _restartFailures;
    private bool _disposed;
    private bool _serviceDesired = true;

    public bool DesiredConnected { get; private set; }
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
            Text(root, "version"), Text(root, "platformAdapter"), caps,
            root.TryGetProperty("cloudDesiredConnected", out var cd) && cd.ValueKind == JsonValueKind.True,
            Text(root, "cloudState"), Long(root, "hardExpiresAt"), Long(root, "reconnectGraceMs"), Text(root, "connectionPlan"), Text(root, "localWallUrl"));
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
    public async Task EnsureServiceAsync()
    {
        _serviceDesired = true;
        var status = await ReadStatusAsync();
        DesiredConnected = status.CloudDesiredConnected;
        if (status.Enrolled) StartDaemon();
        Changed?.Invoke();
    }

    public async Task StartAsync()
    {
        _serviceDesired = true;
        var status = await ReadStatusAsync();
        if (!status.Enrolled) { DesiredConnected = false; Changed?.Invoke(); return; }
        StartDaemon();
        var result = await RunAgentAsync("connect", CancellationToken.None, allowFailure: true);
        if (result.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(result.Stderr) ? "Could not create Light Remote cloud connection." : result.Stderr.Trim());
        DesiredConnected = true;
        Changed?.Invoke();
    }

    public async Task StopAsync()
    {
        var status = await ReadStatusAsync();
        if (status.Enrolled) await RunAgentAsync("disconnect", CancellationToken.None, allowFailure: true);
        DesiredConnected = false;
        Changed?.Invoke();
    }

    public Task StopServiceAsync()
    {
        _serviceDesired = false;
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
        await StopServiceAsync();
        await Task.Delay(400);
        _serviceDesired = true;
        await EnsureServiceAsync();
    }

    private void StartDaemon()
    {
        lock (_gate)
        {
            if (_disposed || !_serviceDesired || _daemon is { HasExited: false }) return;
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
        if (!_serviceDesired || _disposed) return;
        _restartFailures++;
        var delay = TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, Math.Min(_restartFailures, 5))));
        _restartCts?.Cancel();
        _restartCts = new CancellationTokenSource();
        try
        {
            await Task.Delay(delay, _restartCts.Token);
            if (_serviceDesired && !_disposed) StartDaemon();
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
        var connection = ConnectionConfig.Load();
        psi.Environment["OPERATOR_AGENT_BASE_URL"] = connection.BridgeUrl;
        psi.Environment["OPERATOR_AGENT_HUB_URL"] = connection.HubUrl;
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

    private static long? Long(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var result) ? result : null;

    private static string LineValue(string text, string prefix)
        => text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)
            .FirstOrDefault(line => line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))?
            .Substring(prefix.Length).Trim() ?? "";

    private static void AppendLog(string kind, string line)
    {
        try
        {
            AppPaths.EnsureDirectories();
            lock (LogGate)
            {
                EnsureUtf8LogFile();
                File.AppendAllText(
                    AppPaths.AgentLog,
                    $"{DateTimeOffset.UtcNow:o} [{kind}] {line}{Environment.NewLine}",
                    new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            }
        }
        catch { }
    }

    private static void EnsureUtf8LogFile()
    {
        if (_logEncodingChecked) return;
        _logEncodingChecked = true;
        if (!File.Exists(AppPaths.AgentLog)) return;

        var bytes = File.ReadAllBytes(AppPaths.AgentLog);
        var utf16Bom = bytes.Length >= 2 &&
            ((bytes[0] == 0xFF && bytes[1] == 0xFE) || (bytes[0] == 0xFE && bytes[1] == 0xFF));
        var validUtf8 = true;
        if (!utf16Bom)
        {
            try { _ = new UTF8Encoding(false, true).GetString(bytes); }
            catch (DecoderFallbackException) { validUtf8 = false; }
        }

        if (!utf16Bom && validUtf8) return;
        var legacy = Path.Combine(
            AppPaths.LogDir,
            $"agent.legacy-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.log");
        File.Move(AppPaths.AgentLog, legacy, overwrite: true);
        File.WriteAllText(AppPaths.AgentLog, string.Empty, new UTF8Encoding(false));
    }

    public void Dispose()
    {
        _disposed = true; _serviceDesired = false; DesiredConnected = false; _restartCts?.Cancel();
        lock (_gate) { try { if (_daemon is { HasExited: false }) _daemon.Kill(true); } catch { } _daemon?.Dispose(); _daemon = null; }
        _restartCts?.Dispose();
    }
}
