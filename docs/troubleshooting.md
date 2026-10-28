# Troubleshooting and limits

## Troubleshooting

**`dotagents: command not found`.** `npm link` wasn't run, or it ran under another Node version. Run `npm install && npm link` in the clone again.

**`Cannot find package '@clack/prompts'`.** The dependencies are missing. Run `npm install` in the clone.

**`.claude/skills` is "a copied folder, not a link".** Something created a real `.claude/skills` folder, for example `npx skills add` run before `init`. Move its contents to `.agents/skills/`, delete the folder and run `dotagents init` again.

**"skills-lock.json: X is installed" fails.** The lock lists a third-party skill whose folder is gone. Run `npx skills experimental_install` at the workspace root.

**"is a link to the dotagents repository" fails.** One of the own skills is a copy instead of a link. Delete the copy (move it aside first if it has changes worth keeping) and run `dotagents init <workspace> --skills <name>`.

**"no agent file is tracked by git" fails.** An agent file was committed to the project. Remove it from the index (the file stays on disk) and commit:

```bash
git rm -r --cached AGENTS.md .claude
```

**`update --all` warns about skills no longer known.** A skill was removed from `skills/` or from the catalog. To drop it from the workspace's record, run `dotagents untrack <workspace>` and `dotagents init <workspace>` again.

**A link points to an old location.** The clone or the workspace moved. Run `npm link` in the clone, then `dotagents install` and `dotagents init <workspace>`.

**"workspaces.json is not valid JSON" (or "has an invalid workspace list").** The list of tracked workspaces in `~/.config/dotagents/` (or `$DOTAGENTS_STATE_DIR`) is broken. dotagents stops instead of overwriting it, so no entry is lost. Fix the file, or delete it and run `dotagents init <workspace>` again for each workspace.

**"was written by a newer dotagents".** Another clone, more recent than this one, wrote the state file. Bring this clone up to date with `dotagents update`.

**A `.bak-<date>` file appeared.** dotagents replaced a file it didn't generate and kept the old one next to it. Compare them and delete the backup when you're done.

## Limits

- **Windows links.** File symlinks need administrator rights or Developer Mode, so files are copied and folders become junctions. Junctions store absolute paths: after moving the clone or a workspace, run the commands again.
- **Settings changed inside the apps.** On Windows the settings are copies, so a setting changed in Claude Code makes the machine's file differ from the repository's. The next `install` keeps it as a backup and writes the repository's version. To keep the change, copy the file back here and commit. On Linux and macOS the apps write through the link, so the change shows up in `git diff`.
- **Run the agents from the workspace root.** Inside one of the repositories, Claude Code looks for skills and `AGENTS.md` only up to that repository's root, and don't see the workspace's `.agents/`.
- **`npx skills experimental_install`** is how the skills CLI 1.7 restores from the lock. The name may change in later versions.
- **Hooks, subagents and MCP servers** are described by the `.agents/` standard, but dotagents doesn't generate them yet.
