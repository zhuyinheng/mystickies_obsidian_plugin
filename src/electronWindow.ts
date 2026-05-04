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
		if (remote?.getCurrentWindow) return remote.getCurrentWindow();
	} catch {
		/* fall through */
	}
	try {
		const electron = req("electron") as { remote?: { getCurrentWindow?: () => ElectronBrowserWindow } };
		if (electron?.remote?.getCurrentWindow) return electron.remote.getCurrentWindow();
	} catch {
		/* fall through */
	}
	return null;
}

export interface StickyConfig {
	alwaysOnTop: boolean;
	visibleOnAllWorkspaces: boolean;
	vibrancy: boolean;
	hideTrafficLights: boolean;
}

export interface ElectronBrowserWindow {
	setAlwaysOnTop: (flag: boolean, level?: string) => void;
	setVisibleOnAllWorkspaces?: (flag: boolean, opts?: { visibleOnFullScreen?: boolean }) => void;
	setVibrancy?: (type: string | null) => void;
	setWindowButtonVisibility?: (visible: boolean) => void;
	setTitleBarOverlay?: (opts: { color?: string; symbolColor?: string; height?: number }) => void;
	setOpacity?: (value: number) => void;
	minimize: () => void;
	close: () => void;
	isAlwaysOnTop: () => boolean;
	getBounds: () => { x: number; y: number; width: number; height: number };
	setBounds: (b: { x?: number; y?: number; width?: number; height?: number }) => void;
	on: (event: string, listener: (...args: unknown[]) => void) => void;
	off?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export function configureStickyWindow(bw: ElectronBrowserWindow | null, config: StickyConfig): void {
	if (!bw) return;
	try {
		if (config.alwaysOnTop) bw.setAlwaysOnTop(true, "floating");
	} catch (e) {
		console.warn("[today-sticky] setAlwaysOnTop failed", e);
	}
	try {
		if (config.visibleOnAllWorkspaces) {
			bw.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
		}
	} catch (e) {
		console.warn("[today-sticky] setVisibleOnAllWorkspaces failed", e);
	}
	const platform = typeof process !== "undefined" ? process.platform : "";
	try {
		if (config.vibrancy && platform === "darwin") {
			bw.setVibrancy?.("under-window");
		}
	} catch (e) {
		console.warn("[today-sticky] setVibrancy failed", e);
	}
	try {
		if (config.hideTrafficLights && platform === "darwin") {
			bw.setWindowButtonVisibility?.(false);
		}
	} catch (e) {
		console.warn("[today-sticky] setWindowButtonVisibility failed", e);
	}
}
