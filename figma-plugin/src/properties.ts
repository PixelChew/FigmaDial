import type { PropertyId, PropertyValue } from "@figmadeck/protocol";

/** How one property is read from and written to a node, in display units (opacity 0–100, everything else px). */
interface Adapter {
	supports(node: SceneNode): boolean;
	get(node: SceneNode): PropertyValue;
	/** May be async: text changes have to load the node's fonts first. */
	set(node: SceneNode, value: number): void | Promise<void>;
	/** The property's secondary setting that a dial press cycles through, e.g. stroke position. */
	modes?: ModeSpec;
	/** Replaces "set to PropertyInfo.reset" for a tap on the strip, e.g. removing a shadow outright. */
	reset?(node: SceneNode): void;
	/** Step per tick that replaces the property's default, e.g. rotation's 15° snap mode. */
	step?(): number | undefined;
	/** Flip the dial's direction, so turning clockwise rotates the layer clockwise (Figma counts counter-clockwise). */
	invert?: boolean;
}

/** Modes are identified by their touch strip label. */
interface ModeSpec {
	order: readonly string[];
	get(node: SceneNode): string;
	set(node: SceneNode, mode: string): void | Promise<void>;
}

type With<K extends string> = SceneNode & Record<K, unknown>;

function has<K extends string>(node: SceneNode, key: K): node is With<K> {
	return key in node;
}

function numberOrMixed(value: number | PluginAPI["mixed"]): PropertyValue {
	return typeof value === "number" ? value : "mixed";
}

const opacity: Adapter = {
	supports: (node) => has(node, "opacity"),
	get: (node) => Math.round((node as BlendMixin & SceneNode).opacity * 10000) / 100,
	set: (node, value) => {
		(node as BlendMixin & SceneNode).opacity = value / 100;
	},
	modes: {
		order: ["Normal", "Darken", "Multiply", "Lighten", "Screen", "Overlay"],
		get: (node) => {
			const mode = (node as BlendMixin & SceneNode).blendMode;
			if (mode === "PASS_THROUGH" || mode === "NORMAL") return "Normal";
			return mode.charAt(0) + mode.slice(1).toLowerCase().replace(/_/g, " ");
		},
		set: (node, mode) => {
			// Frames and groups default to pass through, which is what "Normal" means in their layer panel.
			const normal: BlendMode = "children" in node ? "PASS_THROUGH" : "NORMAL";
			(node as BlendMixin & SceneNode).blendMode = mode === "Normal" ? normal : (mode.toUpperCase() as BlendMode);
		},
	},
};

type BlurType = "LAYER_BLUR" | "BACKGROUND_BLUR";
const BLUR_LABELS: Record<BlurType, string> = { LAYER_BLUR: "Layer", BACKGROUND_BLUR: "Background" };
const isBlur = (e: Effect): e is BlurEffect => e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR";

/** Blur type used when the dial adds a blur to a layer that has none; set by pressing the dial. */
let newBlurType: BlurType = "LAYER_BLUR";

const layerBlur: Adapter = {
	supports: (node) => has(node, "effects"),
	get: (node) => (node as BlendMixin & SceneNode).effects.find(isBlur)?.radius ?? 0,
	set: (node, value) => {
		const target = node as BlendMixin & SceneNode;
		const effects = [...target.effects];
		const index = effects.findIndex(isBlur);
		if (index >= 0) {
			const blur = effects[index] as BlurEffect;
			// Dialling down to zero removes the blur rather than leaving an invisible effect behind.
			if (value <= 0) effects.splice(index, 1);
			else effects[index] = { ...blur, radius: value };
		} else if (value > 0) {
			effects.push({ type: newBlurType, blurType: "NORMAL", radius: value, visible: true });
		}
		target.effects = effects;
	},
	modes: {
		order: [BLUR_LABELS.LAYER_BLUR, BLUR_LABELS.BACKGROUND_BLUR],
		get: (node) => BLUR_LABELS[(node as BlendMixin & SceneNode).effects.find(isBlur)?.type ?? newBlurType],
		set: (node, mode) => {
			newBlurType = mode === BLUR_LABELS.BACKGROUND_BLUR ? "BACKGROUND_BLUR" : "LAYER_BLUR";
			const target = node as BlendMixin & SceneNode;
			target.effects = target.effects.map((e) => (isBlur(e) ? ({ ...e, type: newBlurType } as BlurEffect) : e));
		},
	},
};

