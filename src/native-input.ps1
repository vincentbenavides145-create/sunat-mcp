$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct KBD { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
[StructLayout(LayoutKind.Explicit, Size=32)] public struct INPUTUNION { [FieldOffset(0)] public KBD keyboard; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION data; }
public static class SunatNativeKeyboard {
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, ref INPUT input, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  const uint KEYUP=2, UNICODE=4;
  public static void CheckWindow(long window) { if(window==0 || GetForegroundWindow().ToInt64()!=window) throw new InvalidOperationException(); }
  static void Send(INPUT i, long window) { CheckWindow(window); if(SendInput(1,ref i,Marshal.SizeOf(typeof(INPUT)))!=1) throw new InvalidOperationException(); }
  static void Key(ushort key, bool up, long window) { INPUT i=new INPUT(); i.type=1; i.data.keyboard.vk=key; i.data.keyboard.flags=up?KEYUP:0; Send(i,window); }
  public static void Replace(string value, bool clear, long window) {
    if(clear) { Key(0x11,false,window); Key(0x41,false,window); Key(0x41,true,window); Key(0x11,true,window); }
    foreach(char c in value) { INPUT i=new INPUT(); i.type=1; i.data.keyboard.scan=c; i.data.keyboard.flags=UNICODE; Send(i,window); i.data.keyboard.flags=UNICODE|KEYUP; Send(i,window); }
  }
  public static void Tab(long window) { Key(9,false,window); Key(9,true,window); }
}
'@
} catch { exit 1 }

# A single MCP-owned worker. Requests and text arrive only over stdin; replies
# contain an id and status, never text, account identifiers, or exception details.
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $requestId = 0
  try {
    $payload = $line | ConvertFrom-Json
    $requestId = [int]$payload.id
    $values = @($payload.values)
    $window = [long]$payload.window
    if ($values.Count -gt 0) {
      [SunatNativeKeyboard]::CheckWindow($window)
      [uint32]$browserProcess = 0
      [void][SunatNativeKeyboard]::GetWindowThreadProcessId([IntPtr]$window, [ref]$browserProcess)
      if ((Get-Process -Id $browserProcess).ProcessName -ne 'brave') { throw 'Wrong process' }
    }
    for ($index = 0; $index -lt $values.Count; $index++) {
      [SunatNativeKeyboard]::CheckWindow($window)
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ($null -eq $focused -or !$focused.Current.IsEnabled) { throw 'No focus' }
      if ($focused.Current.ControlType.ProgrammaticName -notin @('ControlType.Edit','ControlType.Document','ControlType.ComboBox')) { throw 'Not editable' }
      $expected = $payload.expected[$index]
      if ($expected.automationId) {
        if ($focused.Current.AutomationId -cne [string]$expected.automationId) { throw 'Wrong field' }
      } elseif ($expected.name -and $focused.Current.Name -cne [string]$expected.name) { throw 'Wrong field' }
      if ([bool]$focused.Current.IsPassword -ne [bool]$expected.password) { throw 'Wrong field type' }
      [SunatNativeKeyboard]::Replace([string]$values[$index], [bool]$payload.clear, $window)
      if ($index + 1 -lt $values.Count) { [SunatNativeKeyboard]::Tab($window) }
    }
    [Console]::Out.WriteLine((@{id=$requestId;ok=$true} | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{id=$requestId;ok=$false;code='native_input_rejected'} | ConvertTo-Json -Compress))
  } finally {
    $line = $null
    $payload = $null
    $values = $null
  }
}
