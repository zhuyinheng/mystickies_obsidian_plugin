#!/bin/sh
set -eu

PLUGIN_ID="${MYSTICKIES_PLUGIN_ID:-mystickies}"
REPO="${MYSTICKIES_REPO:-zhuyinheng/mystickies_obsidian_plugin}"
VERSION="${MYSTICKIES_VERSION:-latest}"

if [ ! -d ".obsidian" ]; then
	printf '%s\n' "MyStickies installer: .obsidian not found in $(pwd). Run this from an Obsidian vault root." >&2
	exit 1
fi

if [ -n "${MYSTICKIES_BASE_URL:-}" ]; then
	BASE_URL="${MYSTICKIES_BASE_URL%/}"
else
	BASE_URL="https://github.com/${REPO}/releases/${VERSION}/download"
fi

TARGET_DIR=".obsidian/plugins/${PLUGIN_ID}"
TMP_DIR="$(mktemp -d)"

cleanup() {
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

download() {
	file="$1"
	curl -fsSL "${BASE_URL}/${file}" -o "${TMP_DIR}/${file}"
}

download main.js
download manifest.json
download styles.css

if ! grep -q '"id"[[:space:]]*:[[:space:]]*"mystickies"' "${TMP_DIR}/manifest.json"; then
	printf '%s\n' "MyStickies installer: downloaded manifest.json does not look like the mystickies manifest." >&2
	exit 1
fi

mkdir -p "$TARGET_DIR"
cp "${TMP_DIR}/main.js" "${TARGET_DIR}/main.js"
cp "${TMP_DIR}/manifest.json" "${TARGET_DIR}/manifest.json"
cp "${TMP_DIR}/styles.css" "${TARGET_DIR}/styles.css"

printf '%s\n' "MyStickies installed to ${TARGET_DIR}"
printf '%s\n' "Reload Obsidian or disable/enable the plugin to use the new files."
