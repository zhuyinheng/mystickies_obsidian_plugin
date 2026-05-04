import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DailyNotes } from "./dailyNotes";
import { StickyManager } from "./stickyManager";
import { FileTarget } from "./stickyTarget";
import { getBrowserWindowForLeaf } from "./electronWindow";

export default class TodayStickyPlugin extends Plugin {
	dailyNotes!: DailyNotes;
	stickies!: StickyManager;

	async onload() {
		this.dailyNotes = new DailyNotes(this.app);
		this.stickies = new StickyManager(this);

		this.addCommand({
			id: "open-today-sticky",
			name: "Open today's sticky window",
			callback: () => {
				void this.stickies.openToday();
			},
		});

		this.addCommand({
			id: "open-current-as-sticky",
			name: "Open current note as sticky",
			checkCallback: (checking) => {
				const file = this.activeMainFile();
				if (!file) return false;
				if (!checking) void this.stickies.openFile(file);
				return true;
			},
		});

		this.addCommand({
			id: "close-all-stickies",
			name: "Close all sticky windows",
			callback: () => {
				const n = this.stickies.count();
				this.stickies.closeAll();
				new Notice(`Today's Note Sticky: closed ${n} window(s)`);
			},
		});

		this.addRibbonIcon("sticky-note", "Open today's sticky", () => {
			void this.stickies.openToday();
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) => {
					item.setTitle("Open as sticky")
						.setIcon("sticky-note")
						.onClick(() => {
							void this.stickies.openTarget(new FileTarget(file.path));
						});
				});
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void (async () => {
				this.killOrphanPopouts();
				await this.stickies.openToday();
			})();
		});
	}

	onunload() {
		this.stickies?.closeAll();
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
			const container = (leaf as unknown as { getContainer?: () => { win?: Window } }).getContainer?.();
			const popoutWin = container?.win;
			if (popoutWin && popoutWin !== window) ghosts.push(leaf);
		});
		for (const leaf of ghosts) {
			const bw = getBrowserWindowForLeaf(leaf);
			leaf.detach();
			try {
				bw?.close();
			} catch {
				/* already gone */
			}
		}
	}
}
