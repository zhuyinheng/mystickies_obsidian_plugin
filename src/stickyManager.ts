import { TFile } from "obsidian";
import type TodayStickyPlugin from "./main";
import { StickyWindow } from "./stickyWindow";
import { FileTarget, TodayTarget, type StickyTarget } from "./stickyTarget";

export class StickyManager {
	private sticks = new Map<string, StickyWindow>();

	constructor(private plugin: TodayStickyPlugin) {}

	async openToday(): Promise<void> {
		await this.openTarget(new TodayTarget(this.plugin.dailyNotes));
	}

	async openFile(file: TFile): Promise<void> {
		await this.openTarget(new FileTarget(file.path));
	}

	async openTarget(target: StickyTarget): Promise<void> {
		const existing = this.sticks.get(target.key);
		if (existing && existing.isOpen()) {
			existing.focus();
			return;
		}
		if (existing) this.sticks.delete(target.key);
		const sw = new StickyWindow(this.plugin, target, this);
		this.sticks.set(target.key, sw);
		await sw.open();
	}

	unregister(target: StickyTarget): void {
		this.sticks.delete(target.key);
	}

	closeAll(): void {
		for (const s of Array.from(this.sticks.values())) s.close();
		this.sticks.clear();
	}

	count(): number {
		return this.sticks.size;
	}
}
