# Claude Window Status

> Unofficial. Not affiliated with or endorsed by Anthropic.

Shows whether Claude Code is still working in a VS Code window, right in the
window title, so the Windows taskbar hover preview tells you which of several
windows needs you:

| Prefix | State | Set by |
| --- | --- | --- |
| ⏳ | working | a prompt was sent, or a tool just ran |
| 🔔 | waiting | a permission prompt or a question from Claude |
| ✅ | ready | Claude finished its turn, or you interrupted it |

A window with several sessions shows the most urgent one (🔔, then ⏳, then ✅).
A status bar item shows the same state; click it to clear a stale status.

## How it works

1. Claude Code hooks run `hooks/claude-window-status.ps1`, which writes one file
   per session to `~/.claude/window-status/<session_id>.json` (and deletes it on
   `SessionEnd`). The hooks are async, so they never slow Claude down.
2. The extension polls that folder, keeps the sessions whose project folder lies
   inside this window's workspace folders, and writes the prefixed title to
   `window.title` in the open `.code-workspace` file's settings. When no session
   is active, the original value is put back.
3. Esc doesn't fire a hook, so for a `working` session the extension also checks
   the end of the transcript for Claude Code's `[Request interrupted by user]`
   marker.

Only windows opened from a `.code-workspace` file get a title prefix. For a
plain folder the title would have to go in `.vscode/settings.json`, so those
windows only get the status bar item.

Hooks fire for every Claude Code session, so a Claude desktop app or terminal
session in the same folder also lights up the window.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `claudeWindowStatus.updateTitle` | `true` | Prefix the window title. Off leaves just the status bar item. |
| `claudeWindowStatus.prefix.working` | `⏳ ` | Title prefix while Claude is working. |
| `claudeWindowStatus.prefix.waiting` | `🔔 ` | Title prefix while Claude is waiting on you. |
| `claudeWindowStatus.prefix.ready` | `✅ ` | Title prefix once Claude has finished. |
| `claudeWindowStatus.staleHours` | `12` | Ignore status files older than this (a session that was killed). |

## Install

```powershell
pwsh scripts/install-hooks.ps1        # copies the hook, registers it in ~/.claude/settings.json
npx @vscode/vsce package --allow-missing-repository
code --install-extension claude-window-status-<version>.vsix
```

Then reload each VS Code window and start a new Claude session (hooks load when
a session starts). **Claude Window Status: Show log** shows each state change.
