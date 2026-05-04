import type { WorkspaceLeaf } from "obsidian";
import { getPopoutDocument } from "./electronWindow";

export interface ChromeCallbacks {
	onMinimize: () => void;
	onClose: () => void;
	onTogglePin: () => boolean;
}

export interface ChromeHandle {
	uninstall: () => void;
	setPinned: (pinned: boolean) => void;
}

export function installChrome(
	leaf: WorkspaceLeaf,
	callbacks: ChromeCallbacks,
	initialPinned: boolean,
): ChromeHandle {
	const doc = getPopoutDocument(leaf);
	if (!doc) {
		return { uninstall: () => {}, setPinned: () => {} };
	}

	doc.body.classList.add("today-sticky-popout");

	const bar = doc.createElement("div");
	bar.className = "today-sticky-topbar";

	const dragRegion = doc.createElement("div");
	dragRegion.className = "today-sticky-drag";
	bar.appendChild(dragRegion);

	const pinBtn = makeBtn(doc, "today-sticky-btn pin", initialPinned ? "📌" : "📍", () => {
		const next = callbacks.onTogglePin();
		updatePinBtn(pinBtn, next);
	});
	updatePinBtn(pinBtn, initialPinned);

	const minBtn = makeBtn(doc, "today-sticky-btn min", "—", callbacks.onMinimize);
	minBtn.title = "Minimize";

	const closeBtn = makeBtn(doc, "today-sticky-btn close", "✕", callbacks.onClose);
	closeBtn.title = "Close";

	bar.appendChild(pinBtn);
	bar.appendChild(minBtn);
	bar.appendChild(closeBtn);

	doc.body.prepend(bar);

	return {
		uninstall: () => {
			bar.remove();
			doc.body.classList.remove("today-sticky-popout");
		},
		setPinned: (pinned) => updatePinBtn(pinBtn, pinned),
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
