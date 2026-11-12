# dotagents tray panel (ADR 0010): an icon in the notification area and, on a click, a panel
# above the clock with every account's usage, the account in each side's slot and the actions.
# Windows PowerShell 5.1 and WPF, nothing to build. Everything it shows and does comes from
# `dotagents start` (surfaces/web/server.ts), found through <state>/start.json; it starts one,
# hidden, when none runs. The icon is the current account's avatar in its state (core/snapshot.ts,
# trayFor). Keep this file ASCII: Windows PowerShell reads a script without a BOM as ANSI.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms, System.Drawing, System.Net.Http
Add-Type -Namespace DotAgents -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool DestroyIcon(System.IntPtr handle);'

# One panel at a time.
$created = $false
$script:mutex = New-Object System.Threading.Mutex($true, 'Local\dotagents.tray', [ref]$created)
if (-not $created) { exit 0 }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$assets = Join-Path $here 'assets'
$stateDir = if ($env:DOTAGENTS_STATE_DIR) { $env:DOTAGENTS_STATE_DIR } else { Join-Path $env:USERPROFILE '.config\dotagents' }
$serverFile = Join-Path $stateDir 'start.json'
$logFile = Join-Path $stateDir 'tray.log'
# A failure inside an event would end the panel: it is written down instead, and the panel goes on.
function Write-Failure($err) { try { Add-Content -Path $logFile -Value "$([DateTime]::Now.ToString('s'))  $err" } catch {} }
$FRAME = 168
$FRAMES = 24

# --- Colors: the identity's roles, light or dark like Windows' apps -------------------------
function Get-Palette {
  $light = 1
  try { $light = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme).AppsUseLightTheme } catch {}
  if ($light -eq 1) {
    return @{ bg = '#ffffff'; text = '#171717'; muted = '#4d4d4d'; track = '#e3e3e3'; border = '#e3e3e3'; ok = '#107d32'; warn = '#a25204'; high = '#d50322' }
  }
  return @{ bg = '#0a0a0a'; text = '#ededed'; muted = '#a0a0a0'; track = '#333333'; border = '#2b2b2b'; ok = '#01ca54'; warn = '#fe9911'; high = '#fe6367' }
}
$script:converter = New-Object System.Windows.Media.BrushConverter
function Brush([string]$hex) { return $script:converter.ConvertFromString($hex) }

# --- The server: its address, or one started hidden ----------------------------------------
$script:startedAt = [DateTime]::MinValue
function Get-Server {
  if (Test-Path $serverFile) {
    try {
      $s = Get-Content -Raw $serverFile | ConvertFrom-Json
      if (Get-Process -Id $s.pid -ErrorAction SilentlyContinue) { return $s }
    } catch {}
  }
  # None runs: start one, at most once a minute, and look again on the next poll.
  if (([DateTime]::Now - $script:startedAt).TotalSeconds -gt 60) {
    $script:startedAt = [DateTime]::Now
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'dotagents', 'start' -WindowStyle Hidden
  }
  return $null
}

# --- Requests that never block the window -------------------------------------------------
$script:http = New-Object System.Net.Http.HttpClient
$script:http.Timeout = [TimeSpan]::FromSeconds(90)
$script:pending = New-Object System.Collections.ArrayList

function Send-Api([string]$method, [string]$path, $body, [scriptblock]$done) {
  $server = Get-Server
  if (-not $server) { & $done $null 'the dotagents server is starting'; return }
  $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($method)), "http://127.0.0.1:$($server.port)$path")
  $request.Headers.Add('x-dotagents-token', [string]$server.token)
  if ($body) { $request.Content = New-Object System.Net.Http.StringContent(($body | ConvertTo-Json -Compress), [System.Text.Encoding]::UTF8, 'application/json') }
  [void]$script:pending.Add(@{ task = $script:http.SendAsync($request); done = $done })
}

function Step-Pending {
  foreach ($item in @($script:pending)) {
    if (-not $item.task.IsCompleted) { continue }
    $script:pending.Remove($item)
    if ($item.task.IsFaulted -or $item.task.IsCanceled) { & $item.done $null 'no answer from the dotagents server'; continue }
    $response = $item.task.Result
    $text = $response.Content.ReadAsStringAsync().Result
    try { $data = $text | ConvertFrom-Json } catch { $data = $null }
    if ($response.IsSuccessStatusCode) { & $item.done $data $null }
    elseif ($data -and $data.detail) { & $item.done $null $data.detail }
    else { & $item.done $null "HTTP $([int]$response.StatusCode)" }
  }
}

