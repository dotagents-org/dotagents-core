## Environment (Windows)

- Windows 11. The default shell is PowerShell 5.1, and Git Bash is also available.
- Projects live in `D:\myWorkspace`.
- Node 24 and gh (GitHub CLI) are installed. Python 3.14 comes from the official Python install manager: run it with `py` (`py -m pip`, `py -m venv .venv`), never through uv or uvx.
- File symlinks require administrator rights on this machine. For folder links, use a junction (`New-Item -ItemType Junction`).
