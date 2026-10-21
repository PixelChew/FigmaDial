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

export type PropertyId =
	| "opacity"
	| "layerBlur"
	| "shadow"
	| "cornerRadius"
	| "strokeWeight"
	| "itemSpacing"
	| "padding"
	| "rotation"
	| "size"
	| "fontSize"
	| "innerShadow"
	| "fillOpacity"
	| "smoothing"
	| "dashes"
	| "lineHeight"
	| "letterSpacing"
	| "paragraph"
	| "nudge";

export interface PropertyInfo {
	id: PropertyId;
	/** Short label for the touch strip. */
	label: string;
	/** Empty when the unit depends on the mode (line height and letter spacing can be px or %); the mode label says which. */
	unit: "%" | "px" | "°" | "";
	/** Change per tick. */
	step: number;
	/** Change per tick when the dial is turned fast or held down while turning. */
	fastStep: number;
	min: number;
	/** Upper bound for the value. */
	max: number;
	/**
	 * Whether the touch strip shows a fill bar. Only effects with a natural range get one: a bar on font size or gap
	 * would just show how far the value is from an arbitrary cap. "selection" means the range comes from the layer
	 * itself (radius fills up as the shape becomes a pill or circle) and Figma reports it in `StateMessage.barMax`.
	 */
	bar?: "range" | "selection";
	/** Value a tap on the touch strip resets to; none means tapping does nothing. */
	reset?: number;
	/** Each layer moves by the delta from its own value instead of all snapping to one value (nudging a multi-selection keeps their spacing). */
	relative?: boolean;
}

export const PROPERTIES: Record<PropertyId, PropertyInfo> = {
	opacity: { id: "opacity", label: "Opacity", unit: "%", step: 1, fastStep: 5, min: 0, max: 100, reset: 100, bar: "range" },
	layerBlur: { id: "layerBlur", label: "Blur", unit: "px", step: 1, fastStep: 5, min: 0, max: 250, reset: 0 },
	cornerRadius: { id: "cornerRadius", label: "Radius", unit: "px", step: 1, fastStep: 8, min: 0, max: 200, reset: 0, bar: "selection" },
	strokeWeight: { id: "strokeWeight", label: "Stroke", unit: "px", step: 1, fastStep: 4, min: 0, max: 100, reset: 1 },
	itemSpacing: { id: "itemSpacing", label: "Gap", unit: "px", step: 1, fastStep: 8, min: 0, max: 400, reset: 0 },
	shadow: { id: "shadow", label: "Shadow", unit: "px", step: 1, fastStep: 4, min: -100, max: 100, reset: 0 },
	padding: { id: "padding", label: "Padding", unit: "px", step: 1, fastStep: 8, min: 0, max: 400, reset: 0 },
	rotation: { id: "rotation", label: "Rotate", unit: "°", step: 1, fastStep: 15, min: -180, max: 180, reset: 0, bar: "range" },
	size: { id: "size", label: "Size", unit: "px", step: 1, fastStep: 10, min: 1, max: 4000 },
	fontSize: { id: "fontSize", label: "Font", unit: "px", step: 1, fastStep: 4, min: 1, max: 400 },
	innerShadow: { id: "innerShadow", label: "Inner", unit: "px", step: 1, fastStep: 4, min: -100, max: 100, reset: 0 },
	fillOpacity: { id: "fillOpacity", label: "Fill", unit: "%", step: 1, fastStep: 5, min: 0, max: 100, reset: 100, bar: "range" },
	smoothing: { id: "smoothing", label: "Smooth", unit: "%", step: 1, fastStep: 10, min: 0, max: 100, reset: 0, bar: "range" },
	dashes: { id: "dashes", label: "Dashes", unit: "px", step: 1, fastStep: 4, min: 0, max: 100, reset: 0 },
	lineHeight: { id: "lineHeight", label: "Line", unit: "", step: 1, fastStep: 5, min: 0, max: 400 },
	letterSpacing: { id: "letterSpacing", label: "Letter", unit: "", step: 0.5, fastStep: 2, min: -50, max: 100, reset: 0 },
	paragraph: { id: "paragraph", label: "Paragraph", unit: "px", step: 1, fastStep: 4, min: 0, max: 400, reset: 0 },
	nudge: { id: "nudge", label: "Nudge", unit: "px", step: 1, fastStep: 10, min: -100000, max: 100000, relative: true },
};

export const PROPERTY_ORDER: PropertyId[] = [
	"opacity",
	"layerBlur",
	"shadow",
	"cornerRadius",
	"strokeWeight",
	"itemSpacing",
	"padding",
	"rotation",
	"size",
	"fontSize",
	"innerShadow",
	"fillOpacity",
	"smoothing",
	"dashes",
	"lineHeight",
	"letterSpacing",
	"paragraph",
	"nudge",
];

