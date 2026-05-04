import { Notice, TFile, WorkspaceLeaf } from "obsidian";
import type MyStickiesPlugin from "./main";
import {
	createStickyWindowControls,
	getPopoutDocument,
	getPopoutWindow,
	type StickyWindowSize,
	type StickyWindowControls,
} from "./windowControls";
import { installChrome } from "./chrome";
import type { StickyManager } from "./stickyManager";

interface OpacitySettings {
	idle: number;
	active: number;
	fadeInMs: number;
	fadeOutMs: number;
}

export class StickyWindow {
	private leaf: WorkspaceLeaf | null = null;
	private controls: StickyWindowControls | null = null;
	private pinned = true;
	private closing = false;
	/** Cleanups registered by install* methods. Drained LIFO in close(). */
	private cleanups: Array<() => void> = [];

	constructor(
		private plugin: MyStickiesPlugin,
		public readonly file: TFile,
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

		const size = this.plugin.getStickySize();
		const leaf = size
			? this.plugin.app.workspace.openPopoutLeaf({ size })
			: this.plugin.app.workspace.openPopoutLeaf();
		await leaf.openFile(this.file, { active: true });
		this.leaf = leaf;

		this.controls = await createStickyWindowControls(leaf);
		this.controls.applyPinned(this.pinned);
		if (size) this.controls.applySize(size);

		this.installChromeBar(leaf, this.file.basename);
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
	 * Tear down the sticky and force-close its native window. Re-entrant safe:
	 * native close fires the popout's beforeunload, which triggers close()
	 * again via installPopoutCloseListener — the `closing` flag short-circuits.
	 */
	close(): void {
		if (this.closing) return;
		this.closing = true;

		// LIFO drain so each install's teardown runs in reverse order of setup.
		for (let i = this.cleanups.length - 1; i >= 0; i--) {
			try {
				this.cleanups[i]();
			} catch (e) {
				console.warn("[mystickies] cleanup failed", e);
			}
		}
		this.cleanups = [];

		// Detach the leaf, then force-close the popout. Obsidian 1.12's
		// leaf.detach() does not tear down the popout — without a window-level
		// close it lingers chrome-less and uncloseable.
		const controls = this.controls;
		this.controls = null;
		this.leaf?.detach();
		this.leaf = null;
		controls?.closeWindow();

		this.manager.unregister(this.file);
	}

	togglePin(): boolean {
		if (!this.controls?.hasNativeWindow) return this.pinned;
		this.pinned = !this.pinned;
		this.controls.applyPinned(this.pinned);
		return this.pinned;
	}

	async openCurrentInMain(): Promise<void> {
		await this.openFileInMain(this.file);
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
		const controls = this.controls;
		if (!controls?.supportsOpacity) return;
		const popoutWin = getPopoutWindow(leaf);
		if (!popoutWin) return;

		const opacity = this.readOpacitySettings(leaf);
		if (!opacity) return;
		controls.applyOpacity(opacity.idle);

		let raf: number | null = null;
		let target = opacity.idle;
		let value = opacity.idle;
		const animateTo = (next: number, durationMs: number) => {
			target = next;
			if (raf !== null) {
				popoutWin.cancelAnimationFrame(raf);
				raf = null;
			}
			const start = performance.now();
			const from = value;
			const tick = () => {
				if (!this.controls) {
					raf = null;
					return;
				}
				const t = Math.min(1, (performance.now() - start) / durationMs);
				const eased = t * t * (3 - 2 * t);
				value = from + (target - from) * eased;
				controls.applyOpacity(value);
				if (t < 1) {
					raf = popoutWin.requestAnimationFrame(tick);
				} else {
					raf = null;
				}
			};
			raf = popoutWin.requestAnimationFrame(tick);
		};

		const onEnter = () => animateTo(opacity.active, opacity.fadeInMs);
		const onLeave = () => animateTo(opacity.idle, opacity.fadeOutMs);
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
				controls.applyOpacity(opacity.active);
			} catch {
				/* window may be torn down */
			}
		});
	}

	private readOpacitySettings(leaf: WorkspaceLeaf): OpacitySettings | null {
		const doc = getPopoutDocument(leaf);
		const style = doc?.defaultView?.getComputedStyle(doc.body);
		const idle = readCssNumber(style, "--mystickies-idle-opacity");
		const active = readCssNumber(style, "--mystickies-active-opacity");
		const fadeInMs = readCssNumber(style, "--mystickies-opacity-fade-in-ms");
		const fadeOutMs = readCssNumber(style, "--mystickies-opacity-fade-out-ms");
		if (
			idle === null
			|| active === null
			|| fadeInMs === null
			|| fadeOutMs === null
			|| fadeInMs <= 0
			|| fadeOutMs <= 0
		) {
			return null;
		}
		return {
			idle,
			active,
			fadeInMs,
			fadeOutMs,
		};
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
		return this.plugin.app.metadataCache.getFirstLinkpathDest(linktext, this.file.path);
	}

	private async openFileInMain(file: TFile): Promise<void> {
		const mainLeaves: WorkspaceLeaf[] = [];
		this.plugin.app.workspace.iterateRootLeaves((l) => mainLeaves.push(l));
		const mainLeaf = mainLeaves[0];
		if (!mainLeaf) {
			new Notice("MyStickies: no main Obsidian leaf available.");
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
			new Notice(`MyStickies: cannot resolve link "${linktext}"`);
			return;
		}
		await this.openFileInMain(file);
	}

	private async openLinkAsSticky(linktext: string): Promise<void> {
		const file = this.resolveLinkText(linktext);
		if (!file) {
			new Notice(`MyStickies: cannot resolve link "${linktext}"`);
			return;
		}
		await this.manager.openFile(file);
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

	/** Re-add `mystickies-popout` to the popout body if Obsidian removes it
	 *  during a layout transition (e.g. resize). */
	private installBodyClassGuard(leaf: WorkspaceLeaf): void {
		const doc = getPopoutDocument(leaf);
		if (!doc) return;
		const ensure = () => {
			if (!doc.body.classList.contains("mystickies-popout")) {
				doc.body.classList.add("mystickies-popout");
			}
		};
		ensure();
		const obs = new MutationObserver(ensure);
		obs.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
		this.cleanups.push(() => obs.disconnect());
	}

	/** Track the popout's content size so the next new sticky opens the same way. */
	private installResizeTracker(leaf: WorkspaceLeaf): void {
		const controls = this.controls;
		const popoutWin = getPopoutWindow(leaf);
		const doc = getPopoutDocument(leaf);
		if (!controls && !popoutWin && !doc) return;

		let lastSize = normalizeSize(controls?.readSize() ?? readDocumentSize(doc) ?? readWindowSize(popoutWin));
		const capture = (size: StickyWindowSize | null = null) => {
			const next = normalizeSize(size ?? controls?.readSize() ?? readDocumentSize(doc) ?? readWindowSize(popoutWin));
			if (!next) return;
			if (lastSize && isSameSize(lastSize, next)) return;
			lastSize = next;
			this.plugin.rememberStickySize(next.width, next.height);
		};

		const uninstallNativeResize = controls?.onResize(capture) ?? (() => {});
		const handler = () => {
			capture();
		};
		popoutWin?.addEventListener("resize", handler);
		const ResizeObserverCtor = doc?.defaultView?.ResizeObserver;
		const observer = ResizeObserverCtor ? new ResizeObserverCtor(() => capture()) : null;
		if (observer && doc) {
			observer.observe(doc.documentElement);
			observer.observe(doc.body);
		}
		this.cleanups.push(() => {
			capture();
			this.plugin.flushStickySize();
			uninstallNativeResize();
			observer?.disconnect();
			try {
				popoutWin?.removeEventListener("resize", handler);
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

function readCssNumber(style: CSSStyleDeclaration | undefined, name: string): number | null {
	const raw = style?.getPropertyValue(name).trim();
	if (!raw) return null;
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) ? value : null;
}

function readWindowSize(win: Window | null): StickyWindowSize | null {
	if (!win) return null;
	const { innerWidth: width, innerHeight: height } = win;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	return { width, height };
}

function readDocumentSize(doc: Document | null): StickyWindowSize | null {
	const win = doc?.defaultView;
	if (!doc || !win) return null;
	const width = doc.documentElement.clientWidth || win.innerWidth;
	const height = doc.documentElement.clientHeight || win.innerHeight;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	return { width, height };
}

function normalizeSize(size: StickyWindowSize | null | undefined): StickyWindowSize | null {
	if (!size) return null;
	const width = Math.round(size.width);
	const height = Math.round(size.height);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	return { width, height };
}

function isSameSize(a: StickyWindowSize, b: StickyWindowSize): boolean {
	return a.width === b.width && a.height === b.height;
}
