namespace GptOperator.RealRemoteV2;

internal sealed record InteractionProfile(string Name,int MoveMs,int MoveSteps,int HoverMs,int DownMs,int DoubleGapMs)
{
    internal static bool SelfTest()
    {
        var legacy=Read("compatibility");var precise=Read("precision");var quick=Read("responsive");
        return legacy.MoveMs==90&&legacy.MoveSteps==8&&legacy.HoverMs==35&&legacy.DownMs==40&&legacy.DoubleGapMs==55
            &&precise.MoveMs==0&&precise.MoveSteps==1&&precise.HoverMs==35&&precise.DownMs==40
            &&quick.MoveMs==0&&quick.MoveSteps==1&&quick.HoverMs==5&&quick.DownMs==12&&Read("smooth")== (legacy with {Name="smooth"});
    }
    public static InteractionProfile Read(string name)=>name switch {
        "compatibility"=>new(name,90,8,35,40,55),
        "smooth"=>new(name,90,8,35,40,55),
        "precision"=>new(name,0,1,35,40,55),
        "responsive"=>new(name,0,1,5,12,25),
        _=>throw new InvalidOperationException("desktop_input_invalid_profile")
    };
}
