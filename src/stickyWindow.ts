import { MarkdownView, Notice, TAbstractFile, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type TodayStickyPlugin from "./main";
import {
	configureStickyWindow,
	getBrowserWindowForLeaf,
	getPopoutDocument,
	getPopoutWindow,
	type ElectronBrowserWindow,
} from "./electronWindow";
import { ChromeHandle, installChrome } from "./chrome";
import { PreviousOverlay } from "./previousOverlay";
import { MidnightScheduler } from "./midnight";
import { getDailyNoteSettings } from "obsidian-daily-notes-interface";
import { FileTarget, type StickyTarget } from "./stickyTarget";
import type { StickyManager } from "./stickyManager";

const IDLE_OPACITY = 0.5;
const ACTIVE_OPACITY = 1.0;
const OPACITY_FADE_MS = 180;
const COLLAPSED_HEIGHT = 60;

export class StickyWindow {
	private leaf: WorkspaceLeaf | null = null;
	private bw: ElectronBrowserWindow | null = null;
	private chrome: ChromeHandle | null = null;
	private overlay: PreviousOverlay | null = null;
	private midnight: MidnightScheduler | null = null;
	private currentFile: TFile | null = null;
	private pinned = true;
	private collapsed = false;
	private expandedBounds: { x: number; y: number; width: number; height: number } | null = null;
	private vaultEvtUnregister: Array<() => void> = [];
	private rerenderOverlay = debounce(() => void this.refreshOverlay(), 150, true);
	private opacityCleanup: (() => void) | null = null;
	private opacityRaf: number | null = null;
	private linkInterceptCleanup: (() => void) | null = null;
	private titleObserver: MutationObserver | null = null;

	constructor(
		private plugin: TodayStickyPlugin,
		public readonly target: StickyTarget,
		private manager: StickyManager,
	) {}

	isOpen(): boolean {
		return this.leaf !== null && this.isLeafAttached(this.leaf);
	}

	async open(): Promise<void> {
		if (this.target.trackDate && !this.plugin.dailyNotes.ensureLoaded()) {
			new Notice("Today's Note Sticky: enable the core Daily Notes plugin first.");
			return;
		}

		if (this.leaf && this.isLeafAttached(this.leaf)) {
			this.focus();
			return;
		}

		const file = await this.target.resolve(this.plugin.app);
		if (!file) {
			new Notice("Today's Note Sticky: failed to resolve target file.");
			return;
		}
		this.currentFile = file;

		const leaf = this.plugin.app.workspace.openPopoutLeaf({
			size: { width: 480, height: 720 },
		});
		await leaf.openFile(file, { active: true });
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
				onToggleCollapse: () => this.toggleCollapse(),
				onClose: () => this.close(),
				onTogglePin: () => this.togglePin(),
			},
			this.pinned,
		);

		if (this.target.trackDate) {
			this.overlay = new PreviousOverlay(this.plugin.app, leaf);
			this.plugin.addChild(this.overlay);
			if (this.overlay.install()) {
				await this.refreshOverlay();
			}
			this.installVaultListeners();
			this.installMidnightScheduler();
		}

		this.installPopoutCloseListener();
		this.installOpacityHover(leaf);
		this.installLinkInterceptor(leaf);
		this.installTitleSuppressor(leaf);
	}

	async rollover(): Promise<void> {
		if (!this.target.trackDate) return;
		if (!this.leaf || !this.isLeafAttached(this.leaf)) return;
		const newFile = await this.target.resolve(this.plugin.app);
		if (!newFile) return;
		this.currentFile = newFile;
		await this.leaf.openFile(newFile, { active: true });

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
		if (this.opacityRaf !== null) {
			window.cancelAnimationFrame(this.opacityRaf);
			this.opacityRaf = null;
		}
		this.opacityCleanup?.();
		this.opacityCleanup = null;
		this.linkInterceptCleanup?.();
		this.linkInterceptCleanup = null;
		this.titleObserver?.disconnect();
		this.titleObserver = null;
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
		this.currentFile = null;
		this.manager.unregister(this.target);
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

	toggleCollapse(): boolean {
		if (!this.bw) return this.collapsed;
		this.collapsed = !this.collapsed;
		try {
			if (this.collapsed) {
				this.expandedBounds = this.bw.getBounds();
				this.bw.setBounds({ height: COLLAPSED_HEIGHT });
				// Window resize alone does not re-position CodeMirror's
				// scroll. Pull the cursor line into the new tiny viewport.
				this.scrollCursorIntoView();
			} else if (this.expandedBounds) {
				this.bw.setBounds({ height: this.expandedBounds.height });
				this.expandedBounds = null;
			}
		} catch (e) {
			console.warn("[today-sticky] toggleCollapse failed", e);
		}
		this.chrome?.setCollapsed(this.collapsed);
		return this.collapsed;
	}

	private scrollCursorIntoView(): void {
		const view = this.leaf?.view;
		if (!(view instanceof MarkdownView) || !view.editor) return;
		try {
			const cursor = view.editor.getCursor();
			view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
		} catch (e) {
			console.warn("[today-sticky] scrollCursorIntoView failed", e);
		}
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

	private installOpacityHover(leaf: WorkspaceLeaf): void {
		if (!this.bw?.setOpacity) return;
		const popoutWin = getPopoutWindow(leaf);
		if (!popoutWin) return;

		this.bw.setOpacity(IDLE_OPACITY);

		let currentTarget = IDLE_OPACITY;
		let currentValue = IDLE_OPACITY;
		const animateTo = (target: number) => {
			currentTarget = target;
			if (this.opacityRaf !== null) return;
			const start = performance.now();
			const from = currentValue;
			const tick = () => {
				if (!this.bw?.setOpacity) {
					this.opacityRaf = null;
					return;
				}
				const elapsed = performance.now() - start;
				const t = Math.min(1, elapsed / OPACITY_FADE_MS);
				const eased = t * t * (3 - 2 * t);
				const value = from + (currentTarget - from) * eased;
				currentValue = value;
				try {
					this.bw.setOpacity(value);
				} catch {
					/* swallow */
				}
				if (t < 1) {
					this.opacityRaf = popoutWin.requestAnimationFrame(tick);
				} else {
					this.opacityRaf = null;
					if (currentTarget !== currentValue) animateTo(currentTarget);
				}
			};
			this.opacityRaf = popoutWin.requestAnimationFrame(tick);
		};

		const onEnter = () => animateTo(ACTIVE_OPACITY);
		const onLeave = () => animateTo(IDLE_OPACITY);
		const onFocus = () => animateTo(ACTIVE_OPACITY);
		const onBlur = () => animateTo(IDLE_OPACITY);

		const root = popoutWin.document.documentElement;
		root.addEventListener("mouseenter", onEnter);
		root.addEventListener("mouseleave", onLeave);
		popoutWin.addEventListener("focus", onFocus);
		popoutWin.addEventListener("blur", onBlur);

		this.opacityCleanup = () => {
			try {
				root.removeEventListener("mouseenter", onEnter);
				root.removeEventListener("mouseleave", onLeave);
				popoutWin.removeEventListener("focus", onFocus);
				popoutWin.removeEventListener("blur", onBlur);
				this.bw?.setOpacity?.(1.0);
			} catch {
				/* */
			}
		};
	}

	/**
	 * Intercept clicks on internal links inside the popout. The sticky never
	 * navigates to a new file in-place; instead:
	 *   - plain click  → open in the main Obsidian window (focuses it)
	 *   - cmd/ctrl+click → spawn a NEW sticky window for that link
	 */
	private installLinkInterceptor(leaf: WorkspaceLeaf): void {
		const doc = getPopoutDocument(leaf);
		if (!doc) return;

		const handler = (ev: MouseEvent) => {
			const target = ev.target as HTMLElement | null;
			if (!target) return;

			const link = target.closest(
				"a.internal-link, a[data-href], .cm-hmd-internal-link, .cm-link-alias, .cm-formatting-link, span.cm-underline",
			) as HTMLElement | null;
			if (!link) return;

			const href = link.getAttribute("data-href")
				|| link.getAttribute("href")
				|| (link.textContent ?? "").trim();
			if (!href) return;

			// External http(s) links should fall through to default behavior.
			if (/^[a-z][a-z0-9+.-]*:\/\//i.test(href) && !href.startsWith("obsidian://")) return;

			ev.preventDefault();
			ev.stopImmediatePropagation();

			const newSticky = ev.metaKey || ev.ctrlKey;
			if (newSticky) {
				void this.openLinkAsSticky(href);
			} else {
				void this.openLinkInMain(href);
			}
		};

		doc.addEventListener("click", handler, true);
		doc.addEventListener("auxclick", handler, true);
		this.linkInterceptCleanup = () => {
			doc.removeEventListener("click", handler, true);
			doc.removeEventListener("auxclick", handler, true);
		};
	}

	private resolveLinkText(linktext: string): TFile | null {
		const sourcePath = this.currentFile?.path ?? "";
		return this.plugin.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
	}

	private async openLinkInMain(linktext: string): Promise<void> {
		const file = this.resolveLinkText(linktext);
		if (!file) {
			new Notice(`Today's Note Sticky: cannot resolve link "${linktext}"`);
			return;
		}
		const mainLeaves: WorkspaceLeaf[] = [];
		this.plugin.app.workspace.iterateRootLeaves((l) => {
			mainLeaves.push(l);
		});
		const mainLeaf = mainLeaves[0];
		if (!mainLeaf) {
			new Notice("Today's Note Sticky: no main Obsidian leaf to open link in.");
			return;
		}
		await mainLeaf.openFile(file);
		this.plugin.app.workspace.setActiveLeaf(mainLeaf, { focus: true });
		try {
			window.focus();
		} catch {
			/* */
		}
	}

	private async openLinkAsSticky(linktext: string): Promise<void> {
		const file = this.resolveLinkText(linktext);
		if (!file) {
			new Notice(`Today's Note Sticky: cannot resolve link "${linktext}"`);
			return;
		}
		await this.manager.openTarget(new FileTarget(file.path));
	}

	/**
	 * Keep the OS title bar text empty so the popout reads as a true sticky
	 * tile. Obsidian writes "<file> - <vault> - Obsidian" into document.title
	 * on every file change; we observe and reset.
	 */
	private installTitleSuppressor(leaf: WorkspaceLeaf): void {
		const doc = getPopoutDocument(leaf);
		if (!doc) return;
		const titleEl = doc.querySelector("title");
		if (!titleEl) return;
		titleEl.textContent = "";
		const obs = new MutationObserver(() => {
			if (titleEl.textContent && titleEl.textContent.length > 0) {
				titleEl.textContent = "";
			}
		});
		obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
		this.titleObserver = obs;
	}

	private isLeafAttached(leaf: WorkspaceLeaf): boolean {
		let found = false;
		this.plugin.app.workspace.iterateAllLeaves((l) => {
			if (l === leaf) found = true;
		});
		return found;
	}
}
