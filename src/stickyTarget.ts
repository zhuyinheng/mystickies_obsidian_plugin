import { App, TFile, moment as obsMoment } from "obsidian";
import type { Moment } from "moment";
import {
	appHasDailyNotesPluginLoaded,
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
} from "obsidian-daily-notes-interface";

const moment = obsMoment as unknown as () => Moment;

export interface StickyTarget {
	/** Stable key used by the manager for dedup. */
	readonly key: string;
	/** Resolve to the file this sticky should currently display. */
	resolve(app: App): Promise<TFile | null>;
}

/**
 * Resolves to today's daily note. Auto-creates it from the Daily Notes
 * core plugin's template if it does not yet exist. The only "specialness"
 * still attached to today is this auto-create on first access — the popout
 * itself behaves identically to any FileTarget once the file is resolved.
 */
export class TodayTarget implements StickyTarget {
	readonly key = "@today";

	async resolve(): Promise<TFile | null> {
		if (!appHasDailyNotesPluginLoaded()) return null;
		const today = moment();
		const all = getAllDailyNotes();
		return getDailyNote(today, all) ?? (await createDailyNote(today));
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
