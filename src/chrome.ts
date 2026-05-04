import type { WorkspaceLeaf } from "obsidian";
import { getPopoutDocument } from "./electronWindow";

export interface ChromeCallbacks {
	onClose: () => void;
	onTogglePin: () => boolean;
	onOpenInMain: () => void;
}

/**
 * Inject the sticky's chrome (titlebar with file name + drag region + 3
 * buttons) into the popout's document. Returns the uninstall function.
 */
export function installChrome(
	leaf: WorkspaceLeaf,
	callbacks: ChromeCallbacks,
	initialPinned: boolean,
	title: string,
): () => void {
	const doc = getPopoutDocument(leaf);
	if (!doc) return () => {};

	doc.body.classList.add("today-sticky-popout");

	const bar = doc.createElement("div");
	bar.className = "today-sticky-topbar";

	const drag = doc.createElement("div");
	drag.className = "today-sticky-drag";

	const titleEl = doc.createElement("span");
	titleEl.className = "today-sticky-title";
	titleEl.textContent = title;
	drag.appendChild(titleEl);

	bar.appendChild(drag);

	const pinBtn = makeBtn(doc, "today-sticky-btn pin", "●", () => {
		updatePinBtn(pinBtn, callbacks.onTogglePin());
	});
	updatePinBtn(pinBtn, initialPinned);

	const openMainBtn = makeBtn(doc, "today-sticky-btn go-main", "↗", callbacks.onOpenInMain);
	openMainBtn.title = "Open this note in the main Obsidian window";

	const closeBtn = makeBtn(doc, "today-sticky-btn close", "×", callbacks.onClose);
	closeBtn.title = "Close sticky";

	bar.appendChild(pinBtn);
	bar.appendChild(openMainBtn);
	bar.appendChild(closeBtn);
	doc.body.prepend(bar);

	return () => {
		bar.remove();
		doc.body.classList.remove("today-sticky-popout");
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
