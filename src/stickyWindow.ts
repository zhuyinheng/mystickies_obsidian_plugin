import { Notice, TAbstractFile, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type TodayStickyPlugin from "./main";
import {
	configureStickyWindow,
	getBrowserWindowForLeaf,
	getPopoutWindow,
	type ElectronBrowserWindow,
} from "./electronWindow";
import { ChromeHandle, installChrome } from "./chrome";
import { PreviousOverlay } from "./previousOverlay";
import { MidnightScheduler } from "./midnight";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";

export class StickyWindow {
	private leaf: WorkspaceLeaf | null = null;
	private bw: ElectronBrowserWindow | null = null;
	private chrome: ChromeHandle | null = null;
	private overlay: PreviousOverlay | null = null;
	private midnight: MidnightScheduler | null = null;
	private pinned = true;
	private vaultEvtUnregister: Array<() => void> = [];
	private rerenderOverlay = debounce(() => void this.refreshOverlay(), 150, true);

	constructor(private plugin: TodayStickyPlugin) {}

	async open(): Promise<void> {
		if (!this.plugin.dailyNotes.ensureLoaded()) {
			new Notice("Today's Note Sticky: enable the core Daily Notes plugin first.");
			return;
		}

		if (this.leaf && this.isLeafAttached(this.leaf)) {
			this.focus();
			return;
		}

		const today = await this.plugin.dailyNotes.getOrCreateToday();
		if (!today) {
			new Notice("Today's Note Sticky: failed to get or create today's daily note.");
			return;
		}

		const leaf = this.plugin.app.workspace.openPopoutLeaf({
			size: { width: 480, height: 720 },
		});
		await leaf.openFile(today, { active: true });
		this.leaf = leaf;

		// Allow popout DOM to settle before applying chrome / overlay.
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		this.bw = getBrowserWindowForLeaf(leaf);
		this.pinned = true;
		configureStickyWindow(this.bw, {
			alwaysOnTop: true,
			visibleOnAllWorkspaces: true,
			vibrancy: true,
			hideTrafficLights: true,
		});

		this.chrome = installChrome(
			leaf,
			{
				onMinimize: () => this.bw?.minimize(),
				onClose: () => this.close(),
				onTogglePin: () => this.togglePin(),
			},
			this.pinned,
		);

		this.overlay = new PreviousOverlay(this.plugin.app, leaf);
		this.plugin.addChild(this.overlay);
		if (this.overlay.install()) {
			await this.refreshOverlay();
		}

		this.installVaultListeners();
		this.installPopoutCloseListener();
		this.installMidnightScheduler();
	}

	async rollover(): Promise<void> {
		if (!this.leaf || !this.isLeafAttached(this.leaf)) return;
		const newToday = await this.plugin.dailyNotes.getOrCreateToday();
		if (!newToday) return;
		await this.leaf.openFile(newToday, { active: true });

		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		if (this.overlay) {
			this.overlay.uninstall();
			if (this.overlay.install()) {
				await this.refreshOverlay();
			}
		}
	}

	focus(): void {
		if (!this.leaf) return;
		this.plugin.app.workspace.setActiveLeaf(this.leaf, { focus: true });
	}

	close(): void {
		this.midnight?.destroy();
		this.midnight = null;
		this.uninstallVaultListeners();
		if (this.overlay) {
			this.overlay.uninstall();
			this.plugin.removeChild(this.overlay);
			this.overlay = null;
		}
		this.chrome?.uninstall();
		this.chrome = null;
		this.leaf?.detach();
		this.leaf = null;
		this.bw = null;
	}

	togglePin(): boolean {
		if (!this.bw) return this.pinned;
		this.pinned = !this.pinned;
		try {
			this.bw.setAlwaysOnTop(this.pinned, "floating");
		} catch (e) {
			console.warn("[today-sticky] togglePin failed", e);
		}
		return this.pinned;
	}

	private async refreshOverlay(): Promise<void> {
		if (!this.overlay) return;
		const prev = this.plugin.dailyNotes.findMostRecentPrevious();
		await this.overlay.render(prev);
	}

	private installVaultListeners(): void {
		const settings = getDailyNoteSettings();
		const folder = (settings.folder ?? "").replace(/^\/|\/$/g, "");
		const inDailyFolder = (path: string): boolean => {
			if (!folder) return true;
			return path === folder || path.startsWith(folder + "/");
		};

		const onChange = (file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			if (!inDailyFolder(file.path)) return;
			this.rerenderOverlay();
		};
		const onRename = (file: TAbstractFile, oldPath: string) => {
			if (!(file instanceof TFile)) return;
			if (!inDailyFolder(file.path) && !inDailyFolder(oldPath)) return;
			this.rerenderOverlay();
		};

		const vault = this.plugin.app.vault;
		const refCreate = vault.on("create", onChange);
		const refDelete = vault.on("delete", onChange);
		const refRename = vault.on("rename", onRename);
		this.vaultEvtUnregister = [
			() => vault.offref(refCreate),
			() => vault.offref(refDelete),
			() => vault.offref(refRename),
		];
	}

	private uninstallVaultListeners(): void {
		for (const off of this.vaultEvtUnregister) off();
		this.vaultEvtUnregister = [];
	}

	private installPopoutCloseListener(): void {
		const win = this.leaf ? getPopoutWindow(this.leaf) : null;
		if (!win) return;
		const handler = () => this.close();
		win.addEventListener("beforeunload", handler, { once: true });
	}

	private installMidnightScheduler(): void {
		this.midnight = new MidnightScheduler(() => this.rollover());
		this.midnight.start();
		const popoutWin = this.leaf ? getPopoutWindow(this.leaf) : null;
		if (popoutWin) this.midnight.attachFocusGuard(popoutWin);
		this.midnight.attachFocusGuard(window);
	}

	private isLeafAttached(leaf: WorkspaceLeaf): boolean {
		let found = false;
		this.plugin.app.workspace.iterateAllLeaves((l) => {
			if (l === leaf) found = true;
		});
		return found;
	}
}
