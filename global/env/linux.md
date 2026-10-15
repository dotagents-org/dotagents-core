## Environment (Linux, WSL)

- Ubuntu 26.04 on WSL2. The shell is bash.
- Projects live in `~/myWorkspace`. The Windows drives are mounted under `/mnt` (`/mnt/c`, `/mnt/d`); prefer the Linux file system, which is much faster for git and node.
- Node 22 (`/usr/bin/node`), Python 3.14 (`python3`), uv, Docker and gh are installed. npm's global folder is `~/.local`, so `npm link` and `npm install -g` need no `sudo`.
- `opencode` and `code` on the PATH are the Windows executables: OpenCode run from here reads and writes the Windows configuration, not `~/.config/opencode`.
- The GitHub SSH key has a passphrase. In a non-interactive shell, git over SSH waits for it and hangs; there, use HTTPS through gh for a single command: `git -c credential.helper='!gh auth git-credential' <clone|fetch|push> https://github.com/<owner>/<repo>.git`.