# --- Avatars: strips of 24 frames, one per account and state --------------------------------
$script:strips = @{}
function Get-StripFile([string]$name, [string]$state) {
  $file = Join-Path $assets "$name-$state.png"
  if (Test-Path $file) { return $file }
  return Join-Path $assets "dotagents-$state.png"
}
function Get-Frames([string]$name, [string]$state) {
  $file = Get-StripFile $name $state
  if (-not $script:strips.ContainsKey($file)) {
    $image = New-Object System.Windows.Media.Imaging.BitmapImage
    $image.BeginInit(); $image.UriSource = New-Object System.Uri($file); $image.CacheOption = 'OnLoad'; $image.EndInit(); $image.Freeze()
    $frames = @()
    for ($i = 0; $i -lt $FRAMES; $i++) { $frames += New-Object System.Windows.Media.Imaging.CroppedBitmap($image, (New-Object System.Windows.Int32Rect(($i * $FRAME), 0, $FRAME, $FRAME))) }
    $script:strips[$file] = $frames
  }
  return $script:strips[$file]
}

# The icon: the first frame of the strip, at 32 px.
$script:iconHandle = [IntPtr]::Zero
function Set-TrayIcon([string]$name, [string]$state, [string]$tip) {
  $strip = [System.Drawing.Image]::FromFile((Get-StripFile $name $state))
  $bitmap = New-Object System.Drawing.Bitmap(32, 32)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($strip, (New-Object System.Drawing.Rectangle(0, 0, 32, 32)), (New-Object System.Drawing.Rectangle(0, 0, $FRAME, $FRAME)), 'Pixel')
  $g.Dispose(); $strip.Dispose()
  $handle = $bitmap.GetHicon()
  $script:notify.Icon = [System.Drawing.Icon]::FromHandle($handle)
  $bitmap.Dispose()
  if ($script:iconHandle -ne [IntPtr]::Zero) { [void][DotAgents.Native]::DestroyIcon($script:iconHandle) }
  $script:iconHandle = $handle
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
  $script:notify.Text = $tip
}

# --- Text helpers ---------------------------------------------------------------------------
function Format-Span([TimeSpan]$t) {
  $m = [int][Math]::Floor($t.TotalMinutes)
  if ($m -lt 1) { return '<1m' }
  if ($m -lt 60) { return "${m}m" }
  $h = [int][Math]::Floor($m / 60)
  if ($h -lt 24) { return "${h}h $($m % 60)m" }
  return "$([int][Math]::Floor($h / 24))d $($h % 24)h"
}
function Get-Date-Local([string]$iso) { return [DateTime]::Parse($iso, $null, [System.Globalization.DateTimeStyles]::RoundtripKind).ToLocalTime() }
function Get-Level([double]$pct, $p) { if ($pct -ge 90) { return $p.high } if ($pct -ge 70) { return $p.warn } return $p.ok }
function New-Text([string]$text, [string]$color, [switch]$bold, [double]$size = 12) {
  $t = New-Object System.Windows.Controls.TextBlock
  $t.Text = $text; $t.Foreground = Brush $color; $t.FontSize = $size; $t.TextWrapping = 'Wrap'
  if ($bold) { $t.FontWeight = 'SemiBold' }
  return $t
}

# --- The window -----------------------------------------------------------------------------
[xml]$xaml = Get-Content -Raw (Join-Path $here 'panel.xaml')
$window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$ui = @{}
foreach ($n in 'Frame', 'Badge', 'BadgeText', 'Age', 'Refresh', 'RefreshIcon', 'Cards', 'Message', 'Dashboard', 'Sides') { $ui[$n] = $window.FindName($n) }
$script:data = $null
$script:avatars = New-Object System.Collections.ArrayList
$script:frame = 0
$script:hiddenAt = [DateTime]::MinValue

function Set-Message([string]$text, [string]$color) {
  if ($text) { $ui.Message.Text = $text; $ui.Message.Foreground = Brush $color; $ui.Message.Visibility = 'Visible' }
  else { $ui.Message.Visibility = 'Collapsed' }
}

