import type { PropertyId, PropertyValue } from "@figmadeck/protocol";

/** How one property is read from and written to a node, in display units (opacity 0–100, everything else px). */
interface Adapter {
	supports(node: SceneNode): boolean;
	get(node: SceneNode): PropertyValue;
	set(node: SceneNode, value: number): void;
	/** The property's secondary setting that a dial press cycles through, e.g. stroke position. */
	modes: ModeSpec;
}

/** Modes are identified by their touch strip label. */
interface ModeSpec {
	order: readonly string[];
	get(node: SceneNode): string;
	set(node: SceneNode, mode: string): void;
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

export const ADAPTERS: Record<PropertyId, Adapter> = { opacity, layerBlur, cornerRadius, strokeWeight, itemSpacing };

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

/** The property's mode across all nodes, "Mixed" when they differ, or undefined when any node doesn't support the property. */
export function aggregateMode(id: PropertyId, nodes: readonly SceneNode[]): string | undefined {
	const adapter = ADAPTERS[id];
	if (nodes.length === 0 || !nodes.every((n) => adapter.supports(n))) return undefined;
	const first = adapter.modes.get(nodes[0]);
	return nodes.every((n) => adapter.modes.get(n) === first) ? first : "Mixed";
}

/** Moves every node to the mode after the first node's one. Nodes that refuse a mode (e.g. an open path can only stroke centre) keep theirs. */
export function cycleMode(id: PropertyId, nodes: readonly SceneNode[]): void {
	const { order, get, set } = ADAPTERS[id].modes;
	const next = order[(order.indexOf(get(nodes[0])) + 1) % order.length];
	for (const node of nodes) {
		try {
			set(node, next);
		} catch (err) {
			console.warn(`[FigmaDeck] couldn't set ${id} mode to ${next} on ${node.name}:`, err);
		}
	}
}
