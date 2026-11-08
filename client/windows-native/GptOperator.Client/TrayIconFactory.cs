using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Reflection;

namespace GptOperator.Client;

internal enum TrayVisualState
{
    Stopped,
    Unlinked,
    Disconnected,
    Dormant,
    Connected
}

internal static class TrayIconFactory
{
    public static Icon Create(TrayVisualState visual)
    {
        // Render the exact Moryqa/Figma state-specific vector export (rasterized
        // to 32px with librsvg for crisp Windows tray appearance). Do not overlay
        // another status dot: the Figma artwork already encodes that state.
        var name = "LightRemoteTray." + visual.ToString().ToLowerInvariant() + ".png";
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (stream is null)
            throw new InvalidOperationException("Missing Figma tray state resource: " + name);
        using var bitmap = new Bitmap(stream);
        var handle = bitmap.GetHicon();
        try
        {
            using var temp = Icon.FromHandle(handle);
            return (Icon)temp.Clone();
        }
        finally { _ = DestroyIcon(handle); }
    }

    internal static bool SelfTest()
    {
        foreach (var state in Enum.GetValues<TrayVisualState>())
        {
            using var icon = Create(state);
            if (icon.Handle == IntPtr.Zero) return false;
        }
        return true;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);
}
