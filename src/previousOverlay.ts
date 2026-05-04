import { App, Component, MarkdownRenderer, TFile, WorkspaceLeaf } from "obsidian";
import { getPopoutDocument } from "./electronWindow";

export class PreviousOverlay extends Component {
	private container: HTMLElement | null = null;
	private currentPath: string | null = null;

	constructor(private app: App, private leaf: WorkspaceLeaf) {
		super();
	}

	install(): boolean {
		const doc = getPopoutDocument(this.leaf);
		if (!doc) {
			console.warn("[today-sticky] PreviousOverlay: no popout document");
			return false;
		}

		const viewContent = doc.querySelector(".workspace-leaf-content .view-content")
			?? doc.querySelector(".view-content");
		if (!viewContent || !viewContent.parentElement) {
			console.warn("[today-sticky] PreviousOverlay: .view-content not found");
			return false;
		}

		this.container = doc.createElement("div");
		this.container.className = "today-sticky-prev-overlay";
		viewContent.parentElement.insertBefore(this.container, viewContent);
		return true;
	}

	uninstall(): void {
		this.container?.remove();
		this.container = null;
		this.currentPath = null;
	}

	async render(prev: TFile | null): Promise<void> {
		if (!this.container) return;

		if (!prev) {
			this.currentPath = null;
			this.container.empty();
			const empty = this.container.createDiv("today-sticky-prev-empty");
			empty.textContent = "No previous daily note";
			return;
		}

		if (this.currentPath === prev.path) return;
		this.currentPath = prev.path;

		this.container.empty();

		const header = this.container.createDiv("today-sticky-prev-header");
		const arrow = header.createSpan("today-sticky-prev-arrow");
		arrow.textContent = "← ";
		// Marked as internal-link with data-href so the popout's document-level
		// click interceptor (in stickyWindow.ts) handles it: plain click opens
		// the link in the main Obsidian window; cmd/ctrl click spawns a new
		// sticky for that file. No inline handler — bubbles up to interceptor.
		header.createEl("a", {
			cls: "today-sticky-prev-link internal-link",
			text: prev.basename,
			attr: { "data-href": prev.path, href: prev.path },
		});

		const body = this.container.createDiv("today-sticky-prev-body markdown-rendered");
		try {
			const md = await this.app.vault.cachedRead(prev);
			await MarkdownRenderer.render(this.app, md, body, prev.path, this);
		} catch (e) {
			console.error("[today-sticky] failed to render previous note", e);
			body.textContent = "Failed to render previous note. See console.";
		}
	}
}
