using System.Runtime.InteropServices;
using System.Text;

namespace GptOperator.RealRemoteV2;

internal sealed record CursorPoint(int X, int Y);
internal sealed record ScreenInfo(int Index, int X, int Y, int Width, int Height, bool Primary);
internal sealed record ForegroundInfo(long Hwnd, string Title);
internal sealed record NativeStatus(CursorPoint Cursor, ScreenInfo[] Screens, ForegroundInfo Foreground);

internal static class NativeInput
{
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_HWHEEL = 0x1000;

    [StructLayout(LayoutKind.Sequential)] internal struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public nint dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public nint dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct HARDWAREINPUT { public uint uMsg; public ushort wParamL,wParamH; }
    [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public INPUTUNION U; }

    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(nint hwnd,StringBuilder text,int count);
    [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    public static NativeStatus ReadStatus()
    {
        _ = GetCursorPos(out var p);
        var screens = Screen.AllScreens.Select((s,i)=>new ScreenInfo(i,s.Bounds.X,s.Bounds.Y,s.Bounds.Width,s.Bounds.Height,s.Primary)).ToArray();
        return new NativeStatus(new CursorPoint(p.X,p.Y),screens,ReadForeground());
    }

    public static ForegroundInfo ReadForeground()
    {
        var hwnd=GetForegroundWindow();
        var b=new StringBuilder(512);
        if(hwnd!=0) _=GetWindowText(hwnd,b,b.Capacity);
        return new ForegroundInfo(hwnd.ToInt64(),b.ToString());
    }

    public static void Move(int x,int y)
    {
        if(!SetCursorPos(x,y)) throw new InvalidOperationException("cursor_move_failed");
    }

    public static void Click(string button="left",int count=1)
    {
        count=Math.Clamp(count,1,3);
        var flags=MouseFlags(button);
        for(var i=0;i<count;i++) SendMouse(flags.Down,flags.Up);
    }

    public static void Wheel(int delta,bool horizontal=false)
    {
        delta=Math.Clamp(delta,-2400,2400);
        if(delta==0) return;
        Send(new[]{new INPUT{
            type=INPUT_MOUSE,
            U=new INPUTUNION{mi=new MOUSEINPUT{
                mouseData=unchecked((uint)delta),
                dwFlags=horizontal?MOUSEEVENTF_HWHEEL:MOUSEEVENTF_WHEEL
            }}
        }});
    }

    public static void Drag(int fromX,int fromY,int toX,int toY,string button="left",int durationMs=250,int steps=12)
    {
        durationMs=Math.Clamp(durationMs,0,5000);
        steps=Math.Clamp(steps,2,120);
        var flags=MouseFlags(button);
        Move(fromX,fromY);
        SendMouseFlag(flags.Down);
        try
        {
            var delay=steps>0?durationMs/steps:0;
            for(var i=1;i<=steps;i++)
            {
                var t=(double)i/steps;
                Move(
                    (int)Math.Round(fromX+(toX-fromX)*t),
                    (int)Math.Round(fromY+(toY-fromY)*t)
                );
                if(delay>0) Thread.Sleep(delay);
            }
        }
        finally
        {
            SendMouseFlag(flags.Up);
        }
    }

    public static void WriteText(string text,int intervalMs=0)
    {
        if(text.Length>4096) throw new InvalidOperationException("text_too_large");
        intervalMs=Math.Clamp(intervalMs,0,100);
        foreach(var ch in text)
        {
            var down=new INPUT{type=INPUT_KEYBOARD,U=new INPUTUNION{ki=new KEYBDINPUT{wScan=ch,dwFlags=KEYEVENTF_UNICODE}}};
            var up=new INPUT{type=INPUT_KEYBOARD,U=new INPUTUNION{ki=new KEYBDINPUT{wScan=ch,dwFlags=KEYEVENTF_UNICODE|KEYEVENTF_KEYUP}}};
            Send(new[]{down,up});
            if(intervalMs>0) Thread.Sleep(intervalMs);
        }
    }

    public static void DeleteText(int count)
    {
        count=Math.Clamp(count,1,4096);
        for(var i=0;i<count;i++) PressKey("BACKSPACE");
    }

    public static void PressKey(string key)
    {
        var vk=VirtualKey(key);
        SendKey(vk,false);
        SendKey(vk,true);
    }

    public static void Hotkey(IEnumerable<string> modifiers,string key)
    {
        var mods=modifiers.Select(VirtualKey).Distinct().Take(4).ToArray();
        var keyVk=VirtualKey(key);

        if(mods.Length>0)
        {
            Send(mods.Select(vk=>KeyInput(vk,false)).ToArray());
            Thread.Sleep(10);
        }

        try
        {
            Send(new[]{KeyInput(keyVk,false),KeyInput(keyVk,true)});
            if(mods.Length>0) Thread.Sleep(10);
        }
        finally
        {
            if(mods.Length>0)
                Send(mods.Reverse().Select(vk=>KeyInput(vk,true)).ToArray());
        }
    }

    private static (uint Down,uint Up) MouseFlags(string button)
        => button.ToLowerInvariant() switch {
            "left" => (MOUSEEVENTF_LEFTDOWN,MOUSEEVENTF_LEFTUP),
            "right" => (MOUSEEVENTF_RIGHTDOWN,MOUSEEVENTF_RIGHTUP),
            "middle" => (MOUSEEVENTF_MIDDLEDOWN,MOUSEEVENTF_MIDDLEUP),
            _ => throw new InvalidOperationException("mouse_button_invalid")
        };

    private static ushort VirtualKey(string key)
    {
        var k=key.Trim().ToUpperInvariant();
        if(k.Length==1 && k[0]>='A' && k[0]<='Z') return (ushort)k[0];
        if(k.Length==1 && k[0]>='0' && k[0]<='9') return (ushort)k[0];
        if(k.StartsWith("F") && int.TryParse(k[1..],out var fn) && fn is >=1 and <=24) return (ushort)(0x70+fn-1);
        return k switch {
            "ENTER"=>0x0D,"TAB"=>0x09,"ESC"=>0x1B,"ESCAPE"=>0x1B,"BACKSPACE"=>0x08,
            "DELETE"=>0x2E,"INSERT"=>0x2D,"LEFT"=>0x25,"UP"=>0x26,"RIGHT"=>0x27,"DOWN"=>0x28,
            "HOME"=>0x24,"END"=>0x23,"PAGEUP"=>0x21,"PAGEDOWN"=>0x22,"SPACE"=>0x20,
            "CTRL"=>0x11,"CONTROL"=>0x11,"SHIFT"=>0x10,"ALT"=>0x12,"WIN"=>0x5B,"WINDOWS"=>0x5B,
            _=>throw new InvalidOperationException("key_invalid")
        };
    }

    private static INPUT KeyInput(ushort vk,bool up)
        => new INPUT{type=INPUT_KEYBOARD,U=new INPUTUNION{ki=new KEYBDINPUT{
            wVk=vk,
            dwFlags=up?KEYEVENTF_KEYUP:0
        }}};

    private static void SendKey(ushort vk,bool up)
        => Send(new[]{KeyInput(vk,up)});

    private static void SendMouse(uint down,uint up)
    {
        SendMouseFlag(down);
        SendMouseFlag(up);
    }

    private static void SendMouseFlag(uint flags,uint mouseData=0)
        => Send(new[]{new INPUT{type=INPUT_MOUSE,U=new INPUTUNION{mi=new MOUSEINPUT{
            mouseData=mouseData,
            dwFlags=flags
        }}}});

    private static void Send(INPUT[] items)
    {
        var sent=SendInput((uint)items.Length,items,Marshal.SizeOf<INPUT>());
        if(sent!=items.Length) throw new InvalidOperationException("send_input_failed");
    }
}
