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
}

export function installChrome(
	leaf: WorkspaceLeaf,
	callbacks: ChromeCallbacks,
	initialPinned: boolean,
): ChromeHandle {
	const doc = getPopoutDocument(leaf);
	if (!doc) {
		return {
			uninstall: () => {},
			setPinned: () => {},
			setCollapsed: () => {},
		};
	}

	doc.body.classList.add("today-sticky-popout");

	const bar = doc.createElement("div");
	bar.className = "today-sticky-topbar";

	const pinBtn = makeBtn(doc, "today-sticky-btn pin", "●", () => {
		const next = callbacks.onTogglePin();
		updatePinBtn(pinBtn, next);
	});
	updatePinBtn(pinBtn, initialPinned);

	const collapseBtn = makeBtn(doc, "today-sticky-btn collapse", "–", () => {
		const next = callbacks.onToggleCollapse();
		updateCollapseBtn(collapseBtn, next);
	});
	updateCollapseBtn(collapseBtn, false);

	const closeBtn = makeBtn(doc, "today-sticky-btn close", "×", callbacks.onClose);
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
	btn.textContent = pinned ? "●" : "○";
	btn.title = pinned ? "Pinned (always on top) — click to unpin" : "Click to pin on top";
}

function updateCollapseBtn(btn: HTMLButtonElement, collapsed: boolean): void {
	btn.textContent = collapsed ? "▢" : "–";
	btn.title = collapsed ? "Expand" : "Collapse to single line";
}