const cornerRadius: Adapter = {
	supports: (node) => has(node, "cornerRadius"),
	get: (node) => numberOrMixed((node as CornerMixin & SceneNode).cornerRadius),
	set: (node, value) => {
		(node as CornerMixin & SceneNode).cornerRadius = value;
	},
	modes: {
		// Corner smoothing: off, Figma's "iOS" preset (60%), and fully smooth.
		order: ["Smooth 0%", "Smooth 60%", "Smooth 100%"],
		get: (node) => `Smooth ${Math.round(((node as CornerMixin & SceneNode).cornerSmoothing ?? 0) * 100)}%`,
		set: (node, mode) => {
			if (has(node, "cornerSmoothing")) (node as CornerMixin & SceneNode).cornerSmoothing = parseInt(mode.replace(/\D/g, ""), 10) / 100;
		},
	},
};

/** Figma's own default when you add a stroke: solid black. */
const DEFAULT_STROKE: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };

const strokeWeight: Adapter = {
	supports: (node) => has(node, "strokeWeight") && has(node, "strokes"),
	// A layer without a stroke reads as 0, so dialling up from nothing adds one.
	get: (node) => {
		const target = node as MinimalStrokesMixin & SceneNode;
		return target.strokes.length === 0 ? 0 : numberOrMixed(target.strokeWeight);
	},
	set: (node, value) => {
		const target = node as MinimalStrokesMixin & SceneNode;
		// Like blur, dialling down to zero removes the stroke rather than leaving an invisible one.
		if (value <= 0) {
			target.strokes = [];
			return;
		}
		if (target.strokes.length === 0) target.strokes = [DEFAULT_STROKE];
		target.strokeWeight = value;
	},
	modes: {
		order: ["Inside", "Outside", "Center"],
		get: (node) => {
			const align = (node as MinimalStrokesMixin & SceneNode).strokeAlign;
			return align.charAt(0) + align.slice(1).toLowerCase();
		},
		set: (node, mode) => {
			(node as MinimalStrokesMixin & SceneNode).strokeAlign = mode.toUpperCase() as MinimalStrokesMixin["strokeAlign"];
		},
	},
};

const itemSpacing: Adapter = {
	supports: (node) => {
		if (!has(node, "layoutMode")) return false;
		const mode = (node as AutoLayoutMixin & SceneNode).layoutMode;
		return mode === "HORIZONTAL" || mode === "VERTICAL";
	},
	get: (node) => (node as AutoLayoutMixin & SceneNode).itemSpacing,
	set: (node, value) => {
		(node as AutoLayoutMixin & SceneNode).itemSpacing = value;
	},
	modes: {
		order: ["Row", "Column", "Wrap"],
		get: (node) => {
			const frame = node as AutoLayoutMixin & SceneNode;
			if (frame.layoutMode === "VERTICAL") return "Column";
			return frame.layoutWrap === "WRAP" ? "Wrap" : "Row";
		},
		set: (node, mode) => {
			const frame = node as AutoLayoutMixin & SceneNode;
			// Wrapping is only allowed on horizontal layouts, so clear it before going vertical.
			frame.layoutWrap = "NO_WRAP";
			frame.layoutMode = mode === "Column" ? "VERTICAL" : "HORIZONTAL";
			if (mode === "Wrap") frame.layoutWrap = "WRAP";
		},
	},
};

type ShadowEffect = DropShadowEffect | InnerShadowEffect;
type ShadowParam = "Blur" | "Spread" | "X" | "Y";

