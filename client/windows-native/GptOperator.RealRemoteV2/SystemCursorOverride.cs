using System.Runtime.InteropServices;

namespace GptOperator.RealRemoteV2;

internal static class SystemCursorOverride
{
    private const uint SPI_SETCURSORS = 0x0057;

    private const uint OCR_NORMAL = 32512;
    private const uint OCR_IBEAM = 32513;
    private const uint OCR_WAIT = 32514;
    private const uint OCR_CROSS = 32515;
    private const uint OCR_UP = 32516;
    private const uint OCR_SIZENWSE = 32642;
    private const uint OCR_SIZENESW = 32643;
    private const uint OCR_SIZEWE = 32644;
    private const uint OCR_SIZENS = 32645;
    private const uint OCR_SIZEALL = 32646;
    private const uint OCR_NO = 32648;
    private const uint OCR_HAND = 32649;
    private const uint OCR_APPSTARTING = 32650;
    private const uint OCR_HELP = 32651;

    private static readonly uint[] CursorIds =
    {
        OCR_NORMAL,
        OCR_IBEAM,
        OCR_WAIT,
        OCR_CROSS,
        OCR_UP,
        OCR_SIZENWSE,
        OCR_SIZENESW,
        OCR_SIZEWE,
        OCR_SIZENS,
        OCR_SIZEALL,
        OCR_NO,
        OCR_HAND,
        OCR_APPSTARTING,
        OCR_HELP
    };

    private static readonly object Sync = new();
    private static int _leases;
    private static bool _installed;

    public static bool IsActive
    {
        get
        {
            lock (Sync) return _installed;
        }
    }

    public static void Acquire()
    {
        lock (Sync)
        {
            _leases++;
            if (_installed) return;

            try
            {
                // Recover from any stale override left by an older helper before
                // installing this helper's blank cursor set.
                RestoreCore();

                foreach (var cursorId in CursorIds)
                {
                    var blank = CreateBlankCursor();
                    if (blank == IntPtr.Zero)
                        throw new InvalidOperationException("blank_cursor_create_failed");

                    if (!SetSystemCursor(blank, cursorId))
                    {
                        _ = DestroyCursor(blank);
                        throw new InvalidOperationException(
                            $"blank_cursor_install_failed:{cursorId}:{Marshal.GetLastWin32Error()}"
                        );
                    }
                    // SetSystemCursor owns and destroys the supplied cursor handle on success.
                }

                _installed = true;
            }
            catch
            {
                _leases = 0;
                _installed = false;
                RestoreCore();
                throw;
            }
        }
    }

    public static void Release()
    {
        lock (Sync)
        {
            if (_leases > 0) _leases--;
            if (_leases > 0) return;
            if (!_installed) return;

            RestoreCore();
            _installed = false;
        }
    }

    public static void ForceRestore()
    {
        lock (Sync)
        {
            _leases = 0;
            RestoreCore();
            _installed = false;
        }
    }

    internal static bool SelfTest()
    {
        if (CursorIds.Length < 10) return false;
        if (CursorIds.Distinct().Count() != CursorIds.Length) return false;

        var (andMask, xorMask) = BuildBlankMasks(32, 32);
        return andMask.Length == 128
            && xorMask.Length == 128
            && andMask.All(value => value == 0xFF)
            && xorMask.All(value => value == 0x00);
    }

    private static void RestoreCore()
    {
        _ = SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0);
    }

    private static IntPtr CreateBlankCursor()
    {
        const int width = 32;
        const int height = 32;
        var (andMask, xorMask) = BuildBlankMasks(width, height);
        return CreateCursor(
            IntPtr.Zero,
            0,
            0,
            width,
            height,
            andMask,
            xorMask
        );
    }

    private static (byte[] AndMask, byte[] XorMask) BuildBlankMasks(int width, int height)
    {
        var bytes = checked((width * height) / 8);
        var andMask = Enumerable.Repeat((byte)0xFF, bytes).ToArray();
        var xorMask = new byte[bytes];
        return (andMask, xorMask);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreateCursor(
        IntPtr hInst,
        int xHotSpot,
        int yHotSpot,
        int nWidth,
        int nHeight,
        byte[] pvANDPlane,
        byte[] pvXORPlane
    );

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetSystemCursor(IntPtr hcur, uint id);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyCursor(IntPtr hCursor);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(
        uint uiAction,
        uint uiParam,
        IntPtr pvParam,
        uint fWinIni
    );
}
