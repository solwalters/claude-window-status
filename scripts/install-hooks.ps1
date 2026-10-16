# Installs the status hook for Claude Window Status:
#   1. copies hooks/claude-window-status.ps1 to ~/.claude/hooks/
#   2. registers it in ~/.claude/settings.json (backed up to settings.json.bak-window-status)
# Safe to re-run: existing claude-window-status entries are replaced, other hooks are kept.
# Requires PowerShell 7 (ConvertFrom-Json -AsHashtable).
#Requires -Version 7
$ErrorActionPreference = 'Stop'

$hooksDir = Join-Path $env:USERPROFILE '.claude\hooks'
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot '..\hooks\claude-window-status.ps1') $hooksDir -Force

$settings = Join-Path $env:USERPROFILE '.claude\settings.json'
$json = if (Test-Path $settings) {
    Copy-Item $settings "$settings.bak-window-status" -Force
    Get-Content $settings -Raw | ConvertFrom-Json -AsHashtable
} else { [ordered]@{} }
if (-not $json.ContainsKey('hooks')) { $json.hooks = [ordered]@{} }

function New-StatusHook([string]$State, [string]$Matcher) {
    $entry = [ordered]@{}
    if ($Matcher) { $entry.matcher = $Matcher }
    $entry.hooks = @([ordered]@{
        type    = 'command'
        command = "& `"`$env:USERPROFILE\.claude\hooks\claude-window-status.ps1`" -State $State"
        shell   = 'powershell'
        timeout = 20
        async   = $true
    })
    $entry
}

$add = [ordered]@{
    UserPromptSubmit   = New-StatusHook 'working'
    PostToolUse        = New-StatusHook 'working' '*'
    PostToolUseFailure = New-StatusHook 'working' '*'
    PermissionRequest  = New-StatusHook 'waiting' '*'
    PreToolUse         = New-StatusHook 'waiting' 'AskUserQuestion'
    Notification       = New-StatusHook 'waiting' 'elicitation_dialog'
    Stop               = New-StatusHook 'ready'
    StopFailure        = New-StatusHook 'ready'
    SessionEnd         = New-StatusHook 'end'
}
foreach ($event in $add.Keys) {
    $kept = if ($json.hooks.ContainsKey($event)) {
        @($json.hooks[$event] | Where-Object { ($_.hooks.command -join ' ') -notmatch 'claude-window-status' })
    } else { @() }
    $json.hooks[$event] = @($kept) + @($add[$event])
}

[System.IO.File]::WriteAllText($settings, ($json | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Installed hook to $hooksDir and registered $($add.Count) events in $settings."
Write-Host 'Restart running Claude sessions so they pick up the hooks.'
