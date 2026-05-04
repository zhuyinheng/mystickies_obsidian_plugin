import { App, TFile } from "obsidian";
import type { DailyNotes } from "./dailyNotes";

export interface StickyTarget {
	/** Stable key used by the manager for dedup. */
	readonly key: string;
	/** Resolve to the file this sticky should currently display. */
	resolve(app: App): Promise<TFile | null>;
}

export class TodayTarget implements StickyTarget {
	readonly key = "@today";

	constructor(private dailyNotes: DailyNotes) {}

	resolve(): Promise<TFile | null> {
		return this.dailyNotes.getOrCreateToday();
	}
}

export class FileTarget implements StickyTarget {
	constructor(public filePath: string) {}

	get key(): string {
		return `file:${this.filePath}`;
	}

	async resolve(app: App): Promise<TFile | null> {
		const f = app.vault.getAbstractFileByPath(this.filePath);
		return f instanceof TFile ? f : null;
	}
}
