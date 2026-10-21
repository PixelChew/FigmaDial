import {
	action,
	DialDownEvent,
	DialRotateEvent,
	DialUpEvent,
	SingletonAction,
	TouchTapEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import { TickCoalescer } from "@figmadeck/protocol";

import { KEY, keys } from "../keys";

/**
 * Drives whichever number field has focus in Figma's properties panel by sending ↑/↓ keystrokes.
 * Turn to nudge by 1, hold and turn to nudge by 10 (Shift), press to Tab to the next field, tap the strip to leave the field.
 * Works for any field Figma supports arrow keys in, without the Figma plugin running, but can't show the value.
 */
@action({ UUID: "com.pixelchew.figmadeck.field" })
export class FieldDial extends SingletonAction {
	private readonly coalescers = new Map<string, TickCoalescer>();
	private readonly turnedWhilePressed = new Set<string>();

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isDial()) return;
		this.coalescers.set(
			ev.action.id,
			new TickCoalescer((ticks, coarse) => {
				keys.send({ code: ticks > 0 ? KEY.up : KEY.down, modifiers: coarse ? ["shift"] : [], repeat: Math.abs(ticks) });
			}),
		);
		await ev.action.setFeedback({ title: "Focused field", value: "Nudge ↑↓", indicator: { enabled: false } });
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.coalescers.get(ev.action.id)?.cancel();
		this.coalescers.delete(ev.action.id);
	}

	override onDialRotate(ev: DialRotateEvent): void {
		if (ev.payload.pressed) this.turnedWhilePressed.add(ev.action.id);
		this.coalescers.get(ev.action.id)?.add(ev.payload.ticks, ev.payload.pressed);
	}

	override onDialDown(ev: DialDownEvent): void {
		this.turnedWhilePressed.delete(ev.action.id);
	}

	override onDialUp(ev: DialUpEvent): void {
		if (!this.turnedWhilePressed.has(ev.action.id)) keys.send({ code: KEY.tab });
	}

	override onTouchTap(): void {
		keys.send({ code: KEY.escape });
	}
}
