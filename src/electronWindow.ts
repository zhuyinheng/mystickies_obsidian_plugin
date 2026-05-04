import type { WorkspaceLeaf } from "obsidian";

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

export function getBrowserWindowForLeaf(leaf: WorkspaceLeaf): ElectronBrowserWindow | null {
	const popoutWin = getPopoutWindow(leaf);
	if (!popoutWin) return null;
	const req = (popoutWin as unknown as { require?: NodeJS.Require }).require;
	if (!req) return null;
	try {
		const remote = req("@electron/remote") as { getCurrentWindow?: () => ElectronBrowserWindow };
		return remote?.getCurrentWindow?.() ?? null;
	} catch {
		return null;
	}
}

export interface ElectronBrowserWindow {
	setAlwaysOnTop: (flag: boolean, level?: string) => void;
	setVisibleOnAllWorkspaces?: (flag: boolean, opts?: { visibleOnFullScreen?: boolean }) => void;
	setWindowButtonVisibility?: (visible: boolean) => void;
	setOpacity?: (value: number) => void;
	close: () => void;
}

/**
 * Apply the always-on-top sticky configuration to a popout's BrowserWindow.
 * Always: alwaysOnTop("floating") + visibleOnAllWorkspaces (full-screen too)
 * macOS: also hide native traffic lights so chrome reads as a clean tile.
 */
export function configureStickyWindow(bw: ElectronBrowserWindow | null): void {
	if (!bw) return;
	try {
		bw.setAlwaysOnTop(true, "floating");
	} catch (e) {
		console.warn("[today-sticky] setAlwaysOnTop failed", e);
	}
	try {
		bw.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
	} catch (e) {
		console.warn("[today-sticky] setVisibleOnAllWorkspaces failed", e);
	}
	if (typeof process !== "undefined" && process.platform === "darwin") {
		try {
			bw.setWindowButtonVisibility?.(false);
		} catch (e) {
			console.warn("[today-sticky] setWindowButtonVisibility failed", e);
		}
	}
}
