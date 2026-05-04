import { App, TFile, moment as obsMoment } from "obsidian";
import type { Moment } from "moment";
import {
	appHasDailyNotesPluginLoaded,
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
} from "obsidian-daily-notes-interface";

type MomentFn = () => Moment;
const moment: MomentFn = obsMoment as unknown as MomentFn;

export class DailyNotes {
	constructor(private app: App) {}

	ensureLoaded(): boolean {
		return appHasDailyNotesPluginLoaded();
	}

	async getOrCreateToday(): Promise<TFile | null> {
		if (!this.ensureLoaded()) return null;
		const today = moment();
		const all = getAllDailyNotes();
		const existing = getDailyNote(today, all);
		if (existing) return existing;
		return await createDailyNote(today);
	}
}
