## Environment (Windows)

- Windows 11. The default shell is PowerShell 5.1, and Git Bash is also available.
- Projects live in `D:\myWorkspace`.
- Node 24, uv and gh (GitHub CLI) are installed. Python is not on the PATH: run it with `uv run` or `uvx`.
- File symlinks require administrator rights on this machine. For folder links, use a junction (`New-Item -ItemType Junction`).
