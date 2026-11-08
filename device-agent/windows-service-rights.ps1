Set-StrictMode -Version Latest

function Initialize-GptLsaRightsType {
  if ('GptOperator.LsaRights' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace GptOperator {
  public static class LsaRights {
    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES {
      public int Length;
      public IntPtr RootDirectory;
      public IntPtr ObjectName;
      public uint Attributes;
      public IntPtr SecurityDescriptor;
      public IntPtr SecurityQualityOfService;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_UNICODE_STRING {
      public ushort Length;
      public ushort MaximumLength;
      public IntPtr Buffer;
    }
    [DllImport("advapi32.dll", SetLastError=true)]
    private static extern uint LsaOpenPolicy(
      IntPtr SystemName,
      ref LSA_OBJECT_ATTRIBUTES ObjectAttributes,
      uint DesiredAccess,
      out IntPtr PolicyHandle);

    [DllImport("advapi32.dll")]
    private static extern uint LsaAddAccountRights(
      IntPtr PolicyHandle,
      IntPtr AccountSid,
      LSA_UNICODE_STRING[] UserRights,
      uint CountOfRights);

    [DllImport("advapi32.dll")]
    private static extern uint LsaClose(IntPtr ObjectHandle);

    [DllImport("advapi32.dll")]
    private static extern uint LsaNtStatusToWinError(uint Status);

    private const uint POLICY_CREATE_ACCOUNT = 0x00000010;
    private const uint POLICY_LOOKUP_NAMES = 0x00000800;

    private static void ThrowOnStatus(uint status, string operation) {
      if (status == 0) return;
      int code = unchecked((int)LsaNtStatusToWinError(status));
      throw new Win32Exception(code, operation + " failed");
    }
    public static void AddAccountRight(string sidString, string right) {
      var sid = new SecurityIdentifier(sidString);
      byte[] sidBytes = new byte[sid.BinaryLength];
      sid.GetBinaryForm(sidBytes, 0);
      IntPtr sidPtr = Marshal.AllocHGlobal(sidBytes.Length);
      IntPtr rightPtr = Marshal.StringToHGlobalUni(right);
      IntPtr policy = IntPtr.Zero;
      try {
        Marshal.Copy(sidBytes, 0, sidPtr, sidBytes.Length);
        var attributes = new LSA_OBJECT_ATTRIBUTES();
        attributes.Length = Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES));
        uint status = LsaOpenPolicy(
          IntPtr.Zero,
          ref attributes,
          POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES,
          out policy);
        ThrowOnStatus(status, "LsaOpenPolicy");

        var unicode = new LSA_UNICODE_STRING {
          Length = checked((ushort)(right.Length * 2)),
          MaximumLength = checked((ushort)((right.Length + 1) * 2)),
          Buffer = rightPtr
        };
        status = LsaAddAccountRights(policy, sidPtr, new[] { unicode }, 1);
        ThrowOnStatus(status, "LsaAddAccountRights");
      } finally {
        if (policy != IntPtr.Zero) LsaClose(policy);
        Marshal.FreeHGlobal(sidPtr);
        Marshal.FreeHGlobal(rightPtr);
      }
    }
  }
}
'@
}
function Grant-GptServiceLogonRight {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$AccountName)
  Initialize-GptLsaRightsType
  $account = [System.Security.Principal.NTAccount]::new($AccountName)
  $sid = $account.Translate([System.Security.Principal.SecurityIdentifier]).Value
  [GptOperator.LsaRights]::AddAccountRight($sid, 'SeServiceLogonRight')
  return $sid
}

function Get-GptServiceStartDiagnostic {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ServiceName,
    [Parameter(Mandatory)][string]$AppDir
  )
  $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  $events = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'; StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -like "*$ServiceName*" } |
    Select-Object -First 5 Id,TimeCreated,Message
  $logs = Get-ChildItem (Join-Path $AppDir 'logs') -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 3
  $logTail = foreach ($log in $logs) {
    [pscustomobject]@{ File=$log.FullName; Tail=(Get-Content $log.FullName -Tail 20 -ErrorAction SilentlyContinue) }
  }
  [pscustomobject]@{
    Service = $service | Select-Object Name,State,StartName,ExitCode,ServiceSpecificExitCode,PathName
    Events = @($events)
    Logs = @($logTail)
  }
}
