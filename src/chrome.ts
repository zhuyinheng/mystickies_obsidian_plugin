import type { WorkspaceLeaf } from "obsidian";
import { getPopoutDocument } from "./electronWindow";

export interface ChromeCallbacks {
	onToggleCollapse: () => boolean;
	onClose: () => void;
	onTogglePin: () => boolean;
}

export interface ChromeHandle {
	uninstall: () => void;
	setPinned: (pinned: boolean) => void;
	setCollapsed: (collapsed: boolean) => void;
	setTitle: (text: string) => void;
}

export function installChrome(
	leaf: WorkspaceLeaf,
	callbacks: ChromeCallbacks,
	initialPinned: boolean,
	initialTitle: string,
): ChromeHandle {
	const doc = getPopoutDocument(leaf);
	if (!doc) {
		return {
			uninstall: () => {},
			setPinned: () => {},
			setCollapsed: () => {},
			setTitle: () => {},
		};
	}

	doc.body.classList.add("today-sticky-popout");

	const bar = doc.createElement("div");
	bar.className = "today-sticky-topbar";

	const dragRegion = doc.createElement("div");
	dragRegion.className = "today-sticky-drag";

	// Title element shown inside the drag region. It stays present at all
	// times but is only visible when the window is collapsed.
	const titleEl = doc.createElement("span");
	titleEl.className = "today-sticky-title";
	titleEl.textContent = initialTitle;
	dragRegion.appendChild(titleEl);

	bar.appendChild(dragRegion);

	const pinBtn = makeBtn(doc, "today-sticky-btn pin", initialPinned ? "📌" : "📍", () => {
		const next = callbacks.onTogglePin();
		updatePinBtn(pinBtn, next);
	});
	updatePinBtn(pinBtn, initialPinned);

	const collapseBtn = makeBtn(doc, "today-sticky-btn collapse", "—", () => {
		const next = callbacks.onToggleCollapse();
		updateCollapseBtn(collapseBtn, next);
	});
	updateCollapseBtn(collapseBtn, false);

	const closeBtn = makeBtn(doc, "today-sticky-btn close", "✕", callbacks.onClose);
	closeBtn.title = "Close";

	bar.appendChild(pinBtn);
	bar.appendChild(collapseBtn);
	bar.appendChild(closeBtn);

	doc.body.prepend(bar);

	return {
		uninstall: () => {
			bar.remove();
			doc.body.classList.remove("today-sticky-popout");
			doc.body.classList.remove("today-sticky-collapsed");
		},
		setPinned: (pinned) => updatePinBtn(pinBtn, pinned),
		setCollapsed: (collapsed) => {
			doc.body.classList.toggle("today-sticky-collapsed", collapsed);
			updateCollapseBtn(collapseBtn, collapsed);
		},
		setTitle: (text) => {
			titleEl.textContent = text;
		},
	};
}

function makeBtn(doc: Document, cls: string, text: string, onClick: () => void): HTMLButtonElement {
	const b = doc.createElement("button");
	b.className = cls;
	b.textContent = text;
	b.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		onClick();
	});
	return b;
}

function updatePinBtn(btn: HTMLButtonElement, pinned: boolean): void {
	btn.textContent = pinned ? "📌" : "📍";
	btn.title = pinned ? "Pinned — always on top (click to unpin)" : "Not pinned (click to pin on top)";
}

function updateCollapseBtn(btn: HTMLButtonElement, collapsed: boolean): void {
	btn.textContent = collapsed ? "▣" : "—";
	btn.title = collapsed ? "Expand" : "Collapse to title";
}
