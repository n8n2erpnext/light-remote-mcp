using System.Runtime.InteropServices;
using System.Text.Json;

namespace GptOperator.Client;

internal static partial class RealRemoteHelper
{
    private const uint InputMouse=0, InputKeyboard=1, KeyUp=0x0002, KeyUnicode=0x0004;
    private const uint MouseLeftDown=0x0002, MouseLeftUp=0x0004, MouseRightDown=0x0008, MouseRightUp=0x0010;
    private const uint MouseMiddleDown=0x0020, MouseMiddleUp=0x0040, MouseWheel=0x0800;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public uint type; public INPUTUNION U; }
    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx,dy;
        public uint mouseData,dwFlags,time;
        public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk,wScan;
        public uint dwFlags,time;
        public UIntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError=true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll", SetLastError=true)]
    private static extern bool SetCursorPos(int x,int y);

    private static object Input(JsonElement args)
    {
        if(!Environment.UserInteractive) throw new InvalidOperationException("desktop_session_not_interactive");
        if(args.ValueKind!=JsonValueKind.Object||!args.TryGetProperty("events",out var events)||events.ValueKind!=JsonValueKind.Array)
            throw new InvalidOperationException("desktop_input_events_required");
        var count=events.GetArrayLength();
        if(count<1||count>64) throw new InvalidOperationException("desktop_input_invalid_event_count");
        var semanticInput=BeginSemanticInput(args);
        var applied=0; var sent=0;
        foreach(var item in events.EnumerateArray())
        {
            if(item.ValueKind!=JsonValueKind.Object) throw new InvalidOperationException("desktop_input_event_required");
            var type=StringArg(item,"type").ToLowerInvariant();
            switch(type)
            {
                case "move": MoveCursor(item,true); break;
                case "click": MoveCursor(item,false); sent+=Click(item); break;
                case "wheel": MoveCursor(item,false); sent+=Wheel(item); break;
                case "drag": sent+=Drag(item); break;
                case "text": sent+=Text(item); break;
                case "key": sent+=Key(item); break;
                default: throw new InvalidOperationException("desktop_input_event_unsupported");
            }
            applied++;
        }
        return CompleteSemanticInput(semanticInput,applied,sent);
    }

    private static void MoveCursor(JsonElement item,bool required)
    {
        var hasX=item.TryGetProperty("x",out var xNode);
        var hasY=item.TryGetProperty("y",out var yNode);
        if(!hasX&&!hasY){if(required)throw new InvalidOperationException("desktop_input_coordinates_required");return;}
        if(!hasX||!hasY||!xNode.TryGetInt32(out var x)||!yNode.TryGetInt32(out var y)||x< -100000||x>100000||y< -100000||y>100000)
            throw new InvalidOperationException("desktop_input_invalid_coordinates");
        if(!SetCursorPos(x,y)) throw Win32InputError("desktop_input_cursor_blocked");
    }

    private static int Click(JsonElement item)
    {
        var pair=MouseButtonPair(item);
        var count=IntStrict(item,"count",1,1,3);
        var inputs=new List<INPUT>(count*2);
        for(var i=0;i<count;i++){inputs.Add(Mouse(pair.Down,0));inputs.Add(Mouse(pair.Up,0));}
        return Dispatch(inputs.ToArray());
    }

    private static int Drag(JsonElement item)
    {
        var startX=IntRequired(item,"x",-100000,100000);
        var startY=IntRequired(item,"y",-100000,100000);
        var targetX=IntRequired(item,"toX",-100000,100000);
        var targetY=IntRequired(item,"toY",-100000,100000);
        var steps=IntStrict(item,"steps",8,1,32);
        var durationMs=IntStrict(item,"durationMs",120,0,1000);
        var pair=MouseButtonPair(item);
        if(!SetCursorPos(startX,startY)) throw Win32InputError("desktop_input_cursor_blocked");

        var sent=0;
        Exception? failure=null;
        var down=false;
        try
        {
            sent+=Dispatch(new[]{Mouse(pair.Down,0)});
            down=true;
            var delay=steps>0?durationMs/steps:0;
            for(var i=1;i<=steps;i++)
            {
                var x=startX+(int)Math.Round((targetX-startX)*(i/(double)steps));
                var y=startY+(int)Math.Round((targetY-startY)*(i/(double)steps));
                if(!SetCursorPos(x,y)) throw Win32InputError("desktop_input_cursor_blocked");
                if(delay>0) System.Threading.Thread.Sleep(delay);
            }
        }
        catch(Exception ex)
        {
            failure=ex;
        }
        finally
        {
            if(down)
            {
                try { sent+=Dispatch(new[]{Mouse(pair.Up,0)}); }
                catch(Exception releaseError) { failure??=releaseError; }
            }
        }
        if(failure is not null) throw failure;
        return sent;
    }

    private static (uint Down,uint Up) MouseButtonPair(JsonElement item)
    {
        var button=item.TryGetProperty("button",out var node)?(node.GetString()??"left").ToLowerInvariant():"left";
        return button switch
        {
            "left" => (MouseLeftDown,MouseLeftUp),
            "right" => (MouseRightDown,MouseRightUp),
            "middle" => (MouseMiddleDown,MouseMiddleUp),
            _ => throw new InvalidOperationException("desktop_input_invalid_button")
        };
    }

    private static int Wheel(JsonElement item)
    {
        var delta=IntStrict(item,"delta",0,-1200,1200);
        if(delta==0) throw new InvalidOperationException("desktop_input_invalid_wheel");
        return Dispatch(new[]{Mouse(MouseWheel,unchecked((uint)delta))});
    }

    private static int Text(JsonElement item)
    {
        var value=StringArg(item,"text");
        if(value.Length<1||value.Length>4096) throw new InvalidOperationException("desktop_input_invalid_text");
        var inputs=new List<INPUT>(value.Length*2);
        foreach(var ch in value)
        {
            inputs.Add(Keyboard(0,(ushort)ch,KeyUnicode));
            inputs.Add(Keyboard(0,(ushort)ch,KeyUnicode|KeyUp));
        }
        return Dispatch(inputs.ToArray());
    }

    private static int Key(JsonElement item)
    {
        var vk=VirtualKey(StringArg(item,"key"));
        var modifiers=new List<ushort>();
        if(item.TryGetProperty("modifiers",out var mods))
        {
            if(mods.ValueKind!=JsonValueKind.Array||mods.GetArrayLength()>4) throw new InvalidOperationException("desktop_input_invalid_modifiers");
            foreach(var mod in mods.EnumerateArray())
            {
                var mvk=ModifierKey(mod.GetString()??"");
                if(!modifiers.Contains(mvk))modifiers.Add(mvk);
            }
        }
        var inputs=new List<INPUT>(modifiers.Count*2+2);
        foreach(var mod in modifiers)inputs.Add(Keyboard(mod,0,0));
        inputs.Add(Keyboard(vk,0,0));
        inputs.Add(Keyboard(vk,0,KeyUp));
        for(var i=modifiers.Count-1;i>=0;i--)inputs.Add(Keyboard(modifiers[i],0,KeyUp));
        return Dispatch(inputs.ToArray());
    }

    private static int Dispatch(INPUT[] inputs)
    {
        var sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf<INPUT>());
        if(sent!=(uint)inputs.Length) throw Win32InputError("desktop_input_blocked");
        return checked((int)sent);
    }

    private static INPUT Mouse(uint flags,uint data)=>new()
    {
        type=InputMouse,
        U=new INPUTUNION{mi=new MOUSEINPUT{mouseData=data,dwFlags=flags}}
    };

    private static INPUT Keyboard(ushort vk,ushort scan,uint flags)=>new()
    {
        type=InputKeyboard,
        U=new INPUTUNION{ki=new KEYBDINPUT{wVk=vk,wScan=scan,dwFlags=flags}}
    };

    private static Exception Win32InputError(string name)=>
        new InvalidOperationException($"{name}:{Marshal.GetLastWin32Error()}");

    private static int IntStrict(JsonElement item,string name,int fallback,int min,int max)
    {
        var value=fallback;
        if(item.TryGetProperty(name,out var node)&&!node.TryGetInt32(out value)) throw new InvalidOperationException($"desktop_input_invalid_{name}");
        if(value<min||value>max) throw new InvalidOperationException($"desktop_input_invalid_{name}");
        return value;
    }

    private static int IntRequired(JsonElement item,string name,int min,int max)
    {
        if(!item.TryGetProperty(name,out var node)||!node.TryGetInt32(out var value)||value<min||value>max)
            throw new InvalidOperationException($"desktop_input_invalid_{name}");
        return value;
    }

    private static string StringArg(JsonElement item,string name)
    {
        if(!item.TryGetProperty(name,out var node)||node.ValueKind!=JsonValueKind.String)
            throw new InvalidOperationException($"desktop_input_invalid_{name}");
        return node.GetString()??"";
    }

    private static ushort ModifierKey(string name)=>name.Trim().ToUpperInvariant() switch
    {
        "CTRL"=>0x11, "ALT"=>0x12, "SHIFT"=>0x10, "WIN"=>0x5B,
        _=>throw new InvalidOperationException("desktop_input_invalid_modifier")
    };

    private static ushort VirtualKey(string name)
    {
        var key=name.Trim().ToUpperInvariant();
        if(key.Length==1&&key[0]>='A'&&key[0]<='Z')return key[0];
        if(key.Length==1&&key[0]>='0'&&key[0]<='9')return key[0];
        if(key.Length>=2&&key[0]=='F'&&int.TryParse(key[1..],out var fn)&&fn>=1&&fn<=12)return checked((ushort)(0x6F+fn));
        return key switch
        {
            "ENTER"=>0x0D, "TAB"=>0x09, "ESC"=>0x1B, "BACKSPACE"=>0x08,
            "DELETE"=>0x2E, "LEFT"=>0x25, "UP"=>0x26, "RIGHT"=>0x27, "DOWN"=>0x28,
            "HOME"=>0x24, "END"=>0x23, "PAGEUP"=>0x21, "PAGEDOWN"=>0x22, "SPACE"=>0x20,
            _=>throw new InvalidOperationException("desktop_input_invalid_key")
        };
    }
}
