import { Notice, WorkspaceLeaf } from "obsidian";
import type TodayStickyPlugin from "./main";

export class StickyWindow {
	private leaf: WorkspaceLeaf | null = null;

	constructor(private plugin: TodayStickyPlugin) {}

	async open(): Promise<void> {
		if (!this.plugin.dailyNotes.ensureLoaded()) {
			new Notice("Today's Note Sticky: enable the core Daily Notes plugin first.");
			return;
		}

		if (this.leaf && this.isLeafAttached(this.leaf)) {
			this.focus();
			return;
		}

		const today = await this.plugin.dailyNotes.getOrCreateToday();
		if (!today) {
			new Notice("Today's Note Sticky: failed to get or create today's daily note.");
			return;
		}

		const leaf = this.plugin.app.workspace.openPopoutLeaf({
			size: { width: 480, height: 720 },
		});
		await leaf.openFile(today, { active: true });
		this.leaf = leaf;
	}

	focus(): void {
		if (!this.leaf) return;
		this.plugin.app.workspace.setActiveLeaf(this.leaf, { focus: true });
	}

	close(): void {
		this.leaf?.detach();
		this.leaf = null;
	}

	private isLeafAttached(leaf: WorkspaceLeaf): boolean {
		let found = false;
		this.plugin.app.workspace.iterateAllLeaves((l) => {
			if (l === leaf) found = true;
		});
		return found;
	}
}
