import { moment as obsMoment } from "obsidian";
import type { Moment } from "moment";

type MomentFn = (input?: string | number | Date | Moment) => Moment;
const moment: MomentFn = obsMoment as unknown as MomentFn;

const ROLLOVER_GRACE_SECONDS = 5;

export class MidnightScheduler {
	private timer: number | null = null;
	private lastSeenDate: string;
	private destroyed = false;
	private focusHandlers: Array<{ win: Window; handler: () => void }> = [];

	constructor(private onRollover: () => void | Promise<void>) {
		this.lastSeenDate = moment().format("YYYY-MM-DD");
	}

	start(): void {
		this.scheduleNext();
	}

	attachFocusGuard(win: Window): void {
		const handler = () => {
			void this.checkDate();
		};
		win.addEventListener("focus", handler);
		this.focusHandlers.push({ win, handler });
	}

	destroy(): void {
		this.destroyed = true;
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		for (const { win, handler } of this.focusHandlers) {
			try {
				win.removeEventListener("focus", handler);
			} catch {
				/* window may already be gone */
			}
		}
		this.focusHandlers = [];
	}

	/** Force a rollover check now; useful for debug commands and manual triggers. */
	async checkNow(): Promise<void> {
		await this.checkDate();
	}

	private scheduleNext(): void {
		if (this.destroyed) return;
		if (this.timer !== null) window.clearTimeout(this.timer);
		const now = moment();
		const nextMidnight = now.clone().add(1, "day").startOf("day").add(ROLLOVER_GRACE_SECONDS, "seconds");
		const ms = nextMidnight.diff(now);
		this.timer = window.setTimeout(() => {
			void this.fire();
		}, ms);
	}

	private async fire(): Promise<void> {
		if (this.destroyed) return;
		this.timer = null;
		await this.checkDate();
		this.scheduleNext();
	}

	private async checkDate(): Promise<void> {
		const today = moment().format("YYYY-MM-DD");
		if (today === this.lastSeenDate) return;
		this.lastSeenDate = today;
		try {
			await this.onRollover();
		} catch (e) {
			console.error("[today-sticky] rollover failed", e);
		}
	}
}
