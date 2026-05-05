# MyStickies

Always-on-top sticky windows for Obsidian notes.

![demo](docs/demo.gif)

## Features

- **Always on top, dims when inactive** — the sticky stays above other windows and fades to a low opacity when it loses focus, so it's there when you glance at it but stays out of the way while you work elsewhere.
- **Embed links jump to the source** — clicking an `![[embed]]` header opens that note in the main Obsidian window instead of inside the sticky. Handy when the sticky is a daily note that pulls in pieces of other notes.

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