/** What the hold menu lists until a dial's settings say otherwise. */
export const DEFAULT_MENU: PropertyId[] = PROPERTY_ORDER.slice(0, 10);

/** What kind of layer is selected, so a dial can jump to the effect that matters most for it. */
export type SelectionKind = "none" | "mixed" | "text" | "autoLayout" | "frame" | "shape" | "line" | "group";

const SELECTION_KINDS: readonly SelectionKind[] = ["none", "mixed", "text", "autoLayout", "frame", "shape", "line", "group"];

/** The effect a dial with auto-switch turns to for each kind of selection. */
export const AUTO_PROPERTY: Partial<Record<SelectionKind, PropertyId>> = {
	text: "fontSize",
	autoLayout: "itemSpacing",
	frame: "cornerRadius",
	shape: "cornerRadius",
	line: "strokeWeight",
	group: "opacity",
};

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

/** Moves the property to its next mode, e.g. stroke Inside → Outside → Center. */
export interface ModeMessage {
	type: "mode";
	property: PropertyId;
}

/** Asks Figma to send a fresh state message. */
export interface RefreshMessage {
	type: "refresh";
}

export type ToFigma = DialMessage | ResetMessage | ModeMessage | RefreshMessage;

// Figma -> Stream Deck

export interface StateMessage {
	type: "state";
	/** Name of the Figma file, so it's obvious which window the dials are driving. */
	fileName: string;
	selectionCount: number;
	/** What kind of layer is selected; "mixed" when the selected layers differ. */
	kind: SelectionKind;
	/** Only properties every selected layer supports are present. */
	values: Partial<Record<PropertyId, PropertyValue>>;
	/** Each supported property's current mode label, or "Mixed". */
	modes: Partial<Record<PropertyId, string>>;
	/** Upper end of the bar for effects whose range depends on the layer, e.g. radius is full at half the shorter side. */
	barMax?: Partial<Record<PropertyId, number>>;
}

export type ToStreamDeck = StateMessage;

export function parseToFigma(raw: string): ToFigma | undefined {
	const msg = safeParse(raw);
	if (msg?.type === "refresh") return { type: "refresh" };
	if (!isPropertyId(msg?.property)) return undefined;
	if (msg.type === "reset" || msg.type === "mode") return { type: msg.type, property: msg.property };
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
	const modes: StateMessage["modes"] = {};
	if (typeof msg.modes === "object" && msg.modes !== null) {
		for (const [key, value] of Object.entries(msg.modes as Record<string, unknown>)) {
			if (isPropertyId(key) && typeof value === "string") modes[key] = value;
		}
	}
	const barMax: NonNullable<StateMessage["barMax"]> = {};
	if (typeof msg.barMax === "object" && msg.barMax !== null) {
		for (const [key, value] of Object.entries(msg.barMax as Record<string, unknown>)) {
			if (isPropertyId(key) && typeof value === "number" && value > 0) barMax[key] = value;
		}
	}
	const kind = SELECTION_KINDS.includes(msg.kind as SelectionKind) ? (msg.kind as SelectionKind) : "mixed";
	return { type: "state", fileName: typeof msg.fileName === "string" ? msg.fileName : "", selectionCount: msg.selectionCount, kind, values, modes, barMax };
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
export function stepValue(
	current: PropertyValue,
	fallback: number,
	ticks: number,
	fast: boolean,
	info: PropertyInfo,
	stepOverride?: number,
): number {
	const base = current === "mixed" ? fallback : current;
	const step = stepOverride ?? (fast ? info.fastStep : info.step);
	return round2(clamp(base + ticks * step, info.min, info.max));
}

/** A spin counts as fast when one rotate event carries more than this many ticks. */
export const FAST_TICKS = 3;

/** How long the dial must be held before the property menu opens on the touch strip. */
export const HOLD_MS = 350;

/** Moves through a list by ticks, wrapping at both ends. */
export function wrapIndex(index: number, ticks: number, length: number): number {
	return (((index + ticks) % length) + length) % length;
}

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
	return `${round2(value)}${info.unit === "px" ? " px" : info.unit}`;
}

/** Touch strip bar fill, 0–100, or undefined when the effect has no bar or its range isn't known. */
export function indicatorPercent(value: PropertyValue | undefined, info: PropertyInfo, barMax?: number): number | undefined {
	if (typeof value !== "number" || !info.bar) return undefined;
	const max = info.bar === "selection" ? barMax : info.max;
	if (max === undefined || max <= info.min) return undefined;
	return Math.round(((clamp(value, info.min, max) - info.min) / (max - info.min)) * 100);
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