function New-Button([string]$label, [bool]$primary, $p) {
  $b = New-Object System.Windows.Controls.Button
  $b.Content = $label; $b.MinHeight = 34; $b.Cursor = 'Hand'; $b.Padding = '8,0,8,0'; $b.BorderThickness = 1
  $b.FontFamily = $window.FontFamily
  if ($primary) { $b.Background = Brush $p.text; $b.Foreground = Brush $p.bg; $b.BorderBrush = Brush $p.text; $b.FontWeight = 'SemiBold' }
  else { $b.Background = Brush $p.bg; $b.Foreground = Brush $p.text; $b.BorderBrush = Brush $p.border }
  return $b
}

function Invoke-Action([string]$action, [string]$acct, [string]$doing) {
  $p = Get-Palette
  Set-Message $doing $p.muted
  Send-Api 'POST' "/api/$action" @{ profile = $acct } {
    param($data, $failure)
    $p = Get-Palette
    if ($failure) { Set-Message $failure $p.high } else { Set-Message $data.detail $p.muted }
    Request-Usage
  }
}

function Update-Panel {
  $p = Get-Palette
  $ui.Frame.Background = Brush $p.bg; $ui.Frame.BorderBrush = Brush $p.border
  $ui.Badge.Background = Brush $p.text; $ui.BadgeText.Foreground = Brush $p.bg
  $ui.Age.Foreground = Brush $p.muted; $ui.Sides.Foreground = Brush $p.muted; $ui.Dashboard.Foreground = Brush $p.muted
  $ui.Refresh.BorderBrush = Brush $p.border; $ui.RefreshIcon.Stroke = Brush $p.muted
  $ui.Cards.Children.Clear(); [void]$script:avatars.Clear()
  $d = $script:data
  if (-not $d) { $ui.Age.Text = 'waiting for the server'; return }
  $ui.Age.Text = 'live, ' + (Format-Span ([DateTime]::Now - (Get-Date-Local $d.generatedAt))) + ' ago'
  $sides = @(); foreach ($s in $d.slots.PSObject.Properties) { $sides += $s.Name }
  $ui.Sides.Text = if ($d.peer -and -not $d.peer.up) { "$($d.peer.name) off" } else { $sides -join ' and ' }
  foreach ($acct in $d.profiles) {
    $card = New-Object System.Windows.Controls.Border
    $card.BorderBrush = Brush $p.border; $card.BorderThickness = 1; $card.CornerRadius = 10; $card.Padding = 12; $card.Margin = '0,0,0,10'
    $stack = New-Object System.Windows.Controls.StackPanel
    # Head: the avatar, the name, the sides whose slot holds it, the sessions.
    $head = New-Object System.Windows.Controls.DockPanel
    $avatar = New-Object System.Windows.Controls.Image
    $avatar.Width = 48; $avatar.Height = 48; $avatar.Margin = '0,0,12,0'
    $frames = Get-Frames $acct.name $acct.avatar
    $avatar.Source = $frames[$script:frame % $FRAMES]
    [void]$script:avatars.Add(@{ image = $avatar; frames = $frames })
    [System.Windows.Automation.AutomationProperties]::SetName($avatar, "$($acct.name), $($acct.avatar)")
    [void]$head.Children.Add($avatar)
    $names = New-Object System.Windows.Controls.StackPanel
    $names.VerticalAlignment = 'Center'
    $line = New-Object System.Windows.Controls.WrapPanel
    [void]$line.Children.Add((New-Text $acct.name $acct.color -bold -size 15))
    foreach ($s in $d.slots.PSObject.Properties) {
      if ($s.Value -ne $acct.name) { continue }
      $badge = New-Object System.Windows.Controls.Border
      $badge.BorderBrush = Brush $p.border; $badge.BorderThickness = 1; $badge.CornerRadius = 4; $badge.Padding = '5,0,5,0'; $badge.Margin = '8,2,0,0'
      $badge.Child = New-Text $s.Name $p.muted -size 11
      [void]$line.Children.Add($badge)
    }
    [void]$names.Children.Add($line)
    $status = ''
    if ($acct.avatar -eq 'error') { $status = if ($acct.error) { $acct.error } else { "no login here: dotagents login $($acct.name)" } }
    elseif ($acct.activity) {
      $parts = @()
      if ($acct.activity.working) { $parts += "$($acct.activity.working) working" }
      if ($acct.activity.waiting) { $parts += "$($acct.activity.waiting) waiting on you" }
      $status = $parts -join ', '
    }
    if ($status) { [void]$names.Children.Add((New-Text $status $(if ($acct.avatar -eq 'error') { $p.high } else { $p.muted }) -size 11)) }
    [void]$head.Children.Add($names)
    [void]$stack.Children.Add($head)
    # The windows: bar, percentage, reset and projection.
    foreach ($w in $acct.windows) {
      $label = switch ($w.kind) { 'session' { '5h' } 'week' { '7d' } default { [string]$w.model } }
      $color = Get-Level $w.pct $p
      $row = New-Object System.Windows.Controls.Grid
      $row.Margin = '0,10,0,0'
      foreach ($width in '34', '*', '46') { $c = New-Object System.Windows.Controls.ColumnDefinition; $c.Width = $width; [void]$row.ColumnDefinitions.Add($c) }
      $name = New-Text $label $p.muted; [System.Windows.Controls.Grid]::SetColumn($name, 0); [void]$row.Children.Add($name)
      $bar = New-Object System.Windows.Controls.Grid
      $bar.Height = 6; $bar.VerticalAlignment = 'Center'
      $used = [Math]::Min([Math]::Max([double]$w.pct, 0), 100)
      foreach ($part in @(@($used, $color), @((100 - $used), $p.track))) {
        $c = New-Object System.Windows.Controls.ColumnDefinition; $c.Width = New-Object System.Windows.GridLength($part[0], 'Star'); [void]$bar.ColumnDefinitions.Add($c)
      }
      $fill = New-Object System.Windows.Shapes.Rectangle; $fill.Fill = Brush $color; $fill.RadiusX = 3; $fill.RadiusY = 3
      $rest = New-Object System.Windows.Shapes.Rectangle; $rest.Fill = Brush $p.track; $rest.RadiusX = 3; $rest.RadiusY = 3
      [System.Windows.Controls.Grid]::SetColumn($rest, 1)
      [void]$bar.Children.Add($fill); [void]$bar.Children.Add($rest)
      [System.Windows.Controls.Grid]::SetColumn($bar, 1); [void]$row.Children.Add($bar)
      $pct = New-Text "$($w.pct)%" $color -bold; $pct.TextAlignment = 'Right'; [System.Windows.Controls.Grid]::SetColumn($pct, 2); [void]$row.Children.Add($pct)
      [void]$stack.Children.Add($row)
      $reset = if ($w.reset -or -not $w.resetsAt) { if ($w.kind -eq 'session') { 'no window open' } else { 'reset' } } else { 'resets ' + (Format-Span ((Get-Date-Local $w.resetsAt) - [DateTime]::Now)) }
      $resetText = New-Text $reset $p.muted -size 11; $resetText.Margin = '34,2,0,0'; [void]$stack.Children.Add($resetText)
      if ($w.projection -and $acct.state -eq 'ok') {
        $proj = $w.projection; $projColor = $p.muted
        if ($proj.from) { $projText = 'projection from ' + (Get-Date-Local $proj.from).ToString('HH:mm') }
        else {
          $projText = "~$($proj.atResetPct)% at reset"
          if ($proj.runsOutAt) {
            $when = Get-Date-Local $proj.runsOutAt
            $projText += ', runs out ' + $(if ($w.kind -eq 'session') { $when.ToString('HH:mm') } else { $when.ToString('ddd HH:mm', [System.Globalization.CultureInfo]::InvariantCulture) })
            $projColor = $p.warn
          }
        }
        $projLine = New-Text $projText $projColor -size 11; $projLine.Margin = '34,0,0,0'; [void]$stack.Children.Add($projLine)
      }
    }
    # Actions: switch to it (unless it's already in every slot), open its Desktop app.
    $buttons = New-Object System.Windows.Controls.UniformGrid
    $buttons.Rows = 1; $buttons.Margin = '0,12,0,0'
    $everywhere = $sides.Count -gt 0 -and -not ($d.slots.PSObject.Properties | Where-Object { $_.Value -ne $acct.name })
    # The account rides on the button (Tag): a handler runs later, when the loop has moved on.
    if (-not $everywhere) {
      $switch = New-Button 'Use on both sides' $true $p; $switch.Margin = '0,0,4,0'; $switch.Tag = [string]$acct.name
      $switch.Add_Click({ param($sender) Invoke-Action 'switch' $sender.Tag "switching to $($sender.Tag)..." })
      [void]$buttons.Children.Add($switch)
    }
    $open = New-Button 'Open Desktop' $false $p; $open.Tag = [string]$acct.name
    $open.Add_Click({ param($sender) Invoke-Action 'desktop' $sender.Tag "opening $($sender.Tag)..." })
    [void]$buttons.Children.Add($open)
    [void]$stack.Children.Add($buttons)
    $card.Child = $stack
    [void]$ui.Cards.Children.Add($card)
  }
}

