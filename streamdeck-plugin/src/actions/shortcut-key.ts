import { action, DidReceiveSettingsEvent, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";

import { keys, type KeyPress } from "../keys";

/** Figma's macOS shortcuts. Ids are stored in settings, so rename labels freely but keep ids stable. */
export const SHORTCUTS = {
	pasteOverSelection: { label: "Paste in place", press: { char: "v", modifiers: ["command", "shift"] } },
	pasteToReplace: { label: "Paste replace", press: { char: "r", modifiers: ["command", "shift"] } },
	copyProperties: { label: "Copy props", press: { char: "c", modifiers: ["command", "option"] } },
	pasteProperties: { label: "Paste props", press: { char: "v", modifiers: ["command", "option"] } },
	copyAsPng: { label: "Copy PNG", press: { char: "c", modifiers: ["command", "shift"] } },
	frameSelection: { label: "Frame", press: { char: "g", modifiers: ["command", "option"] } },
	autoLayout: { label: "Auto layout", press: { char: "a", modifiers: ["shift"] } },
	group: { label: "Group", press: { char: "g", modifiers: ["command"] } },
	ungroup: { label: "Ungroup", press: { char: "g", modifiers: ["command", "shift"] } },
	createComponent: { label: "Component", press: { char: "k", modifiers: ["command", "option"] } },
	detachInstance: { label: "Detach", press: { char: "b", modifiers: ["command", "option"] } },
	toggleUi: { label: "Hide UI", press: { char: "\\", modifiers: ["command"] } },
	runLastPlugin: { label: "Run plugin", press: { char: "p", modifiers: ["command", "option"] } },
} satisfies Record<string, { label: string; press: KeyPress }>;

type ShortcutId = keyof typeof SHORTCUTS;

type Settings = {
	shortcut?: ShortcutId;
};

const DEFAULT_SHORTCUT: ShortcutId = "pasteOverSelection";

function shortcutFor(settings: Settings): (typeof SHORTCUTS)[ShortcutId] {
	return SHORTCUTS[settings.shortcut && settings.shortcut in SHORTCUTS ? settings.shortcut : DEFAULT_SHORTCUT];
}

/** A key that fires one Figma shortcut, picked in the property inspector. Only fires while Figma is frontmost. */
@action({ UUID: "com.pixelchew.figmadeck.shortcut" })
export class ShortcutKey extends SingletonAction<Settings> {
	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		if (ev.action.isKey()) await ev.action.setTitle(shortcutFor(ev.payload.settings).label);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		if (ev.action.isKey()) await ev.action.setTitle(shortcutFor(ev.payload.settings).label);
	}

	override onKeyDown(ev: KeyDownEvent<Settings>): void {
		keys.send(shortcutFor(ev.payload.settings).press);
	}
}