/**
 * One dial each for drop and inner shadows. Click picks which part the dial changes: blur, spread, or the x/y offset.
 * Turning any of them on a layer without that shadow adds one with Figma's default look (black at 25%, 4 px down, 4 px blur);
 * tapping the strip removes it.
 */
function shadowAdapter(type: ShadowEffect["type"]): Adapter {
	let param: ShadowParam = "Blur";
	const find = (node: SceneNode) => (node as BlendMixin & SceneNode).effects.find((e): e is ShadowEffect => e.type === type);
	const read = (e: ShadowEffect): number =>
		param === "Blur" ? e.radius : param === "Spread" ? (e.spread ?? 0) : param === "X" ? e.offset.x : e.offset.y;

	return {
		supports: (node) => has(node, "effects"),
		get: (node) => {
			const effect = find(node);
			return effect ? read(effect) : 0;
		},
		set: (node, value) => {
			const target = node as BlendMixin & SceneNode;
			const effects = [...target.effects];
			let index = effects.findIndex((e) => e.type === type);
			if (index < 0) {
				if (value === 0) return;
				effects.push({ type, color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 4, spread: 0, visible: true, blendMode: "NORMAL" } as ShadowEffect);
				index = effects.length - 1;
			}
			const e = effects[index] as ShadowEffect;
			effects[index] = {
				...e,
				radius: param === "Blur" ? Math.max(0, value) : e.radius,
				spread: param === "Spread" ? value : e.spread,
				offset: { x: param === "X" ? value : e.offset.x, y: param === "Y" ? value : e.offset.y },
			} as ShadowEffect;
			target.effects = effects;
		},
		reset: (node) => {
			const target = node as BlendMixin & SceneNode;
			target.effects = target.effects.filter((e) => e.type !== type);
		},
		modes: {
			order: ["Blur", "Spread", "X", "Y"],
			get: () => param,
			set: (_node, mode) => {
				param = mode as ShadowParam;
			},
		},
	};
}

const shadow = shadowAdapter("DROP_SHADOW");
const innerShadow = shadowAdapter("INNER_SHADOW");

/** Which sides the padding dial changes. It's a dial setting, not something stored on the layer. */
let paddingSides: "All" | "Horizontal" | "Vertical" = "All";
const PADDING_KEYS = {
	All: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
	Horizontal: ["paddingLeft", "paddingRight"],
	Vertical: ["paddingTop", "paddingBottom"],
} as const;

const padding: Adapter = {
	supports: itemSpacing.supports,
	get: (node) => {
		const frame = node as AutoLayoutMixin & SceneNode;
		const values = PADDING_KEYS[paddingSides].map((key) => frame[key]);
		return values.every((v) => v === values[0]) ? values[0] : "mixed";
	},
	set: (node, value) => {
		const frame = node as AutoLayoutMixin & SceneNode;
		for (const key of PADDING_KEYS[paddingSides]) frame[key] = value;
	},
	modes: {
		order: ["All", "Horizontal", "Vertical"],
		get: () => paddingSides,
		set: (_node, mode) => {
			paddingSides = mode as typeof paddingSides;
		},
	},
};

let rotationSnap = false;

