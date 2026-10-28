// One taskbar button per account on Windows, and the account's look on the instance: window
// title and icon, and the notification-area icon. Every Claude Desktop window carries the package's
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
using System.Text;
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

  // The account's look: window title and icon, and the notification-area icon.
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint load);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct NotifyIconData {
    public int cbSize; public IntPtr hWnd; public uint uID; public uint uFlags; public uint uCallbackMessage; public IntPtr hIcon;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
    public uint dwState; public uint dwStateMask;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
    public uint uVersion;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
    public uint dwInfoFlags; public Guid guidItem; public IntPtr hBalloonIcon;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern bool Shell_NotifyIcon(uint message, ref NotifyIconData data);

  const uint WM_SETTEXT = 0x000C, WM_GETICON = 0x007F, WM_SETICON = 0x0080, SMTO_ABORTIFHUNG = 2, NIM_MODIFY = 1, NIF_ICON = 2, NIF_TIP = 4;
  static IntPtr bigIcon = IntPtr.Zero, smallIcon = IntPtr.Zero;

  // The account's .ico at the sizes Windows asks for; nothing when the icon isn't an .ico file.
  public static void LoadIcons(string path) {
    if (!path.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)) return;
    bigIcon = LoadImage(IntPtr.Zero, path, 1, GetSystemMetrics(11), GetSystemMetrics(12), 0x10);
    smallIcon = LoadImage(IntPtr.Zero, path, 1, GetSystemMetrics(49), GetSystemMetrics(50), 0x10);
  }

  static string ClassOf(IntPtr window) { var b = new StringBuilder(64); GetClassName(window, b, 64); return b.ToString(); }

  // Claude writes "Claude" back into the title and may set its icon again, so this runs on every
  // pass and only sends what differs.
  static void DressWindow(IntPtr window, string name) {
    IntPtr result;
    var title = new StringBuilder(256);
    GetWindowText(window, title, 256);
    if (title.ToString() != name) SendMessageTimeout(window, WM_SETTEXT, IntPtr.Zero, name, SMTO_ABORTIFHUNG, 500, out result);
    if (bigIcon == IntPtr.Zero) return;
    SendMessageTimeout(window, WM_GETICON, new IntPtr(1), IntPtr.Zero, SMTO_ABORTIFHUNG, 500, out result);
    if (result != bigIcon) {
      SendMessageTimeout(window, WM_SETICON, new IntPtr(1), bigIcon, SMTO_ABORTIFHUNG, 500, out result);
      SendMessageTimeout(window, WM_SETICON, new IntPtr(0), smallIcon, SMTO_ABORTIFHUNG, 500, out result);
    }
  }

  // The notification-area icon belongs to the instance's hidden Electron_NotifyIconHostWindow.
  // Electron numbers its icons from 3 and a new one gets a higher number, so the highest that
  // answers is the one showing. NIM_MODIFY with no flags only says whether a number exists.
  static void DressTray(IntPtr host, string name) {
    if (smallIcon == IntPtr.Zero) return;
    var data = new NotifyIconData { cbSize = Marshal.SizeOf(typeof(NotifyIconData)), hWnd = host };
    uint found = 0;
    for (uint id = 3; id < 64; id++) {
      data.uID = id;
      data.uFlags = 0;
      if (Shell_NotifyIcon(NIM_MODIFY, ref data)) found = id;
    }
    if (found == 0) return;
    data.uID = found;
    data.uFlags = NIF_ICON | NIF_TIP;
    data.hIcon = smallIcon;
    data.szTip = name;
    Shell_NotifyIcon(NIM_MODIFY, ref data);
  }

  // Title and icon on the instance's windows; with tray, its notification-area icon too.
  public static void Dress(HashSet<uint> processes, string name, bool tray) {
    EnumWindows(delegate(IntPtr window, IntPtr state) {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (!processes.Contains(processId)) return true;
      if (ClassOf(window) == "Electron_NotifyIconHostWindow") { if (tray) DressTray(window, name); return true; }
      if (IsWindowVisible(window) && GetWindow(window, 4) == IntPtr.Zero) DressWindow(window, name);
      return true;
    }, IntPtr.Zero);
  }

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

# Icon sizes at the screen's real scale.
[void][DotagentsTaskbar]::SetProcessDPIAware()
[DotagentsTaskbar]::LoadIcons($Icon)

$deadline = (Get-Date).AddSeconds($StartupSeconds)
$pass = 0
$seen = $false
while ($true) {
  $processes = [DotagentsTaskbar]::Instance($DataDir)
  if ($processes.Count -gt 0) {
    $seen = $true
    [DotagentsTaskbar]::Tag($processes, $AppId, $DisplayName, $Icon, $relaunch)
    # The tray icon every fifth pass (10 s): Claude puts its own back when Explorer restarts or
    # the theme changes.
    [DotagentsTaskbar]::Dress($processes, $DisplayName, ($pass % 5) -eq 0)
    $pass++
  } elseif ($seen -or (Get-Date) -gt $deadline) {
    break
  }
  Start-Sleep -Seconds 2
}
$mutex.ReleaseMutex()
`;
}
