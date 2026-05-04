import { TFile } from "obsidian";
import type MyStickiesPlugin from "./main";
import { StickyWindow } from "./stickyWindow";

export class StickyManager {
	private sticks = new Map<string, StickyWindow>();

	constructor(private plugin: MyStickiesPlugin) {}

	async openFile(file: TFile): Promise<void> {
		const existing = this.sticks.get(file.path);
		if (existing) {
			if (existing.isOpen()) existing.focus();
			return;
		}
		const sw = new StickyWindow(this.plugin, file, this);
		this.sticks.set(file.path, sw);
		try {
			await sw.open();
		} catch (e) {
			this.sticks.delete(file.path);
			throw e;
		}
	}

	unregister(file: TFile): void {
		this.sticks.delete(file.path);
	}

	closeAll(): void {
		for (const s of Array.from(this.sticks.values())) s.close();
		this.sticks.clear();
	}

	count(): number {
		return this.sticks.size;
	}
}
