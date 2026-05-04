import type { WorkspaceLeaf } from "obsidian";

interface ElectronBrowserWindow {
	setAlwaysOnTop: (flag: boolean, level?: string) => void;
	setVisibleOnAllWorkspaces?: (flag: boolean, opts?: { visibleOnFullScreen?: boolean }) => void;
	setWindowButtonVisibility?: (visible: boolean) => void;
	setOpacity?: (value: number) => void;
	setContentSize?: (width: number, height: number, animate?: boolean) => void;
	getContentSize?: () => [number, number];
	setSize?: (width: number, height: number, animate?: boolean) => void;
	getSize?: () => [number, number];
	on?: (event: "resize", listener: () => void) => void;
	off?: (event: "resize", listener: () => void) => void;
	removeListener?: (event: "resize", listener: () => void) => void;
	close: () => void;
	destroy?: () => void;
	getTitle?: () => string;
}

export interface StickyWindowSize {
	width: number;
	height: number;
}

export interface StickyWindowControls {
	readonly hasNativeWindow: boolean;
	readonly supportsOpacity: boolean;
	applyPinned(pinned: boolean): void;
	applyOpacity(value: number): void;
	applySize(size: StickyWindowSize): void;
	readSize(): StickyWindowSize | null;
	onResize(callback: (size: StickyWindowSize) => void): () => void;
	closeWindow(): void;
}

export function getPopoutDocument(leaf: WorkspaceLeaf): Document | null {
	const container = (leaf as unknown as { getContainer?: () => { doc?: Document } }).getContainer?.();
	const doc = container?.doc;
	if (doc && doc !== window.document) return doc;
	return null;
}

export function getPopoutWindow(leaf: WorkspaceLeaf): Window | null {
	const container = (leaf as unknown as { getContainer?: () => { win?: Window } }).getContainer?.();
	const win = container?.win;
	if (win && win !== window) return win;
	return null;
}

export async function createStickyWindowControls(leaf: WorkspaceLeaf): Promise<StickyWindowControls> {
	const popoutWin = getPopoutWindow(leaf);
	const bw = await waitForBrowserWindow(leaf);
	if (!bw) {
		console.warn("[mystickies] could not acquire popout BrowserWindow; native sticky controls are unavailable");
	}
	configureNativeWindow(bw);
	return makeControls(bw, popoutWin);
}

export function closePopoutLeaf(leaf: WorkspaceLeaf): void {
	const popoutWin = getPopoutWindow(leaf);
	const bw = getBrowserWindowForLeaf(leaf);
	leaf.detach();
	destroyPopout(bw, popoutWin);
}

function makeControls(bw: ElectronBrowserWindow | null, popoutWin: Window | null): StickyWindowControls {
	return {
		hasNativeWindow: bw !== null,
		supportsOpacity: typeof bw?.setOpacity === "function",
		applyPinned(pinned: boolean): void {
			try {
				bw?.setAlwaysOnTop(pinned, "floating");
			} catch (e) {
				console.warn("[mystickies] setAlwaysOnTop failed", e);
			}
		},
		applyOpacity(value: number): void {
			try {
				bw?.setOpacity?.(value);
			} catch {
				/* window may be torn down */
			}
		},
		applySize(size: StickyWindowSize): void {
			try {
				const width = Math.round(size.width);
				const height = Math.round(size.height);
				if (bw?.setContentSize) {
					bw.setContentSize(width, height);
				} else {
					bw?.setSize?.(width, height);
				}
			} catch (e) {
				console.warn("[mystickies] setSize failed", e);
			}
		},
		readSize(): StickyWindowSize | null {
			return readBrowserWindowSize(bw);
		},
		onResize(callback: (size: StickyWindowSize) => void): () => void {
			if (!bw?.on) return () => {};
			const listener = () => {
				const size = readBrowserWindowSize(bw);
				if (size) callback(size);
			};
			try {
				bw.on("resize", listener);
			} catch {
				return () => {};
			}
			return () => {
				try {
					if (bw.off) {
						bw.off("resize", listener);
					} else {
						bw.removeListener?.("resize", listener);
					}
				} catch {
					/* window may be torn down */
				}
			};
		},
		closeWindow(): void {
			destroyPopout(bw, popoutWin);
		},
	};
}

function readBrowserWindowSize(bw: ElectronBrowserWindow | null): StickyWindowSize | null {
	try {
		const size = bw?.getContentSize?.() ?? bw?.getSize?.();
		if (!size) return null;
		const [width, height] = size;
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
		return { width, height };
	} catch {
		return null;
	}
}

function getBrowserWindowForLeaf(leaf: WorkspaceLeaf): ElectronBrowserWindow | null {
	const popoutWin = getPopoutWindow(leaf);
	if (!popoutWin) return null;

	try {
		const req = (popoutWin as unknown as { require?: NodeJS.Require }).require;
		const remote = req?.("@electron/remote") as { getCurrentWindow?: () => ElectronBrowserWindow } | undefined;
		const bw = remote?.getCurrentWindow?.();
		if (bw) return bw;
	} catch {
		/* try fallback */
	}

	try {
		const mainReq = (window as unknown as { require?: NodeJS.Require }).require;
		const mainRemote = mainReq?.("@electron/remote") as { BrowserWindow?: { getAllWindows: () => ElectronBrowserWindow[] } } | undefined;
		const all = mainRemote?.BrowserWindow?.getAllWindows?.() ?? [];
		if (all.length === 0) return null;

		const tag = `mystickies-tag-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		const titleEl = popoutWin.document.querySelector("title");
		const original = titleEl?.textContent ?? "";
		if (titleEl) titleEl.textContent = tag;

		let found: ElectronBrowserWindow | null = null;
		for (const bw of all) {
			try {
				if (bw.getTitle?.() === tag) {
					found = bw;
					break;
				}
			} catch {
				/* skip */
			}
		}
		if (titleEl) titleEl.textContent = original;
		return found;
	} catch {
		return null;
	}
}

async function waitForBrowserWindow(
	leaf: WorkspaceLeaf,
	timeoutMs = 1500,
): Promise<ElectronBrowserWindow | null> {
	const start = performance.now();
	while (performance.now() - start < timeoutMs) {
		const bw = getBrowserWindowForLeaf(leaf);
		if (bw) return bw;
		await new Promise<void>((r) => setTimeout(r, 30));
	}
	return getBrowserWindowForLeaf(leaf);
}

function destroyPopout(bw: ElectronBrowserWindow | null, popoutWin: Window | null): void {
	if (bw) {
		try {
			bw.close();
		} catch {
			/* */
		}
		try {
			bw.destroy?.();
		} catch {
			/* */
		}
	}
	if (popoutWin) {
		try {
			popoutWin.close();
		} catch {
			/* opener-only restriction */
		}
	}
}

function configureNativeWindow(bw: ElectronBrowserWindow | null): void {
	if (!bw) return;
	try {
		bw.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
	} catch (e) {
		console.warn("[mystickies] setVisibleOnAllWorkspaces failed", e);
	}
	if (typeof process !== "undefined" && process.platform === "darwin") {
		try {
			bw.setWindowButtonVisibility?.(false);
		} catch (e) {
			console.warn("[mystickies] setWindowButtonVisibility failed", e);
		}
	}
}