function Update-Tray {
  $d = $script:data
  if (-not $d) { Set-TrayIcon 'dotagents' 'asleep' 'dotagents: starting'; return }
  $current = $d.profiles | Where-Object { $_.name -eq $d.tray.profile } | Select-Object -First 1
  $tip = "dotagents: $($d.tray.profile) $($d.tray.state)"
  if ($current) { $tip = "$($current.name): " + (($current.windows | ForEach-Object { $(if ($_.kind -eq 'session') { '5h' } elseif ($_.kind -eq 'week') { '7d' } else { $_.model }) + " $($_.pct)%" }) -join ', ') }
  Set-TrayIcon $d.tray.profile $d.tray.state $tip
}

function Request-Usage {
  Send-Api 'GET' '/api/usage' $null {
    param($data, $failure)
    if ($data) { $script:data = $data; Set-Message '' '' } elseif (-not $script:data) { Set-Message $failure (Get-Palette).muted }
    Update-Tray
    if ($window.IsVisible) { Update-Panel }
  }
}

# Above the clock, in the work area's corner, whatever the taskbar's size.
function Set-Place {
  $area = [System.Windows.SystemParameters]::WorkArea
  $window.Left = $area.Right - $window.ActualWidth
  $window.Top = $area.Bottom - $window.ActualHeight
}
$window.Add_SizeChanged({ Set-Place })
$window.Add_Deactivated({ $window.Hide(); $script:hiddenAt = [DateTime]::Now })
$ui.Refresh.Add_Click({ Request-Usage })
$ui.Dashboard.Add_MouseLeftButtonUp({
  $server = Get-Server
  if ($server) { Start-Process "http://127.0.0.1:$($server.port)/#token=$($server.token)" }
})

