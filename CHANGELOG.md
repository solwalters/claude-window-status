# Changelog

## 0.1.0

- First version. Claude Code hooks record each session's state; the extension prefixes the window title (and so the taskbar hover preview) with ⏳ working, 🔔 waiting or ✅ ready for sessions inside the window's workspace folders.
- Detects Esc/interrupts from the session transcript, since Claude Code fires no hook for them.
- Strips its own prefix from a leftover title instead of stacking a second one.
