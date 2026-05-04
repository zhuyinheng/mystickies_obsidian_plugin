import { Notice, TFile, WorkspaceLeaf } from "obsidian";
import type TodayStickyPlugin from "./main";
import {
	configureStickyWindow,
	getBrowserWindowForLeaf,
	getPopoutDocument,
	getPopoutWindow,
	type ElectronBrowserWindow,
} from "./electronWindow";
import { ChromeHandle, installChrome } from "./chrome";
import { FileTarget, type StickyTarget } from "./stickyTarget";
import type { StickyManager } from "./stickyManager";

const IDLE_OPACITY = 0.5;
const ACTIVE_OPACITY = 1.0;
const OPACITY_FADE_MS = 180;

export class StickyWindow {
	private leaf: WorkspaceLeaf | null = null;
	private bw: ElectronBrowserWindow | null = null;
	private chrome: ChromeHandle | null = null;
	private currentFile: TFile | null = null;
	private pinned = true;
	private opacityCleanup: (() => void) | null = null;
	private opacityRaf: number | null = null;
	private linkInterceptCleanup: (() => void) | null = null;
	private titleObserver: MutationObserver | null = null;
	private bodyClassObserver: MutationObserver | null = null;

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
			size: { width: 480, height: 720 },
		});
		await leaf.openFile(file, { active: true });
		this.leaf = leaf;

		// Allow popout DOM to settle before applying chrome.
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		this.bw = getBrowserWindowForLeaf(leaf);
		this.pinned = true;
		configureStickyWindow(this.bw, {
			alwaysOnTop: true,
			visibleOnAllWorkspaces: true,
			hideTrafficLights: true,
		});

		this.chrome = installChrome(
			leaf,
			{
				onClose: () => this.close(),
				onTogglePin: () => this.togglePin(),
				onOpenInMain: () => void this.openCurrentInMain(),
			},
			this.pinned,
			file.basename,
		);

		this.installPopoutCloseListener();
		this.installOpacityHover(leaf);
		this.installLinkInterceptor(leaf);
		this.installTitleSuppressor(leaf);
		this.installBodyClassGuard(leaf);
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
		this.bodyClassObserver?.disconnect();
		this.bodyClassObserver = null;
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

	async openCurrentInMain(): Promise<void> {
		if (!this.currentFile) return;
		await this.openFileInMain(this.currentFile);
	}

	private installPopoutCloseListener(): void {
		const win = this.leaf ? getPopoutWindow(this.leaf) : null;
		if (!win) return;
		const handler = () => this.close();
		win.addEventListener("beforeunload", handler, { once: true });
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
	 * Intercept clicks inside the popout that would otherwise navigate. Both
	 * inline `[[wiki]]` links AND `![[embed]]` embed titles/icons are
	 * redirected: plain click → main Obsidian window, cmd/ctrl click → new
	 * sticky window. The sticky's own leaf never changes file as a side
	 * effect of clicking.
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

			const newSticky = ev.metaKey || ev.ctrlKey;
			if (newSticky) {
				void this.openLinkAsSticky(linktext);
			} else {
				void this.openLinkInMain(linktext);
			}
		};

		doc.addEventListener("click", handler, true);
		doc.addEventListener("auxclick", handler, true);
		this.linkInterceptCleanup = () => {
			doc.removeEventListener("click", handler, true);
			doc.removeEventListener("auxclick", handler, true);
		};
	}

	/**
	 * Returns the link path string for a click target, or null if the click
	 * isn't a navigation gesture. Handles two cases:
	 *  1. Plain wiki/internal links — `<a class="internal-link" data-href=...>`
	 *  2. Embed titles / link icons — climb to the wrapping
	 *     `.markdown-embed` / `.internal-embed` and read its `src` attr.
	 *     Clicks on the embed's content body don't count (so user can still
	 *     interact with embedded checkboxes etc.).
	 */
	private extractClickedLinktext(target: HTMLElement): string | null {
		const embedTrigger = target.closest(
			".markdown-embed-title, .markdown-embed-link",
		) as HTMLElement | null;
		if (embedTrigger) {
			const embedWrap = embedTrigger.closest(
				".markdown-embed, .internal-embed",
			) as HTMLElement | null;
			const src = embedWrap?.getAttribute("src") ?? embedWrap?.getAttribute("alt");
			if (src) return src;
		}

		const link = target.closest(
			"a.internal-link, a[data-href], .cm-hmd-internal-link, .cm-link-alias, .cm-formatting-link, span.cm-underline",
		) as HTMLElement | null;
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
		this.plugin.app.workspace.iterateRootLeaves((l) => {
			mainLeaves.push(l);
		});
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

	/**
	 * Keep `today-sticky-popout` on the popout's body. Obsidian rebuilds /
	 * reassigns body.className on certain layout transitions (notably window
	 * resize), which would otherwise drop our class and let all the hidden
	 * tab/header chrome flash back in.
	 */
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
		this.bodyClassObserver = obs;
	}

	private isLeafAttached(leaf: WorkspaceLeaf): boolean {
		let found = false;
		this.plugin.app.workspace.iterateAllLeaves((l) => {
			if (l === leaf) found = true;
		});
		return found;
	}
}