/** Rotates around the layer's centre, the way Figma's own rotation field does (the API's rotation setter pivots on the top-left). */
const rotation: Adapter = {
	supports: (node) => has(node, "rotation") && has(node, "relativeTransform") && has(node, "width"),
	get: (node) => Math.round((node as LayoutMixin & SceneNode).rotation * 100) / 100,
	set: (node, value) => {
		const target = node as LayoutMixin & SceneNode;
		const [[a, b, x], [c, d, y]] = target.relativeTransform;
		const { width: w, height: h } = target;
		const cx = x + a * (w / 2) + b * (h / 2);
		const cy = y + c * (w / 2) + d * (h / 2);
		const rad = (value * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		target.relativeTransform = [
			[cos, sin, cx - (cos * w) / 2 - (sin * h) / 2],
			[-sin, cos, cy + (sin * w) / 2 - (cos * h) / 2],
		];
	},
	modes: {
		order: ["1° steps", "15° snap"],
		get: () => (rotationSnap ? "15° snap" : "1° steps"),
		set: (_node, mode) => {
			rotationSnap = mode === "15° snap";
		},
	},
	step: () => (rotationSnap ? 15 : undefined),
	invert: true,
};

let sizeAxis: "Width" | "Height" | "Both" = "Width";

/** "Both" changes the width and scales the height with it, keeping the aspect ratio. */
const size: Adapter = {
	supports: (node) => has(node, "resize") && has(node, "width"),
	get: (node) => {
		const target = node as LayoutMixin & SceneNode;
		return Math.round((sizeAxis === "Height" ? target.height : target.width) * 100) / 100;
	},
	set: (node, value) => {
		const target = node as LayoutMixin & SceneNode;
		const { width, height } = target;
		if (sizeAxis === "Width") target.resize(value, height);
		else if (sizeAxis === "Height") target.resize(width, value);
		else target.resize(value, Math.max(0.01, (height / width) * value));
	},
	modes: {
		order: ["Width", "Height", "Both"],
		get: () => sizeAxis,
		set: (_node, mode) => {
			sizeAxis = mode as typeof sizeAxis;
		},
	},
};

const ALIGN_LABELS: Record<TextNode["textAlignHorizontal"], string> = { LEFT: "Left", CENTER: "Center", RIGHT: "Right", JUSTIFIED: "Justify" };

const fontSize: Adapter = {
	supports: (node) => node.type === "TEXT",
	get: (node) => numberOrMixed((node as TextNode).fontSize),
	set: async (node, value) => {
		const text = node as TextNode;
		await loadFonts(text);
		text.fontSize = value;
	},
	// Click cycles the text alignment, which doesn't need fonts loaded.
	modes: {
		order: Object.values(ALIGN_LABELS),
		get: (node) => ALIGN_LABELS[(node as TextNode).textAlignHorizontal],
		set: (node, mode) => {
			const entry = Object.entries(ALIGN_LABELS).find(([, label]) => label === mode);
			if (entry) (node as TextNode).textAlignHorizontal = entry[0] as TextNode["textAlignHorizontal"];
		},
	},
};

/** Figma's default fill for new shapes. */
const DEFAULT_FILL: SolidPaint = { type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } };
let fillTarget: "Top fill" | "All fills" = "Top fill";

const fillOpacity: Adapter = {
	supports: (node) => has(node, "fills"),
	get: (node) => {
		const fills = (node as MinimalFillsMixin & SceneNode).fills;
		if (fills === figma.mixed) return "mixed";
		const top = (fills as readonly Paint[])[(fills as readonly Paint[]).length - 1];
		return top ? Math.round((top.opacity ?? 1) * 10000) / 100 : 0;
	},
	set: (node, value) => {
		const target = node as MinimalFillsMixin & SceneNode;
		if (target.fills === figma.mixed) return;
		const fills = [...(target.fills as readonly Paint[])];
		// Like stroke: no fill reads as 0, and turning up adds one.
		if (fills.length === 0) {
			if (value <= 0) return;
			fills.push(DEFAULT_FILL);
		}
		const opacity = value / 100;
		target.fills = fills.map((paint, i) => (fillTarget === "All fills" || i === fills.length - 1 ? { ...paint, opacity } : paint));
	},
	modes: {
		order: ["Top fill", "All fills"],
		get: () => fillTarget,
		set: (_node, mode) => {
			fillTarget = mode as typeof fillTarget;
		},
	},
};

const smoothing: Adapter = {
	supports: (node) => has(node, "cornerSmoothing"),
	get: (node) => Math.round((node as CornerMixin & SceneNode).cornerSmoothing * 100),
	set: (node, value) => {
		(node as CornerMixin & SceneNode).cornerSmoothing = value / 100;
	},
};

let dashPart: "Dash" | "Gap" = "Dash";

