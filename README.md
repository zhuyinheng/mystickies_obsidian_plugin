# MyStickies

Always-on-top sticky windows for Obsidian notes.

![demo](docs/demo.gif)

## Features

- **Today's daily note as a sticky** — from the ribbon, the command palette, or automatically on Obsidian launch.
- **Open any note as a sticky** — right-click → *Open as sticky*, or run *Open current note as sticky*.
- **Embed-click redirects** — clicking inside an embedded note jumps to it in the main window instead of cluttering the sticky.
- **Internal links open in the main window** — keeps the sticky focused on one note.
- **Persistent size** — the sticky remembers its last width and height across sessions.
- **Close all stickies** in one command.
- **Go to main** button in the title bar focuses the main Obsidian window.

## Install from a release

Run the installer from the root of an Obsidian vault. The current directory must contain `.obsidian`.

```sh
curl -fsSL https://raw.githubusercontent.com/zhuyinheng/mystickies_obsidian_plugin/main/install.sh | sh
```

If the repository name changes, override it:

```sh
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/install.sh | env MYSTICKIES_REPO=<owner>/<repo> sh
```

The installer downloads `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release into `.obsidian/plugins/mystickies`.

## Development

```sh
npm install
npm run dev
```

Release attachments are generated under `dist/` and intentionally ignored by git. For release validation:

```sh
npm run release:check
```

## Release assets

Attach these files to each GitHub release:

- `dist/main.js` as `main.js`
- `dist/manifest.json` as `manifest.json`
- `dist/styles.css` as `styles.css`
