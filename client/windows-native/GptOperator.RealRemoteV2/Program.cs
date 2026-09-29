using System.IO;
using System.Text.Json;

namespace GptOperator.RealRemoteV2;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var selfTest = Array.IndexOf(args, "--self-test-output");
        if (selfTest >= 0 && selfTest + 1 < args.Length)
        {
            Environment.ExitCode = RunSelfTest(args[selfTest + 1]) ? 0 : 1;
            return;
        }

        var pipeIndex = Array.IndexOf(args, "--pipe");
        if (pipeIndex < 0 || pipeIndex + 1 >= args.Length)
        {
            Environment.ExitCode = 2;
            return;
        }

        var pipeName = args[pipeIndex + 1];
        if (!RobotRpcServer.IsValidPipeName(pipeName))
        {
            Environment.ExitCode = 2;
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new RobotContext(pipeName));
    }

    private static bool RunSelfTest(string output)
    {
        try
        {
            var status = NativeInput.ReadStatus();
            var result = new
            {
                ok = true,
                interactiveDesktopAvailable = status.Screens.Length > 0,
                runtime = "real-remote-v2-companion",
                processId = Environment.ProcessId,
                screens = status.Screens.Length,
                cursor = status.Cursor,
                foreground = status.Foreground
            };
            File.WriteAllText(output, JsonSerializer.Serialize(result));
            return result.ok;
        }
        catch (Exception ex)
        {
            File.WriteAllText(output, JsonSerializer.Serialize(new { ok = false, error = ex.Message }));
            return false;
        }
    }
}
