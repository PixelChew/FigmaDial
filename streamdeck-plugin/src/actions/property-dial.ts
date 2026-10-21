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
} from "@elgato/streamdeck";
import {
	FAST_TICKS,
	formatValue,
	indicatorPercent,
	isPropertyId,
	nextProperty,
	PROPERTIES,
	PROPERTY_ORDER,
	TickCoalescer,
	type PropertyId,
	type StateMessage,
} from "@figma-dial/protocol";

import { bridge } from "../bridge";

type Settings = {
	/** Properties this dial cycles through, in order. Empty or missing means all of them. */
	properties?: PropertyId[];
	/** Property the dial currently controls. */
	current?: PropertyId;
};

type DialState = {
	action: DialAction<Settings>;
	settings: Settings;
	coalescer: TickCoalescer;
	/** True when the dial turned while held, so releasing it shouldn't count as a press. */
	turnedWhilePressed: boolean;
};

/**
 * Controls a Figma property on the current selection. Turn to change it, press to cycle to the next property
 * the selection supports, tap the touch strip to reset. Figma reports values back, so the strip is always live.
 */
@action({ UUID: "com.pixelchew.figma-dial.property" })
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
			turnedWhilePressed: false,
		};
		this.dials.set(ev.action.id, dial);
		await this.render(dial, bridge.state);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.dials.get(ev.action.id)?.coalescer.cancel();
		this.dials.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		const dial = this.dials.get(ev.action.id);
		if (!dial) return;
		dial.settings = ev.payload.settings;
		await this.render(dial, bridge.state);
	}

	override onDialRotate(ev: DialRotateEvent<Settings>): void {
		const dial = this.dials.get(ev.action.id);
		if (!dial) return;
		if (ev.payload.pressed) dial.turnedWhilePressed = true;
		dial.coalescer.add(ev.payload.ticks, ev.payload.pressed || Math.abs(ev.payload.ticks) > FAST_TICKS);
	}

	override onDialDown(ev: DialDownEvent<Settings>): void {
		const dial = this.dials.get(ev.action.id);
		if (dial) dial.turnedWhilePressed = false;
	}

	override async onDialUp(ev: DialUpEvent<Settings>): Promise<void> {
		const dial = this.dials.get(ev.action.id);
		if (!dial || dial.turnedWhilePressed) return;

		// Cycle through the enabled properties the selection supports; with nothing selected, cycle through all of them.
		const order = enabled(dial.settings);
		const values = bridge.state?.values ?? {};
		const supported = new Set(order.filter((p) => p in values));
		const next = nextProperty(current(dial.settings), order, supported.size > 0 ? supported : new Set(order));

		dial.settings = { ...dial.settings, current: next };
		await dial.action.setSettings(dial.settings);
		await this.render(dial, bridge.state);
	}

	override onTouchTap(ev: TouchTapEvent<Settings>): void {
		const dial = this.dials.get(ev.action.id);
		if (dial) bridge.send({ type: "reset", property: current(dial.settings) });
	}

	private async render(dial: DialState, state: StateMessage | undefined): Promise<void> {
		const info = PROPERTIES[current(dial.settings)];
		const value = state?.values[info.id];
		let text: string;
		if (!bridge.connected) text = "Open plugin";
		else if (!state || state.selectionCount === 0) text = "No selection";
		else if (value === undefined) text = "n/a";
		else text = formatValue(value, info);

		try {
			await dial.action.setFeedback({ title: info.label, value: text, indicator: { value: indicatorPercent(value, info) } });
		} catch (err) {
			streamDeck.logger.warn(`setFeedback failed: ${String(err)}`);
		}
	}
}

function enabled(settings: Settings): PropertyId[] {
	const list = (settings.properties ?? []).filter(isPropertyId);
	return list.length > 0 ? PROPERTY_ORDER.filter((p) => list.includes(p)) : PROPERTY_ORDER;
}

function current(settings: Settings): PropertyId {
	const order = enabled(settings);
	return settings.current && order.includes(settings.current) ? settings.current : order[0];
}
