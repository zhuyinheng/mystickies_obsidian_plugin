import { App, TFile, moment as obsMoment } from "obsidian";
import type { Moment } from "moment";
import {
	appHasDailyNotesPluginLoaded,
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
} from "obsidian-daily-notes-interface";

type MomentFn = (input?: string | number | Date | Moment) => Moment;
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

	findMostRecentPrevious(reference: Moment = moment()): TFile | null {
		if (!this.ensureLoaded()) return null;
		const all = getAllDailyNotes();
		let best: { date: Moment; file: TFile } | null = null;
		for (const [uid, file] of Object.entries(all)) {
			const iso = uid.replace(/^day-/, "");
			const d = moment(iso);
			if (!d.isValid() || !d.isBefore(reference, "day")) continue;
			if (!best || d.isAfter(best.date)) best = { date: d, file };
		}
		return best?.file ?? null;
	}
}
