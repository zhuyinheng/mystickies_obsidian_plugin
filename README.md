# MyStickies

MyStickies opens Obsidian notes in small always-on-top sticky windows. It can open today's daily note by shortcut, open the current note as a sticky, and open linked notes in either the main window or another sticky.

![demo](docs/demo.gif)

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
