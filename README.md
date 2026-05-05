# MyStickies

Always-on-top sticky windows for Obsidian notes.

![demo](docs/demo.gif)

## Features

- **Always on top, dims when inactive** — the sticky stays above other windows and fades to a low opacity when it loses focus.
- **Embeds for inline preview** — `![[other-note]]` renders inside the sticky as a compact card. Useful when the sticky is today's daily note and you want yesterday's note in view at the same time.
- **Link clicks don't navigate the sticky** — a plain click on `[[wiki]]` or an embed header opens the linked note in the **main** Obsidian window; **Cmd/Ctrl + click** opens it as a **new sticky**. The sticky itself always stays on its own note.

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
