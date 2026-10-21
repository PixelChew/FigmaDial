/**
 * Shared contract between the Stream Deck plugin (WebSocket server) and the Figma plugin (WebSocket client).
 * Both sides import this file, so a message shape can't change on one side without breaking the other's build.
 *
 * Rules:
 * - The Stream Deck sends deltas (ticks), never absolute values. Figma is the source of truth.
 * - Values are in display units: opacity is 0–100, everything else is pixels.
 */

export const DEFAULT_PORT = 8787;

/** How long dial ticks are buffered before being sent as one message. */
export const COALESCE_MS = 20;

/** How long the dial must be still before Figma commits an undo step, so one Cmd+Z undoes a whole turn. */
export const UNDO_IDLE_MS = 400;

export type PropertyId = "opacity" | "layerBlur" | "cornerRadius" | "strokeWeight" | "itemSpacing";

export interface PropertyInfo {
	id: PropertyId;
	/** Short label for the touch strip. */
	label: string;
	unit: "%" | "px";
	/** Change per tick. */
	step: number;
	/** Change per tick when the dial is turned fast or held down while turning. */
	fastStep: number;
	min: number;
	/** Upper bound for the value, and for the touch strip bar. */
	max: number;
	/** Value a tap on the touch strip resets to. */
	reset: number;
}

export const PROPERTIES: Record<PropertyId, PropertyInfo> = {
	opacity: { id: "opacity", label: "Opacity", unit: "%", step: 1, fastStep: 5, min: 0, max: 100, reset: 100 },
	layerBlur: { id: "layerBlur", label: "Blur", unit: "px", step: 1, fastStep: 5, min: 0, max: 250, reset: 0 },
	cornerRadius: { id: "cornerRadius", label: "Radius", unit: "px", step: 1, fastStep: 8, min: 0, max: 200, reset: 0 },
	strokeWeight: { id: "strokeWeight", label: "Stroke", unit: "px", step: 1, fastStep: 4, min: 0, max: 100, reset: 1 },
	itemSpacing: { id: "itemSpacing", label: "Gap", unit: "px", step: 1, fastStep: 8, min: 0, max: 400, reset: 0 },
};

export const PROPERTY_ORDER: PropertyId[] = ["opacity", "layerBlur", "cornerRadius", "strokeWeight", "itemSpacing"];

export function isPropertyId(value: unknown): value is PropertyId {
	return typeof value === "string" && value in PROPERTIES;
}

/** A property's value across the current selection: a number, "mixed" when layers differ, or absent when unsupported. */
export type PropertyValue = number | "mixed";

// Stream Deck -> Figma

export interface DialMessage {
	type: "dial";
	property: PropertyId;
	ticks: number;
	fast: boolean;
}

export interface ResetMessage {
	type: "reset";
	property: PropertyId;
}

/** Asks Figma to send a fresh state message. */
export interface RefreshMessage {
	type: "refresh";
}

export type ToFigma = DialMessage | ResetMessage | RefreshMessage;

// Figma -> Stream Deck

export interface StateMessage {
	type: "state";
	/** Name of the Figma file, so it's obvious which window the dials are driving. */
	fileName: string;
	selectionCount: number;
	/** Only properties every selected layer supports are present. */
	values: Partial<Record<PropertyId, PropertyValue>>;
}

export type ToStreamDeck = StateMessage;

export function parseToFigma(raw: string): ToFigma | undefined {
	const msg = safeParse(raw);
	if (msg?.type === "refresh") return { type: "refresh" };
	if (!isPropertyId(msg?.property)) return undefined;
	if (msg.type === "reset") return { type: "reset", property: msg.property };
	if (msg.type === "dial" && typeof msg.ticks === "number" && Number.isInteger(msg.ticks)) {
		return { type: "dial", property: msg.property, ticks: msg.ticks, fast: msg.fast === true };
	}
	return undefined;
}

export function parseToStreamDeck(raw: string): ToStreamDeck | undefined {
	const msg = safeParse(raw);
	if (msg?.type !== "state" || typeof msg.selectionCount !== "number" || typeof msg.values !== "object" || msg.values === null) {
		return undefined;
	}
	const values: StateMessage["values"] = {};
	for (const [key, value] of Object.entries(msg.values as Record<string, unknown>)) {
		if (isPropertyId(key) && (typeof value === "number" || value === "mixed")) values[key] = value;
	}
	return { type: "state", fileName: typeof msg.fileName === "string" ? msg.fileName : "", selectionCount: msg.selectionCount, values };
}

function safeParse(raw: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(raw);
		return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

// Pure logic shared by both sides

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Rounds to two decimals so repeated float steps don't drift (0.1 + 0.2 style). */
export function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Applies dial ticks to a value. A "mixed" value snaps to `fallback` (the first selected layer's value) before stepping.
 */
export function stepValue(current: PropertyValue, fallback: number, ticks: number, fast: boolean, info: PropertyInfo): number {
	const base = current === "mixed" ? fallback : current;
	const step = fast ? info.fastStep : info.step;
	return round2(clamp(base + ticks * step, info.min, info.max));
}

/** A spin counts as fast when one rotate event carries more than this many ticks. */
export const FAST_TICKS = 3;

/**
 * Picks the next property for a dial press: the next one after `current` in `order` that the selection supports.
 * Falls back to `current` when nothing else is supported.
 */
export function nextProperty(current: PropertyId, order: PropertyId[], supported: ReadonlySet<PropertyId>): PropertyId {
	const start = order.indexOf(current);
	for (let i = 1; i <= order.length; i++) {
		const candidate = order[(start + i) % order.length];
		if (supported.has(candidate)) return candidate;
	}
	return current;
}

/** Reconnect delay for attempt n (0-based): 1 s, 2 s, 4 s, 8 s, then capped at 10 s. */
export function backoffMs(attempt: number): number {
	return Math.min(10_000, 1000 * 2 ** attempt);
}

export function formatValue(value: PropertyValue | undefined, info: PropertyInfo): string {
	if (value === undefined) return "–";
	if (value === "mixed") return "Mixed";
	return `${round2(value)}${info.unit === "%" ? "%" : " px"}`;
}

/** Touch strip bar fill, 0–100. */
export function indicatorPercent(value: PropertyValue | undefined, info: PropertyInfo): number {
	if (typeof value !== "number") return 0;
	return Math.round((clamp(value, info.min, info.max) / info.max) * 100);
}

/**
 * Buffers ticks for a short window and flushes them as one total, so a fast spin sends a handful of messages instead of dozens.
 * Timer functions are injectable for tests.
 */
export class TickCoalescer {
	private ticks = 0;
	private fast = false;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly flush: (ticks: number, fast: boolean) => void,
		private readonly delayMs = COALESCE_MS,
		private readonly timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout },
	) {}

	add(ticks: number, fast: boolean): void {
		this.ticks += ticks;
		this.fast ||= fast;
		if (this.timer === undefined) {
			this.timer = this.timers.set(() => this.emit(), this.delayMs);
		}
	}

	cancel(): void {
		if (this.timer !== undefined) this.timers.clear(this.timer);
		this.timer = undefined;
		this.ticks = 0;
		this.fast = false;
	}

	private emit(): void {
		const { ticks, fast } = this;
		this.cancel();
		if (ticks !== 0) this.flush(ticks, fast);
	}
}
