# Claude Code hook (personal). Records each session's run state so the
# "Claude Window Status" VS Code extension can prefix the matching window's
# title (visible in the taskbar hover preview) with working / waiting / ready.
#
# Usage (from ~/.claude/settings.json): claude-window-status.ps1 -State <working|waiting|ready|end>
# Writes ~/.claude/window-status/<session_id>.json; `end` deletes it.
# Reads the hook payload JSON from stdin. Silent; never blocks (always exits 0).
param([string]$State = 'working')
$ErrorActionPreference = 'SilentlyContinue'
try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $h = $raw | ConvertFrom-Json

    $sid = [string]$h.session_id
    if ([string]::IsNullOrWhiteSpace($sid) -or $sid -match '[\\/:*?"<>|]') { exit 0 }

    $dir  = Join-Path $env:USERPROFILE '.claude\window-status'
    $file = Join-Path $dir "$sid.json"

    if ($State -eq 'end') { Remove-Item -LiteralPath $file -Force; exit 0 }

    # PostToolUse fires on every tool call; skip the write when nothing changed.
    if (Test-Path -LiteralPath $file) {
        $prev = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        if ($prev.state -eq $State -and $State -eq 'working' -and $h.hook_event_name -eq 'PostToolUse') { exit 0 }
    }

    $rec = [ordered]@{
        sessionId      = $sid
        state          = $State
        event          = [string]$h.hook_event_name
        cwd            = [string]$h.cwd
        projectDir     = [string]$env:CLAUDE_PROJECT_DIR  # session start dir; stable across worktrees
        transcriptPath = [string]$h.transcript_path
        ts             = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }

    # Write to a temp file then rename, so the extension never reads a partial file.
    [void](New-Item -ItemType Directory -Force -Path $dir)
    $tmp = "$file.$PID.tmp"
    [System.IO.File]::WriteAllText($tmp, ($rec | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $file -Force
} catch { }
exit 0