/** Stroke dash pattern; 0 dash length means a solid stroke. */
const dashes: Adapter = {
	supports: (node) => has(node, "dashPattern"),
	get: (node) => {
		const pattern = (node as MinimalStrokesMixin & SceneNode).dashPattern;
		if (pattern.length === 0) return 0;
		return dashPart === "Dash" ? pattern[0] : (pattern[1] ?? pattern[0]);
	},
	set: (node, value) => {
		const target = node as MinimalStrokesMixin & SceneNode;
		const [dash = 0, gap = dash] = target.dashPattern;
		if (dashPart === "Dash") target.dashPattern = value <= 0 ? [] : [value, gap || value];
		else target.dashPattern = [dash || 4, value];
		// Dashes on a layer without a stroke would be invisible, so add one.
		if (target.dashPattern.length > 0 && target.strokes.length === 0) target.strokes = [DEFAULT_STROKE];
	},
	modes: {
		order: ["Dash", "Gap"],
		get: () => dashPart,
		set: (_node, mode) => {
			dashPart = mode as typeof dashPart;
		},
	},
};

/** Figma refuses most text edits until every font used in the layer is loaded. */
async function loadFonts(text: TextNode): Promise<void> {
	const fonts = text.characters.length > 0 ? text.getRangeAllFontNames(0, text.characters.length) : [text.fontName as FontName];
	await Promise.all(fonts.map((font) => figma.loadFontAsync(font)));
}

const isText = (node: SceneNode): node is TextNode => node.type === "TEXT";

const UNIT_LABELS = { PIXELS: "px", PERCENT: "%", AUTO: "Auto" } as const;

/** In Auto there's no number, so it reads as roughly what Figma renders (1.2× the font size) and turning switches to px. */
const lineHeight: Adapter = {
	supports: isText,
	get: (node) => {
		const text = node as TextNode;
		if (text.lineHeight === figma.mixed || text.fontSize === figma.mixed) return "mixed";
		return text.lineHeight.unit === "AUTO" ? Math.round(text.fontSize * 1.2) : text.lineHeight.value;
	},
	set: async (node, value) => {
		const text = node as TextNode;
		await loadFonts(text);
		const unit = text.lineHeight !== figma.mixed && text.lineHeight.unit === "PERCENT" ? "PERCENT" : "PIXELS";
		text.lineHeight = { value, unit };
	},
	modes: {
		order: [UNIT_LABELS.PIXELS, UNIT_LABELS.PERCENT, UNIT_LABELS.AUTO],
		get: (node) => {
			const lh = (node as TextNode).lineHeight;
			return lh === figma.mixed ? "Mixed" : UNIT_LABELS[lh.unit];
		},
		set: async (node, mode) => {
			const text = node as TextNode;
			if (text.fontSize === figma.mixed) return;
			await loadFonts(text);
			const px = lineHeight.get(node);
			if (typeof px !== "number") return;
			const currentPx = text.lineHeight !== figma.mixed && text.lineHeight.unit === "PERCENT" ? (px * text.fontSize) / 100 : px;
			if (mode === UNIT_LABELS.AUTO) text.lineHeight = { unit: "AUTO" };
			else if (mode === UNIT_LABELS.PERCENT) text.lineHeight = { value: Math.round((currentPx / text.fontSize) * 100), unit: "PERCENT" };
			else text.lineHeight = { value: Math.round(currentPx), unit: "PIXELS" };
		},
	},
};

