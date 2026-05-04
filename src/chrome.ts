import type { WorkspaceLeaf } from "obsidian";
import { getPopoutDocument } from "./windowControls";

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

	doc.body.classList.add("mystickies-popout");

	const bar = doc.createElement("div");
	bar.className = "mystickies-topbar";

	const drag = doc.createElement("div");
	drag.className = "mystickies-drag";

	const titleEl = doc.createElement("span");
	titleEl.className = "mystickies-title";
	titleEl.textContent = title;
	drag.appendChild(titleEl);

	bar.appendChild(drag);

	const pinBtn = makeBtn(doc, "mystickies-btn pin", "Pinned (always on top)", () => {
		updatePinBtn(pinBtn, callbacks.onTogglePin());
	});
	updatePinBtn(pinBtn, initialPinned);

	const openMainBtn = makeBtn(doc, "mystickies-btn go-main", "Open this note in the main Obsidian window", callbacks.onOpenInMain);

	const closeBtn = makeBtn(doc, "mystickies-btn close", "Close sticky", callbacks.onClose);

	bar.appendChild(pinBtn);
	bar.appendChild(openMainBtn);
	bar.appendChild(closeBtn);
	doc.body.prepend(bar);

	return () => {
		bar.remove();
		doc.body.classList.remove("mystickies-popout");
	};
}

function makeBtn(doc: Document, cls: string, label: string, onClick: () => void): HTMLButtonElement {
	const b = doc.createElement("button");
	b.className = cls;
	b.type = "button";
	b.title = label;
	b.setAttribute("aria-label", label);
	b.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		onClick();
	});
	return b;
}

function updatePinBtn(btn: HTMLButtonElement, pinned: boolean): void {
	btn.classList.toggle("is-pinned", pinned);
	btn.title = pinned ? "Pinned (always on top) — click to unpin" : "Click to pin on top";
	btn.setAttribute("aria-label", btn.title);
}
