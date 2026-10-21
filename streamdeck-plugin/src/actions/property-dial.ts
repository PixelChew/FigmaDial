import streamDeck, {
	action,
	DialRotateEvent,
	DialUpEvent,
	DialDownEvent,
	DidReceiveSettingsEvent,
	SingletonAction,
	TouchTapEvent,
	WillAppearEvent,
	WillDisappearEvent,
	type DialAction,
	type FeedbackPayload,
} from "@elgato/streamdeck";
import {
	FAST_TICKS,
	formatValue,
	DEFAULT_MENU,
	HOLD_MS,
	indicatorPercent,
	isPropertyId,
	PROPERTIES,
	PROPERTY_ORDER,
	TickCoalescer,
	wrapIndex,
	type PropertyId,
	type StateMessage,
} from "@figmadeck/protocol";

import { bridge } from "../bridge";

type Settings = {
	/** Property the dial currently controls. */
	current?: PropertyId;
	/** Effects listed in this dial's hold menu ("quick select"). Empty or missing means DEFAULT_MENU. */
	menu?: PropertyId[];
};

type DialState = {
	action: DialAction<Settings>;
	settings: Settings;
	coalescer: TickCoalescer;
	/** Fires when the dial has been held long enough to open the property menu. */
	holdTimer: ReturnType<typeof setTimeout> | undefined;
	/** Index into the dial's menu while it's open; undefined when it's closed. */
	menuIndex: number | undefined;
};

/**
 * Controls a Figma property on the current selection. Figma reports values back, so the strip is always live.
 *
 * - Turn: change the value (a fast spin takes bigger steps).
 * - Click: cycle the property's mode, e.g. stroke Inside → Outside → Center.
 * - Hold, or hold and turn: the strip becomes a property menu; turn to choose, release to pick.
 * - Tap the strip: reset the value.
 */
@action({ UUID: "com.pixelchew.figmadeck.property" })
export class PropertyDial extends SingletonAction<Settings> {
	private readonly dials = new Map<string, DialState>();

	constructor() {
		super();
		bridge.onState((state) => {
			for (const dial of this.dials.values()) void this.render(dial, state);
		});
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		if (!ev.action.isDial()) return;
		const dial: DialState = {
			action: ev.action,
			settings: ev.payload.settings,
			coalescer: new TickCoalescer((ticks, fast) => {
				bridge.send({ type: "dial", property: current(dial.settings), ticks, fast });
			}),
			holdTimer: undefined,
			menuIndex: undefined,
		};
		this.dials.set(ev.action.id, dial);
		await this.render(dial, bridge.state);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		const dial = this.dials.get(ev.action.id);
		dial?.coalescer.cancel();
		if (dial?.holdTimer !== undefined) clearTimeout(dial.holdTimer);
		this.dials.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		const dial = this.dials.get(ev.action.id);
		if (!dial) return;
		dial.settings = ev.payload.settings;
		await this.render(dial, bridge.state);
	}

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const dial = this.dials.get(ev.action.id);
		if (!dial) return;
		if (!ev.payload.pressed) {
			dial.coalescer.add(ev.payload.ticks, Math.abs(ev.payload.ticks) > FAST_TICKS);
			return;
		}
		// Turning while held opens the menu straight away rather than waiting for the hold timer.
		if (dial.menuIndex === undefined) this.openMenu(dial);
		dial.menuIndex = wrapIndex(dial.menuIndex ?? 0, Math.sign(ev.payload.ticks), menu(dial.settings).length);
		await this.render(dial, bridge.state);
	}

	override onDialDown(ev: DialDownEvent<Settings>): void {
		const dial = this.dials.get(ev.action.id);
		if (!dial) return;
		dial.menuIndex = undefined;
		dial.holdTimer = setTimeout(() => {
			dial.holdTimer = undefined;
			this.openMenu(dial);
			void this.render(dial, bridge.state);
		}, HOLD_MS);
	}

	override async onDialUp(ev: DialUpEvent<Settings>): Promise<void> {
		const dial = this.dials.get(ev.action.id);
		if (!dial) return;
		if (dial.holdTimer !== undefined) clearTimeout(dial.holdTimer);
		dial.holdTimer = undefined;

		if (dial.menuIndex === undefined) {
			// A quick click: next mode for the current property.
			bridge.send({ type: "mode", property: current(dial.settings) });
			return;
		}

		const picked = menu(dial.settings)[dial.menuIndex];
		dial.menuIndex = undefined;
		dial.settings = { ...dial.settings, current: picked };
		await dial.action.setSettings(dial.settings);
		await this.render(dial, bridge.state);
	}

	override onTouchTap(ev: TouchTapEvent<Settings>): void {
		const dial = this.dials.get(ev.action.id);
		if (dial) bridge.send({ type: "reset", property: current(dial.settings) });
	}

	private openMenu(dial: DialState): void {
		if (dial.holdTimer !== undefined) clearTimeout(dial.holdTimer);
		dial.holdTimer = undefined;
		dial.menuIndex = Math.max(0, menu(dial.settings).indexOf(current(dial.settings)));
	}

	private async render(dial: DialState, state: StateMessage | undefined): Promise<void> {
		try {
			await dial.action.setFeedback(dial.menuIndex === undefined ? valueFeedback(dial, state) : menuFeedback(dial, state));
		} catch (err) {
			streamDeck.logger.warn(`setFeedback failed: ${String(err)}`);
		}
	}
}

function valueFeedback(dial: DialState, state: StateMessage | undefined): FeedbackPayload {
	const info = PROPERTIES[current(dial.settings)];
	const value = state?.values[info.id];
	const mode = state?.modes[info.id];
	let text: string;
	if (!bridge.connected) text = "Open plugin";
	else if (!state || state.selectionCount === 0) text = "No selection";
	else if (value === undefined) text = "n/a";
	else text = formatValue(value, info);

	// Hide the bar when there's no number to show, otherwise an empty track reads like a value.
	const indicator = typeof value === "number" && bridge.connected ? { value: indicatorPercent(value, info), enabled: true } : { enabled: false };
	return { title: mode && value !== undefined ? `${info.label} · ${mode}` : info.label, value: text, indicator };
}

function menuFeedback(dial: DialState, state: StateMessage | undefined): FeedbackPayload {
	const list = menu(dial.settings);
	const id = list[dial.menuIndex ?? 0];
	// Properties the selection can't use stay in the menu but are marked, so the list doesn't jump around.
	const usable = !state || state.selectionCount === 0 || id in state.values;
	return {
		title: `Pick effect  ${(dial.menuIndex ?? 0) + 1}/${list.length}`,
		value: `‹ ${PROPERTIES[id].label}${usable ? "" : " ✕"} ›`,
		indicator: { enabled: false },
	};
}

function menu(settings: Settings): PropertyId[] {
	const picked = (settings.menu ?? []).filter(isPropertyId);
	return picked.length > 0 ? PROPERTY_ORDER.filter((p) => picked.includes(p)) : DEFAULT_MENU;
}

function current(settings: Settings): PropertyId {
	return isPropertyId(settings.current) ? settings.current : PROPERTY_ORDER[0];
}
