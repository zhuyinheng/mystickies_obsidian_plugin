import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, moment as obsMoment } from "obsidian";
import type { Moment } from "moment";
import {
	appHasDailyNotesPluginLoaded,
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
} from "obsidian-daily-notes-interface";
import { StickyManager } from "./stickyManager";
import { closePopoutLeaf, getPopoutWindow } from "./windowControls";

const moment = obsMoment as unknown as () => Moment;

interface StickySettings {
	/** Last-used inner width of a sticky popout. Applied to the next open. */
	width?: number;
	/** Last-used inner height of a sticky popout. */
	height?: number;
}

export default class MyStickiesPlugin extends Plugin {
	stickies!: StickyManager;
	settings!: StickySettings;
	private saveSizeTimer: number | null = null;

	async onload() {
		this.settings = Object.assign({}, await this.loadData());

		this.stickies = new StickyManager(this);

		this.addCommand({
			id: "open-today",
			name: "Open today's sticky window",
			callback: () => {
				void this.openTodayNoteAsSticky();
			},
		});

		this.addCommand({
			id: "open-current",
			name: "Open current note as sticky",
			checkCallback: (checking) => {
				const file = this.activeMainFile();
				if (!file) return false;
				if (!checking) void this.stickies.openFile(file);
				return true;
			},
		});

		this.addCommand({
			id: "close-all",
			name: "Close all sticky windows",
			callback: () => {
				const n = this.stickies.count();
				this.stickies.closeAll();
				new Notice(`MyStickies: closed ${n} window(s)`);
			},
		});

		this.addRibbonIcon("sticky-note", "Open today's sticky", () => {
			void this.openTodayNoteAsSticky();
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) => {
					item.setTitle("Open as sticky")
						.setIcon("sticky-note")
						.onClick(() => {
							void this.stickies.openFile(file);
						});
				});
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void (async () => {
				this.killOrphanPopouts();
				await this.openTodayNoteAsSticky();
			})();
		});
	}

	onunload() {
		this.stickies?.closeAll();
		this.flushStickySize();
	}

	/**
	 * Remember the size the user just resized a popout to. This updates memory
	 * immediately so the NEXT sticky open can use it, while the disk write is
	 * debounced to avoid saveData churn during drag-resize.
	 */
	rememberStickySize(width: number, height: number): void {
		const size = readSize(width, height);
		if (!size) return;
		if (this.settings.width === size.width && this.settings.height === size.height) return;

		this.settings.width = size.width;
		this.settings.height = size.height;

		if (this.saveSizeTimer !== null) window.clearTimeout(this.saveSizeTimer);
		this.saveSizeTimer = window.setTimeout(() => {
			this.saveSizeTimer = null;
			void this.saveData(this.settings);
		}, 500);
	}

	flushStickySize(): void {
		if (this.saveSizeTimer === null) return;
		window.clearTimeout(this.saveSizeTimer);
		this.saveSizeTimer = null;
		void this.saveData(this.settings);
	}

	getStickySize(): { width: number; height: number } | undefined {
		const saved = readSize(this.settings.width, this.settings.height);
		if (saved) return saved;
		return readCssSize();
	}

	private async openTodayNoteAsSticky(): Promise<void> {
		const file = await this.resolveTodayFile();
		if (!file) {
			new Notice("MyStickies: failed to open today's note.");
			return;
		}
		await this.stickies.openFile(file);
	}

	private async resolveTodayFile(): Promise<TFile | null> {
		if (!appHasDailyNotesPluginLoaded()) return null;
		const today = moment();
		const all = getAllDailyNotes();
		return getDailyNote(today, all) ?? (await createDailyNote(today));
	}

	private activeMainFile(): TFile | null {
		// Prefer the active markdown view's file, but only if it's in a
		// non-popout (root) leaf — opening "current sticky as sticky" is silly.
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		const file = view.file;
		if (!file) return null;
		let isRootLeaf = false;
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (leaf === view.leaf) isRootLeaf = true;
		});
		return isRootLeaf ? file : null;
	}

	/**
	 * Kill popout leaves that survive across Obsidian sessions. Obsidian
	 * persists popout windows in workspace state and restores them at
	 * startup BEFORE our plugin code runs — they come back chrome-less
	 * (no body class, no buttons) and, with traffic lights hidden by us
	 * on subsequent runs, the user has no way to close them.
	 *
	 * This runs once at onLayoutReady, before our manager opens its first
	 * sticky. The manager's map is empty at this point, so any popout we
	 * find is necessarily a session-restored ghost rather than one we
	 * own. Detach the leaf and force-close its BrowserWindow so a fresh,
	 * managed sticky can take over.
	 */
	private killOrphanPopouts(): void {
		const ghosts: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (getPopoutWindow(leaf)) ghosts.push(leaf);
		});
		for (const leaf of ghosts) {
			closePopoutLeaf(leaf);
		}
	}
}

function readSize(width: unknown, height: unknown): { width: number; height: number } | undefined {
	if (typeof width !== "number" || typeof height !== "number") return undefined;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
	return { width, height };
}

function readCssSize(): { width: number; height: number } | undefined {
	const style = window.getComputedStyle(document.body);
	const width = readCssNumber(style, "--mystickies-default-width");
	const height = readCssNumber(style, "--mystickies-default-height");
	return readSize(width, height);
}

function readCssNumber(style: CSSStyleDeclaration, name: string): number | undefined {
	const raw = style.getPropertyValue(name).trim();
	if (!raw) return undefined;
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) ? value : undefined;
}
