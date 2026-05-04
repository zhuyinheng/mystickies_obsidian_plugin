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

	/**
	 * Open a sticky for `target`, deduplicated by target.key. If a sticky for
	 * the key already exists in the map (whether already opened OR still
	 * mid-open from a concurrent call), do NOT create another one — focus the
	 * existing if it's already attached. The map insert happens BEFORE the
	 * async open() so a second concurrent call sees it; this is what prevents
	 * the "two popouts, one orphan" race.
	 */
	async openTarget(target: StickyTarget): Promise<void> {
		const existing = this.sticks.get(target.key);
		if (existing) {
			if (existing.isOpen()) existing.focus();
			return;
		}
		const sw = new StickyWindow(this.plugin, target, this);
		this.sticks.set(target.key, sw);
		try {
			await sw.open();
		} catch (e) {
			// open() failed before reaching the point where it owns the popout
			// — drop the entry so a future call can retry.
			this.sticks.delete(target.key);
			throw e;
		}
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
