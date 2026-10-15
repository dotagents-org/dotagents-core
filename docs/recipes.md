# Recipes

## New project

```bash
cd ~/projects
dotagents new git@github.com:me/app.git
cd app-workspace
# start Claude Code, Codex or OpenCode here
```

## A repository that is already on disk

```bash
cd ~/projects/app
dotagents init            # answers yes to moving it into ../app-workspace/
cd ../app-workspace
```

## One more repository in the same project

```bash
dotagents new git@github.com:me/api.git ~/projects/app-workspace
```

## Add a skill to an existing workspace

```bash
dotagents init ~/projects/app-workspace --skills humanizer
```

## Register a third-party skill and share it with the other machine

```bash
dotagents skills add blader/humanizer
git commit -am "✨ feat(skills): register humanizer" && git push
# on the other machine:
dotagents update
```

## Edit one of the own skills

```bash
# edit <clone>/skills/<name>/  → already live in every workspace on this machine
git commit -am "✨ feat(<name>): ..." && git push
dotagents update          # on the other machine
```

## New machine

```bash
git clone git@github.com:<you>/dotagents.git
cd dotagents && npm install && npm link && dotagents install
# for each workspace copied or cloned to this machine (links don't travel with the files):
dotagents init <workspace>
cd <workspace> && npx skills experimental_install   # third-party skills, from the lock
```

## Everything up to date

```bash
dotagents update --all
```