const letterSpacing: Adapter = {
	supports: isText,
	get: (node) => {
		const ls = (node as TextNode).letterSpacing;
		return ls === figma.mixed ? "mixed" : Math.round(ls.value * 100) / 100;
	},
	set: async (node, value) => {
		const text = node as TextNode;
		await loadFonts(text);
		const unit = text.letterSpacing !== figma.mixed ? text.letterSpacing.unit : "PIXELS";
		text.letterSpacing = { value, unit };
	},
	modes: {
		order: [UNIT_LABELS.PIXELS, UNIT_LABELS.PERCENT],
		get: (node) => {
			const ls = (node as TextNode).letterSpacing;
			return ls === figma.mixed ? "Mixed" : UNIT_LABELS[ls.unit];
		},
		set: async (node, mode) => {
			const text = node as TextNode;
			if (text.letterSpacing === figma.mixed || text.fontSize === figma.mixed) return;
			await loadFonts(text);
			const { value, unit } = text.letterSpacing;
			const px = unit === "PERCENT" ? (value * text.fontSize) / 100 : value;
			text.letterSpacing =
				mode === UNIT_LABELS.PERCENT ? { value: Math.round((px / text.fontSize) * 10000) / 100, unit: "PERCENT" } : { value: Math.round(px * 100) / 100, unit: "PIXELS" };
		},
	},
};

let paragraphField: "Spacing" | "Indent" = "Spacing";

const paragraph: Adapter = {
	supports: isText,
	get: (node) => numberOrMixed(paragraphField === "Spacing" ? (node as TextNode).paragraphSpacing : (node as TextNode).paragraphIndent),
	set: async (node, value) => {
		const text = node as TextNode;
		await loadFonts(text);
		if (paragraphField === "Spacing") text.paragraphSpacing = value;
		else text.paragraphIndent = value;
	},
	modes: {
		order: ["Spacing", "Indent"],
		get: () => paragraphField,
		set: (_node, mode) => {
			paragraphField = mode as typeof paragraphField;
		},
	},
};

export const ADAPTERS: Record<PropertyId, Adapter> = {
	opacity,
	layerBlur,
	shadow,
	cornerRadius,
	strokeWeight,
	itemSpacing,
	padding,
	rotation,
	size,
	fontSize,
	innerShadow,
	fillOpacity,
	smoothing,
	dashes,
	lineHeight,
	letterSpacing,
	paragraph,
};

/**
 * The property's value across all nodes: a number when they agree, "mixed" when they don't,
 * or undefined when any node doesn't support it.
 */
export function aggregate(id: PropertyId, nodes: readonly SceneNode[]): PropertyValue | undefined {
	const adapter = ADAPTERS[id];
	if (nodes.length === 0 || !nodes.every((n) => adapter.supports(n))) return undefined;
	const first = adapter.get(nodes[0]);
	for (const node of nodes.slice(1)) {
		const value = adapter.get(node);
		if (value === "mixed" || first === "mixed" || Math.abs(value - first) > 0.005) return "mixed";
	}
	return first;
}

/** The first number found across the nodes, used as the starting point when stepping a mixed value. */
export function firstNumber(id: PropertyId, nodes: readonly SceneNode[], otherwise: number): number {
	for (const node of nodes) {
		const value = ADAPTERS[id].get(node);
		if (typeof value === "number") return value;
	}
	return otherwise;
}

/** The property's mode across all nodes, "Mixed" when they differ, or undefined when the property has no modes or a node doesn't support it. */
export function aggregateMode(id: PropertyId, nodes: readonly SceneNode[]): string | undefined {
	const adapter = ADAPTERS[id];
	if (!adapter.modes || nodes.length === 0 || !nodes.every((n) => adapter.supports(n))) return undefined;
	const first = adapter.modes.get(nodes[0]);
	return nodes.every((n) => adapter.modes!.get(n) === first) ? first : "Mixed";
}

/** Moves every node to the mode after the first node's one. Nodes that refuse a mode (e.g. an open path can only stroke centre) keep theirs. */
export async function cycleMode(id: PropertyId, nodes: readonly SceneNode[]): Promise<void> {
	const modes = ADAPTERS[id].modes;
	if (!modes) return;
	const next = modes.order[(modes.order.indexOf(modes.get(nodes[0])) + 1) % modes.order.length];
	for (const node of nodes) {
		try {
			await modes.set(node, next);
		} catch (err) {
			console.warn(`[FigmaDeck] couldn't set ${id} mode to ${next} on ${node.name}:`, err);
		}
	}
}
