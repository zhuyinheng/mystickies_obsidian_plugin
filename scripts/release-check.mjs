import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";

const requiredReleaseAssets = ["dist/main.js", "dist/manifest.json", "dist/styles.css"];
const forbiddenRootAssets = ["main.js", "styles.css"];

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const fail = (message) => {
	console.error(`release:check failed: ${message}`);
	process.exitCode = 1;
};

const packageJson = await readJson("package.json");
const manifest = await readJson("manifest.json");
const releaseManifest = await readJson("dist/manifest.json");
const versions = await readJson("versions.json");

for (const file of requiredReleaseAssets) {
	if (!existsSync(file)) {
		fail(`${file} is missing`);
		continue;
	}
	if (!statSync(file).isFile()) {
		fail(`${file} is not a file`);
	}
}

for (const file of forbiddenRootAssets) {
	if (existsSync(file)) {
		fail(`${file} should not live in the repository root; use dist/${file}`);
	}
}

if (packageJson.name !== manifest.id) {
	fail(`package name (${packageJson.name}) must match manifest id (${manifest.id})`);
}

if (JSON.stringify(releaseManifest) !== JSON.stringify(manifest)) {
	fail("dist/manifest.json must match root manifest.json");
}

if (packageJson.version !== manifest.version) {
	fail(`package version (${packageJson.version}) must match manifest version (${manifest.version})`);
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
	fail(`manifest version must use x.y.z semver, got ${manifest.version}`);
}

if (versions[manifest.version] !== manifest.minAppVersion) {
	fail(`versions.json must map ${manifest.version} to ${manifest.minAppVersion}`);
}

if (manifest.id.includes("obsidian")) {
	fail("manifest id must not include 'obsidian'");
}

if (manifest.isDesktopOnly !== true) {
	fail("manifest isDesktopOnly should be true because this plugin uses Electron window APIs");
}

if (!process.exitCode) {
	console.log("release:check passed");
}
