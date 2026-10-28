// One taskbar button per account on Windows. Every Claude Desktop window carries the package's
// identity, so the taskbar puts every instance under one Claude button. Two things split them:
// - the account's Start menu shortcut carries an AppUserModelID of its own
//   (System.AppUserModel.ID, written through the shortcut's property store);
// - a watcher, started by the account's launcher next to the app, gives the windows of that
//   instance the same ID, the account's icon and name and the command that opens it again
//   (through each window's property store). Windows then shows them as their own button, and
//   pinning it pins the account.
// The watcher finds the instance by the claude.exe command line (--user-data-dir for an extra
// account, none for the default one), runs one per account (a named mutex) and ends when that
// instance closes. The technique is the one leonxlnx/claude-desktop-multi-account (MIT) and
// freenitial/claude_desktop_profiles_manager use.

import path from "node:path";

export const appIdFor = (name: string) => `dotagents.claude.${name}`;
export const taskbarWatcherFile = (launcherDir: string) => path.join(launcherDir, "claude-taskbar.ps1");

// The property store pieces both C# snippets share: System.AppUserModel.* as LPWSTR values.
const PROPERTY_STORE = `
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PropertyKey { public Guid FormatId; public uint PropertyId; }
  // PROPVARIANT is 24 bytes on 64-bit Windows: GetValue writes all of it, so the struct has to be as big.
  [StructLayout(LayoutKind.Explicit, Size = 24)] public struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
  // System.AppUserModel: 5 = ID, 2 = RelaunchCommand, 3 = RelaunchIconResource, 4 = RelaunchDisplayNameResource.
  static readonly Guid AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
  static void Set(IPropertyStore store, uint id, string text) {
    var key = new PropertyKey { FormatId = AppUserModel, PropertyId = id };
    var value = new PropVariant { Type = 31, Pointer = Marshal.StringToCoTaskMemUni(text) };
    try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); } finally { Marshal.FreeCoTaskMem(value.Pointer); }
  }
  static string Get(IPropertyStore store, uint id) {
    var key = new PropertyKey { FormatId = AppUserModel, PropertyId = id };
    PropVariant value;
    if (store.GetValue(ref key, out value) != 0) return "";
    try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Pointer) : ""; } finally { PropVariantClear(ref value); }
  }
`;

// Reads and writes a shortcut's AppUserModelID. Loaded by the PowerShell shortcut adapter.
export const SHORTCUT_APP_ID_CS = `
using System;
using System.Runtime.InteropServices;
public static class DotagentsShortcutAppId {
${PROPERTY_STORE}
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bindContext, int flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  static IPropertyStore Open(string lnk, int flags) {
    var iid = typeof(IPropertyStore).GUID;
    IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(lnk, IntPtr.Zero, flags, ref iid, out store));
    return store;
  }
  // GPS_READWRITE = 2.
  public static void Write(string lnk, string appId) {
    var store = Open(lnk, 2);
    try { Set(store, 5, appId); Marshal.ThrowExceptionForHR(store.Commit()); } finally { Marshal.ReleaseComObject(store); }
  }
  public static string Read(string lnk) {
    var store = Open(lnk, 0);
    try { return Get(store, 5); } finally { Marshal.ReleaseComObject(store); }
  }
}
`;

// The watcher, a PowerShell script with its C# compiled on start (Windows PowerShell 5.1, .NET
// Framework). Its parameters say which instance and how to show it.
export function taskbarWatcher() {
  return `# The taskbar watcher of one Claude Desktop instance: see lib/taskbar.ts in dotagents.
param(
  [Parameter(Mandatory)] [string]$AppId,
  [Parameter(Mandatory)] [string]$DisplayName,
  [Parameter(Mandatory)] [string]$Icon,
  # The account's .vbs launcher: the button's "open again" command runs it.
  [Parameter(Mandatory)] [string]$Launcher,
  # The account's --user-data-dir; empty for the default account, whose app has none.
  [string]$DataDir = "",
  # How long to wait for the app to show up before giving up.
  [int]$StartupSeconds = 60
)

Add-Type -ReferencedAssemblies System.Management -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Management;
using System.Runtime.InteropServices;
public static class DotagentsTaskbar {
${PROPERTY_STORE}
  delegate bool WindowVisitor(IntPtr window, IntPtr state);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisitor visitor, IntPtr state);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint relation);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  // The Claude Desktop processes of this instance. The Claude Code CLI is claude.exe too, so the
  // executable has to be the Desktop app's (its package or its installer folder).
  public static HashSet<uint> Instance(string dataDir) {
    var found = new HashSet<uint>();
    using (var search = new ManagementObjectSearcher("SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process WHERE Name = 'claude.exe'")) {
      foreach (ManagementObject p in search.Get()) {
        var exe = Convert.ToString(p["ExecutablePath"]) ?? "";
        var line = Convert.ToString(p["CommandLine"]) ?? "";
        if (exe.IndexOf("WindowsApps", StringComparison.OrdinalIgnoreCase) < 0 && exe.IndexOf("AnthropicClaude", StringComparison.OrdinalIgnoreCase) < 0) continue;
        var custom = line.IndexOf("--user-data-dir", StringComparison.OrdinalIgnoreCase) >= 0;
        var mine = dataDir.Length == 0 ? !custom : line.IndexOf(dataDir, StringComparison.OrdinalIgnoreCase) >= 0;
        if (mine) found.Add(Convert.ToUInt32(p["ProcessId"]));
      }
    }
    return found;
  }

  static readonly HashSet<IntPtr> tagged = new HashSet<IntPtr>();

  // Tags the visible top-level windows of those processes that aren't tagged yet.
  public static void Tag(HashSet<uint> processes, string appId, string name, string icon, string relaunch) {
    EnumWindows(delegate(IntPtr window, IntPtr state) {
      if (tagged.Contains(window) || !IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero) return true;
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (!processes.Contains(processId)) return true;
      var iid = typeof(IPropertyStore).GUID;
      IPropertyStore store;
      if (SHGetPropertyStoreForWindow(window, ref iid, out store) != 0) return true;
      try {
        Set(store, 5, appId);
        Set(store, 2, relaunch);
        Set(store, 3, icon);
        Set(store, 4, name);
        store.Commit();
        tagged.Add(window);
      } catch { } finally { Marshal.ReleaseComObject(store); }
      return true;
    }, IntPtr.Zero);
  }
}
'@

$relaunch = '"' + (Join-Path $env:SystemRoot 'System32\wscript.exe') + '" "' + $Launcher + '"'

# One watcher per instance: a second start of the account leaves the running one alone.
$mutex = New-Object System.Threading.Mutex($false, "Local\\$AppId")
if (-not $mutex.WaitOne(0)) { exit 0 }

$deadline = (Get-Date).AddSeconds($StartupSeconds)
$seen = $false
while ($true) {
  $processes = [DotagentsTaskbar]::Instance($DataDir)
  if ($processes.Count -gt 0) {
    $seen = $true
    [DotagentsTaskbar]::Tag($processes, $AppId, $DisplayName, $Icon, $relaunch)
  } elseif ($seen -or (Get-Date) -gt $deadline) {
    break
  }
  Start-Sleep -Seconds 2
}
$mutex.ReleaseMutex()
`;
}
