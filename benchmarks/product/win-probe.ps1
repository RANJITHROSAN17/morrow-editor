# Launches one desktop app with optional file arguments and reports how long it takes to become
# input-idle, plus memory for the whole process tree (Electron and WebView2 children included).
# Run by run.mjs on Windows. Writes one line of JSON to stdout.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$ArgumentsJson = '[]',
  [int]$TimeoutMs = 60000,
  [int]$SettleMs = 5000
)
$ErrorActionPreference = 'Stop'
$argList = @(ConvertFrom-Json -InputObject $ArgumentsJson)
$argString = ($argList | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '

$sw = [System.Diagnostics.Stopwatch]::StartNew()
if ($argString) {
  $proc = Start-Process -FilePath $Exe -ArgumentList $argString -PassThru
} else {
  $proc = Start-Process -FilePath $Exe -PassThru
}

$windowSeen = $false
while ($sw.ElapsedMilliseconds -lt $TimeoutMs -and -not $proc.HasExited) {
  $proc.Refresh()
  if ($proc.MainWindowHandle -ne 0) { $windowSeen = $true; break }
  Start-Sleep -Milliseconds 10
}
$inputIdle = $false
$exitedEarly = $proc.HasExited
if (-not $exitedEarly) {
  $remaining = [Math]::Max(1, $TimeoutMs - [int]$sw.ElapsedMilliseconds)
  $inputIdle = $proc.WaitForInputIdle($remaining)
}
$readyMs = [Math]::Round($sw.Elapsed.TotalMilliseconds, 1)

Start-Sleep -Milliseconds $SettleMs
$rootId = $proc.Id
$workingSetMB = 0.0
$privateMB = 0.0
$processes = 0
if (-not $exitedEarly) {
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, PrivatePageCount)
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($rootId)
  $seen = @{}
  $ws = 0.0
  $priv = 0.0
  while ($queue.Count -gt 0) {
    $id = $queue.Dequeue()
    if ($seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    foreach ($child in ($all | Where-Object { $_.ParentProcessId -eq $id })) { $queue.Enqueue([int]$child.ProcessId) }
    $row = $all | Where-Object { $_.ProcessId -eq $id } | Select-Object -First 1
    if ($row) {
      $ws += [double]$row.WorkingSetSize
      $priv += [double]$row.PrivatePageCount
      $processes++
    }
  }
  $workingSetMB = [Math]::Round($ws / 1MB, 1)
  $privateMB = [Math]::Round($priv / 1MB, 1)
}

# Close the whole tree so the next trial starts from a clean state.
& taskkill.exe /T /F /PID $rootId 2>$null | Out-Null

[pscustomobject]@{
  readyMs      = $readyMs
  windowSeen   = $windowSeen
  inputIdle    = $inputIdle
  exitedEarly  = $exitedEarly
  workingSetMB = $workingSetMB
  privateMB    = $privateMB
  processes    = $processes
} | ConvertTo-Json -Compress
