import { Notice, TFile, WorkspaceLeaf } from "obsidian";
import type TodayStickyPlugin from "./main";
import {
	configureStickyWindow,
	getBrowserWindowForLeaf,
	getPopoutDocument,
	getPopoutWindow,
	type ElectronBrowserWindow,
} from "./electronWindow";
import { installChrome } from "./chrome";
import { FileTarget, type StickyTarget } from "./stickyTarget";
import type { StickyManager } from "./stickyManager";

const IDLE_OPACITY = 0.5;
const ACTIVE_OPACITY = 1.0;
const OPACITY_FADE_MS = 180;

export class StickyWindow {
	private leaf: WorkspaceLeaf | null = null;
	private bw: ElectronBrowserWindow | null = null;
	private currentFile: TFile | null = null;
	private pinned = true;
	private closing = false;
	/** Cleanups registered by install* methods. Drained LIFO in close(). */
	private cleanups: Array<() => void> = [];

	constructor(
		private plugin: TodayStickyPlugin,
		public readonly target: StickyTarget,
		private manager: StickyManager,
	) {}

	isOpen(): boolean {
		return this.leaf !== null && this.isLeafAttached(this.leaf);
	}

	async open(): Promise<void> {
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
			size: this.plugin.getStickySize(),
		});
		await leaf.openFile(file, { active: true });
		this.leaf = leaf;

		// Allow popout DOM to settle before applying chrome.
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		this.bw = getBrowserWindowForLeaf(leaf);
		configureStickyWindow(this.bw);

		this.installChromeBar(leaf, file.basename);
		this.installPopoutCloseListener(leaf);
		this.installOpacityHover(leaf);
		this.installLinkInterceptor(leaf);
		this.installTitleSuppressor(leaf);
		this.installBodyClassGuard(leaf);
		this.installResizeTracker(leaf);
	}

	focus(): void {
		if (!this.leaf) return;
		this.plugin.app.workspace.setActiveLeaf(this.leaf, { focus: true });
	}

	/**
	 * Tear down the sticky and force-close its BrowserWindow. Re-entrant safe:
	 * bw.close() fires the popout's beforeunload, which triggers close() again
	 * via installPopoutCloseListener — the `closing` flag short-circuits.
	 */
	close(): void {
		if (this.closing) return;
		this.closing = true;

		// LIFO drain so each install's teardown runs in reverse order of setup.
		for (let i = this.cleanups.length - 1; i >= 0; i--) {
			try {
				this.cleanups[i]();
			} catch (e) {
				console.warn("[today-sticky] cleanup failed", e);
			}
		}
		this.cleanups = [];

		// Detach the leaf, then force-close the BrowserWindow. Obsidian 1.12's
		// leaf.detach() does not tear down the popout — without bw.close()
		// it lingers chrome-less and uncloseable.
		const bw = this.bw;
		this.bw = null;
		this.leaf?.detach();
		this.leaf = null;
		if (bw) {
			try {
				bw.close();
			} catch {
				/* already closed */
			}
		}

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

	async openCurrentInMain(): Promise<void> {
		if (!this.currentFile) return;
		await this.openFileInMain(this.currentFile);
	}

	// ------------- install methods (each pushes a cleanup) ----------------

	private installChromeBar(leaf: WorkspaceLeaf, title: string): void {
		const uninstall = installChrome(
			leaf,
			{
				onClose: () => this.close(),
				onTogglePin: () => this.togglePin(),
				onOpenInMain: () => void this.openCurrentInMain(),
			},
			this.pinned,
			title,
		);
		this.cleanups.push(uninstall);
	}

	private installPopoutCloseListener(leaf: WorkspaceLeaf): void {
		const win = getPopoutWindow(leaf);
		if (!win) return;
		const handler = () => this.close();
		win.addEventListener("beforeunload", handler, { once: true });
		// `once: true` makes this self-cleaning; nothing to push.
	}

	private installOpacityHover(leaf: WorkspaceLeaf): void {
		if (!this.bw?.setOpacity) return;
		const popoutWin = getPopoutWindow(leaf);
		if (!popoutWin) return;

		this.bw.setOpacity(IDLE_OPACITY);

		let raf: number | null = null;
		let target = IDLE_OPACITY;
		let value = IDLE_OPACITY;
		const animateTo = (next: number) => {
			target = next;
			if (raf !== null) return;
			const start = performance.now();
			const from = value;
			const tick = () => {
				if (!this.bw?.setOpacity) {
					raf = null;
					return;
				}
				const t = Math.min(1, (performance.now() - start) / OPACITY_FADE_MS);
				const eased = t * t * (3 - 2 * t);
				value = from + (target - from) * eased;
				try {
					this.bw.setOpacity(value);
				} catch {
					/* */
				}
				if (t < 1) {
					raf = popoutWin.requestAnimationFrame(tick);
				} else {
					raf = null;
					if (target !== value) animateTo(target);
				}
			};
			raf = popoutWin.requestAnimationFrame(tick);
		};

		const onEnter = () => animateTo(ACTIVE_OPACITY);
		const onLeave = () => animateTo(IDLE_OPACITY);
		const root = popoutWin.document.documentElement;
		root.addEventListener("mouseenter", onEnter);
		root.addEventListener("mouseleave", onLeave);
		popoutWin.addEventListener("focus", onEnter);
		popoutWin.addEventListener("blur", onLeave);

		this.cleanups.push(() => {
			if (raf !== null) {
				try {
					popoutWin.cancelAnimationFrame(raf);
				} catch {
					/* */
				}
				raf = null;
			}
			try {
				root.removeEventListener("mouseenter", onEnter);
				root.removeEventListener("mouseleave", onLeave);
				popoutWin.removeEventListener("focus", onEnter);
				popoutWin.removeEventListener("blur", onLeave);
				this.bw?.setOpacity?.(1.0);
			} catch {
				/* window may be torn down */
			}
		});
	}

	/**
	 * Intercept clicks inside the popout that would otherwise navigate. Both
	 * inline `[[wiki]]` links AND `![[embed]]` titles/icons are redirected:
	 *  - plain click  → open in the main Obsidian window
	 *  - cmd/ctrl+click → spawn a new sticky for the linked file
	 * The sticky's leaf never changes file as a side effect of clicking.
	 */
	private installLinkInterceptor(leaf: WorkspaceLeaf): void {
		const doc = getPopoutDocument(leaf);
		if (!doc) return;
		const handler = (ev: MouseEvent) => {
			const target = ev.target as HTMLElement | null;
			if (!target) return;
			const linktext = this.extractClickedLinktext(target);
			if (!linktext) return;
			if (/^[a-z][a-z0-9+.-]*:\/\//i.test(linktext) && !linktext.startsWith("obsidian://")) return;

			ev.preventDefault();
			ev.stopImmediatePropagation();
			if (ev.metaKey || ev.ctrlKey) {
				void this.openLinkAsSticky(linktext);
			} else {
				void this.openLinkInMain(linktext);
			}
		};
		doc.addEventListener("click", handler, true);
		doc.addEventListener("auxclick", handler, true);
		this.cleanups.push(() => {
			doc.removeEventListener("click", handler, true);
			doc.removeEventListener("auxclick", handler, true);
		});
	}

	private extractClickedLinktext(target: HTMLElement): string | null {
		// Embed title / link icon → climb to wrapping embed and read its src.
		const embedTrigger = target.closest(".markdown-embed-title, .markdown-embed-link") as HTMLElement | null;
		if (embedTrigger) {
			const embedWrap = embedTrigger.closest(".markdown-embed, .internal-embed") as HTMLElement | null;
			const src = embedWrap?.getAttribute("src") ?? embedWrap?.getAttribute("alt");
			if (src) return src;
		}
		// Plain wiki / internal link.
		const link = target.closest("a.internal-link, a[data-href], .cm-hmd-internal-link") as HTMLElement | null;
		if (link) {
			return link.getAttribute("data-href")
				|| link.getAttribute("href")
				|| (link.textContent ?? "").trim()
				|| null;
		}
		return null;
	}

	private resolveLinkText(linktext: string): TFile | null {
		const sourcePath = this.currentFile?.path ?? "";
		return this.plugin.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
	}

	private async openFileInMain(file: TFile): Promise<void> {
		const mainLeaves: WorkspaceLeaf[] = [];
		this.plugin.app.workspace.iterateRootLeaves((l) => mainLeaves.push(l));
		const mainLeaf = mainLeaves[0];
		if (!mainLeaf) {
			new Notice("Today's Note Sticky: no main Obsidian leaf available.");
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

	private async openLinkInMain(linktext: string): Promise<void> {
		const file = this.resolveLinkText(linktext);
		if (!file) {
			new Notice(`Today's Note Sticky: cannot resolve link "${linktext}"`);
			return;
		}
		await this.openFileInMain(file);
	}

	private async openLinkAsSticky(linktext: string): Promise<void> {
		const file = this.resolveLinkText(linktext);
		if (!file) {
			new Notice(`Today's Note Sticky: cannot resolve link "${linktext}"`);
			return;
		}
		await this.manager.openTarget(new FileTarget(file.path));
	}

	/** Suppress the OS title bar text — Obsidian rewrites it on every file change. */
	private installTitleSuppressor(leaf: WorkspaceLeaf): void {
		const doc = getPopoutDocument(leaf);
		const titleEl = doc?.querySelector("title");
		if (!titleEl) return;
		titleEl.textContent = "";
		const obs = new MutationObserver(() => {
			if (titleEl.textContent) titleEl.textContent = "";
		});
		obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
		this.cleanups.push(() => obs.disconnect());
	}

	/** Re-add `today-sticky-popout` to the popout body if Obsidian removes it
	 *  during a layout transition (e.g. resize). */
	private installBodyClassGuard(leaf: WorkspaceLeaf): void {
		const doc = getPopoutDocument(leaf);
		if (!doc) return;
		const ensure = () => {
			if (!doc.body.classList.contains("today-sticky-popout")) {
				doc.body.classList.add("today-sticky-popout");
			}
		};
		ensure();
		const obs = new MutationObserver(ensure);
		obs.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
		this.cleanups.push(() => obs.disconnect());
	}

	/** Persist popout's last innerWidth/innerHeight (debounced) so the next
	 *  new sticky opens at the same size. */
	private installResizeTracker(leaf: WorkspaceLeaf): void {
		const popoutWin = getPopoutWindow(leaf);
		if (!popoutWin) return;
		let timer: number | null = null;
		const handler = () => {
			if (timer !== null) popoutWin.clearTimeout(timer);
			timer = popoutWin.setTimeout(() => {
				timer = null;
				const w = popoutWin.innerWidth;
				const h = popoutWin.innerHeight;
				if (w > 0 && h > 0) void this.plugin.saveStickySize(w, h);
			}, 500);
		};
		popoutWin.addEventListener("resize", handler);
		this.cleanups.push(() => {
			if (timer !== null) {
				try {
					popoutWin.clearTimeout(timer);
				} catch {
					/* */
				}
			}
			try {
				popoutWin.removeEventListener("resize", handler);
			} catch {
				/* */
			}
		});
	}

	private isLeafAttached(leaf: WorkspaceLeaf): boolean {
		let found = false;
		this.plugin.app.workspace.iterateAllLeaves((l) => {
			if (l === leaf) found = true;
		});
		return found;
	}
}