function Show-Panel {
  # A click on the icon that just closed the panel (it lost the focus to the click) leaves it closed.
  if (([DateTime]::Now - $script:hiddenAt).TotalMilliseconds -lt 300) { return }
  Update-Panel
  $window.Show(); $window.Activate(); Set-Place
  Request-Usage
}

# --- The icon -------------------------------------------------------------------------------
$script:notify = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add('Open dashboard', $null, { $server = Get-Server; if ($server) { Start-Process "http://127.0.0.1:$($server.port)/#token=$($server.token)" } })
[void]$menu.Items.Add('Refresh', $null, { Request-Usage })
[void]$menu.Items.Add('Quit', $null, {
  $script:notify.Visible = $false; $script:notify.Dispose()
  [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown()
})
$script:notify.ContextMenuStrip = $menu
$script:notify.Add_MouseClick({ param($s, $e) try { if ($e.Button -eq 'Left') { if ($window.IsVisible) { $window.Hide() } else { Show-Panel } } } catch { Write-Failure $_ } })
Update-Tray
$script:notify.Visible = $true

# --- Timers: the requests' answers, the data every 5 s, the avatars while the panel shows ------
$answers = New-Object System.Windows.Threading.DispatcherTimer
$answers.Interval = [TimeSpan]::FromMilliseconds(100)
$answers.Add_Tick({ try { Step-Pending } catch { Write-Failure $_ } })
$answers.Start()

$poll = New-Object System.Windows.Threading.DispatcherTimer
$poll.Interval = [TimeSpan]::FromSeconds(5)
$poll.Add_Tick({ try { Request-Usage } catch { Write-Failure $_ } })
$poll.Start()

$animate = New-Object System.Windows.Threading.DispatcherTimer
$animate.Interval = [TimeSpan]::FromMilliseconds(125)
$animate.Add_Tick({
  $script:frame = ($script:frame + 1) % $FRAMES
  foreach ($a in $script:avatars) { $a.image.Source = $a.frames[$script:frame] }
})
$window.Add_IsVisibleChanged({ if ($window.IsVisible) { $animate.Start() } else { $animate.Stop() } })

Request-Usage
[System.Windows.Threading.Dispatcher]::Run()
$script:mutex.ReleaseMutex()
