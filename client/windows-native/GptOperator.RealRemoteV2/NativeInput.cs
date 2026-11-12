using System.Runtime.InteropServices;
using System.Text;

namespace GptOperator.RealRemoteV2;

internal sealed record CursorPoint(int X, int Y);
internal sealed record ScreenInfo(int Index, int X, int Y, int Width, int Height, bool Primary);
internal sealed record ForegroundInfo(long Hwnd, string Title);
internal sealed record NativeStatus(CursorPoint Cursor, ScreenInfo[] Screens, ForegroundInfo Foreground);

internal static class NativeInput
{
    internal static ControlActivity? Activity;
    private static readonly object OwnedGate=new();
    private static readonly Dictionary<string,INPUT> OwnedUps=new();
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const uint KEYEVENTF_SCANCODE = 0x0008;
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
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(nint hwnd,StringBuilder text,int count);
    [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
    [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint code,uint mapType);

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

    public static void Move(int x,int y,int durationMs=90,int steps=8)
    {
        durationMs=Math.Clamp(durationMs,0,500);
        steps=Math.Clamp(steps,1,32);
        if(durationMs==0 || steps==1 || !GetCursorPos(out var start))
        {
            MoveImmediate(x,y);
            return;
        }

        // Actual Win32 cursor positions, NOT UIA/DOM actions. Pace by an
        // absolute monotonic clock instead of accumulating Thread.Sleep()
        // rounding (10-16ms timer quantum on some Windows installations).
        var distance=Math.Sqrt(Math.Pow(x-start.X,2)+Math.Pow(y-start.Y,2));
        var frameCount=Math.Clamp(Math.Max(steps,(int)Math.Ceiling(distance/36d)),steps,32);
        var clock=System.Diagnostics.Stopwatch.StartNew();
        for(var i=1;i<=frameCount;i++)
        {
            var deadlineMs=durationMs*(double)i/frameCount;
            while(clock.Elapsed.TotalMilliseconds<deadlineMs)
            {
                var remaining=deadlineMs-clock.Elapsed.TotalMilliseconds;
                // Owner interruption must not wait for a whole sparse-motion frame.
                if(remaining>=3d) Thread.Sleep(Math.Clamp((int)remaining-1,1,8));
                else Thread.Yield();
                Activity?.Check();
            }
            var point=SmoothPoint(start.X,start.Y,x,y,i,frameCount);
            MoveImmediate(point.X,point.Y);
        }
    }

    private static CursorPoint SmoothPoint(int fromX,int fromY,int toX,int toY,int step,int steps)
    {
        var t=Math.Clamp((double)step/Math.Max(1,steps),0d,1d);
        var eased=1d-Math.Pow(1d-t,3d);
        return new CursorPoint(
            (int)Math.Round(fromX+(toX-fromX)*eased),
            (int)Math.Round(fromY+(toY-fromY)*eased)
        );
    }

    internal static int AbsoluteCoordinate(int pixel,int origin,int length)
        => (int)Math.Clamp(((long)(pixel-origin)*65536+32768)/Math.Max(1,length),0,65535);

    private static void MoveImmediate(int x,int y)
    {
        var bounds=SystemInformation.VirtualScreen;
        Send(new[]{new INPUT{type=INPUT_MOUSE,U=new INPUTUNION{mi=new MOUSEINPUT{
            dx=AbsoluteCoordinate(x,bounds.X,bounds.Width),dy=AbsoluteCoordinate(y,bounds.Y,bounds.Height),
            dwFlags=0x0001|0x8000|0x4000, dwExtraInfo=ControlActivity.InputMarker
        }}}});
    }

    internal static bool SmoothMoveMathSelfTest()
    {
        foreach(var width in new[]{1920,3840,7680})
            for(var pixel=0;pixel<width;pixel++)
                if((long)AbsoluteCoordinate(pixel-1920,-1920,width)*width/65536!=pixel)return false;
        var first=SmoothPoint(0,0,100,50,1,4);
        var last=SmoothPoint(0,0,100,50,4,4);
        return first.X>0 && first.X<100 && first.Y>0 && first.Y<50 && last==new CursorPoint(100,50);
    }

    public static void Click(string button="left",int count=1,InteractionProfile? profile=null)
    {
        profile??=InteractionProfile.Read("compatibility");
        count=Math.Clamp(count,1,3);
        var flags=MouseFlags(button);
        // Paint ribbon menus need the pointer hover to settle before down.
        // A zero-time SendInput down/up burst was intermittently interpreted
        // as hover only even though the RPC reported applied=true.
        if(profile.Name=="responsive")InterruptibleDelay(profile.HoverMs);else InterruptibleDelay(35);
        for(var i=0;i<count;i++)
        {
            SendMouseFlag(flags.Down);
            if(profile.Name=="responsive")InterruptibleDelay(profile.DownMs);else InterruptibleDelay(40);
            ReleaseOwnedInputs();
            if(i<count-1) InterruptibleDelay(profile.DoubleGapMs);
        }
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
        steps=Math.Clamp(steps,1,120);
        var flags=MouseFlags(button);
        MoveImmediate(fromX,fromY);
        SendMouseFlag(flags.Down);
        try
        {
            var delay=steps>0?durationMs/steps:0;
            for(var i=1;i<=steps;i++)
            {
                var t=(double)i/steps;
                MoveImmediate(
                    (int)Math.Round(fromX+(toX-fromX)*t),
                    (int)Math.Round(fromY+(toY-fromY)*t)
                );
                if(delay>0) InterruptibleDelay(delay);
            }
        }
        finally
        {
            ReleaseOwnedInputs();
        }
    }

    public static void WriteText(string text,int intervalMs=0)
    {
        if(text.Length>4096) throw new InvalidOperationException("text_too_large");
        intervalMs=Math.Clamp(intervalMs,0,100);
        var sent=0;
        try { foreach(var ch in text)
        {
            var down=new INPUT{type=INPUT_KEYBOARD,U=new INPUTUNION{ki=new KEYBDINPUT{wScan=ch,dwFlags=KEYEVENTF_UNICODE}}};
            var up=new INPUT{type=INPUT_KEYBOARD,U=new INPUTUNION{ki=new KEYBDINPUT{wScan=ch,dwFlags=KEYEVENTF_UNICODE|KEYEVENTF_KEYUP}}};
            Send(new[]{down,up}); sent++;
            if(intervalMs>0) InterruptibleDelay(intervalMs);
        }} catch(OwnerInputPause pause) { pause.RequestedUnits=text.Length; pause.SentUnits=sent; throw; }
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

        foreach(var vk in mods)
        {
            ChordKey(vk,false);
            InterruptibleDelay(10);
        }

        try
        {
            ChordKey(keyVk,false);
            InterruptibleDelay(15);
            ChordKey(keyVk,true);
            InterruptibleDelay(10);
        }
        finally { ReleaseOwnedInputs(); }
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

    private static void ChordKey(ushort vk,bool up)
    {
        const uint MAPVK_VK_TO_VSC_EX=4;
        var mapped=MapVirtualKey(vk,MAPVK_VK_TO_VSC_EX);
        if(mapped==0) throw new InvalidOperationException("hotkey_scan_invalid");
        var flags=KEYEVENTF_SCANCODE | (up?KEYEVENTF_KEYUP:0u);
        if((mapped&0xFF00u)!=0) flags|=KEYEVENTF_EXTENDEDKEY;
        Send(new[]{new INPUT{
            type=INPUT_KEYBOARD,
            U=new INPUTUNION{ki=new KEYBDINPUT{
                wVk=0,
                wScan=(ushort)(mapped&0xFFu),
                dwFlags=flags
            }}
        }});
    }

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

    internal static void InterruptibleDelay(int milliseconds)
    {
        var until=Environment.TickCount64+milliseconds;
        do { Activity?.Check(); var remaining=until-Environment.TickCount64;
            if(remaining<=0)return; Thread.Sleep((int)Math.Min(remaining,8));
        } while(true);
    }

    private static (string Id,INPUT Up,int Key)? ReleaseFor(INPUT input)
    {
        if(input.type==INPUT_MOUSE) {
            var flags=input.U.mi.dwFlags;
            var up=flags switch { MOUSEEVENTF_LEFTDOWN=>MOUSEEVENTF_LEFTUP,MOUSEEVENTF_RIGHTDOWN=>MOUSEEVENTF_RIGHTUP,MOUSEEVENTF_MIDDLEDOWN=>MOUSEEVENTF_MIDDLEUP,_=>0u };
            if(up==0)return null;
            input.U.mi.dwFlags=up;
            return ("mouse:"+up,input,up==MOUSEEVENTF_LEFTUP?1:up==MOUSEEVENTF_RIGHTUP?2:4);
        }
        if(input.type!=INPUT_KEYBOARD || (input.U.ki.dwFlags&KEYEVENTF_KEYUP)!=0)return null;
        var key=input.U.ki;
        input.U.ki.dwFlags|=KEYEVENTF_KEYUP;
        var vk=key.wVk!=0?key.wVk:(key.dwFlags&KEYEVENTF_UNICODE)!=0?0:
            (int)MapVirtualKey((uint)(key.wScan|((key.dwFlags&KEYEVENTF_EXTENDEDKEY)!=0?0xE000:0)),3);
        return ($"key:{key.wVk}:{key.wScan}:{key.dwFlags}",input,vk);
    }

    private static void Send(INPUT[] items)
    {
        Activity?.Check();
        for(var i=0;i<items.Length;i++) {
            if(items[i].type==INPUT_MOUSE)items[i].U.mi.dwExtraInfo=ControlActivity.InputMarker;
            else if(items[i].type==INPUT_KEYBOARD)items[i].U.ki.dwExtraInfo=ControlActivity.InputMarker;
        }
        lock(OwnedGate) {
            foreach(var item in items) {
                var release=ReleaseFor(item);
                if(release is {} row && row.Key!=0 && (GetAsyncKeyState(row.Key)&0x8000)!=0 && !OwnedUps.ContainsKey(row.Id))
                    throw new InvalidOperationException("input_key_or_button_already_held_locally");
            }
            var sent=SendInput((uint)items.Length,items,Marshal.SizeOf<INPUT>());
            for(var i=0;i<sent;i++) {
                var release=ReleaseFor(items[i]);
                if(release is {} row)OwnedUps[row.Id]=row.Up;
                else {
                    var current=items[i];
                    foreach(var id in OwnedUps.Where(pair=>SameRelease(pair.Value,current)).Select(pair=>pair.Key).ToArray())OwnedUps.Remove(id);
                }
            }
            if(sent!=items.Length) { ReleaseOwnedInputs(); throw new InvalidOperationException("send_input_partial_or_failed_do_not_replay"); }
        }
    }
    private static bool SameRelease(INPUT a,INPUT b)=>a.type==b.type &&
        (a.type==INPUT_MOUSE?a.U.mi.dwFlags==b.U.mi.dwFlags:
        a.U.ki.wVk==b.U.ki.wVk && a.U.ki.wScan==b.U.ki.wScan && a.U.ki.dwFlags==b.U.ki.dwFlags);
    internal static void ReleaseOwnedInputs()
    {
        lock(OwnedGate) {
            if(OwnedUps.Count==0)return;
            var items=OwnedUps.Values.Reverse().ToArray();
            // Cleanup bypasses the cancelled guard, sends only recorded RM downs.
            var sent=SendInput((uint)items.Length,items,Marshal.SizeOf<INPUT>());
            foreach(var item in items.Take((int)sent))
                foreach(var id in OwnedUps.Where(pair=>SameRelease(pair.Value,item)).Select(pair=>pair.Key).ToArray())OwnedUps.Remove(id);
        }
    }
}
