import type { WorkspaceLeaf } from "obsidian";
import { getPopoutDocument } from "./electronWindow";

export interface ChromeCallbacks {
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
		return {
			uninstall: () => {},
			setPinned: () => {},
		};
	}

	doc.body.classList.add("today-sticky-popout");

	const bar = doc.createElement("div");
	bar.className = "today-sticky-topbar";

	// Spacer absorbs the leftover space and is the actual drag region.
	// Buttons opt out via -webkit-app-region: no-drag in CSS.
	const drag = doc.createElement("div");
	drag.className = "today-sticky-drag";
	bar.appendChild(drag);

	const pinBtn = makeBtn(doc, "today-sticky-btn pin", "●", () => {
		const next = callbacks.onTogglePin();
		updatePinBtn(pinBtn, next);
	});
	updatePinBtn(pinBtn, initialPinned);

	const closeBtn = makeBtn(doc, "today-sticky-btn close", "×", callbacks.onClose);
	closeBtn.title = "Close";

	bar.appendChild(pinBtn);
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
	btn.textContent = pinned ? "●" : "○";
	btn.title = pinned ? "Pinned (always on top) — click to unpin" : "Click to pin on top";
}
