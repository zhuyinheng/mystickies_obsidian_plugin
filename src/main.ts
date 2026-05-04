import { Plugin } from "obsidian";
import { DailyNotes } from "./dailyNotes";
import { StickyWindow } from "./stickyWindow";

export default class TodayStickyPlugin extends Plugin {
	dailyNotes!: DailyNotes;
	stickyWindow!: StickyWindow;

	async onload() {
		this.dailyNotes = new DailyNotes(this.app);
		this.stickyWindow = new StickyWindow(this);

		this.addCommand({
			id: "open-today-sticky",
			name: "Open today's sticky window",
			callback: () => {
				void this.stickyWindow.open();
			},
		});

		this.addRibbonIcon("sticky-note", "Open today's sticky", () => {
			void this.stickyWindow.open();
		});

		this.addCommand({
			id: "today-sticky-debug-log",
			name: "[Debug] Log today and most recent previous daily notes",
			callback: async () => {
				const today = await this.dailyNotes.getOrCreateToday();
				const prev = this.dailyNotes.findMostRecentPrevious();
				console.log("[today-sticky]", {
					today: today?.path ?? null,
					previous: prev?.path ?? null,
				});
			},
		});

		this.app.workspace.onLayoutReady(() => {
			void this.stickyWindow.open();
		});
	}

	onunload() {
		this.stickyWindow?.close();
	}
}
