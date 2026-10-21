import type { PropertyId, PropertyValue } from "@figma-dial/protocol";

/** How one property is read from and written to a node, in display units (opacity 0–100, everything else px). */
interface Adapter {
	supports(node: SceneNode): boolean;
	get(node: SceneNode): PropertyValue;
	set(node: SceneNode, value: number): void;
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
};

const layerBlur: Adapter = {
	supports: (node) => has(node, "effects"),
	get: (node) => {
		const blur = (node as BlendMixin & SceneNode).effects.find((e) => e.type === "LAYER_BLUR");
		return blur && blur.type === "LAYER_BLUR" ? blur.radius : 0;
	},
	set: (node, value) => {
		const target = node as BlendMixin & SceneNode;
		const effects = [...target.effects];
		const index = effects.findIndex((e) => e.type === "LAYER_BLUR");
		if (index >= 0) {
			const blur = effects[index] as BlurEffect;
			// Dialling down to zero removes the blur rather than leaving an invisible effect behind.
			if (value <= 0) effects.splice(index, 1);
			else effects[index] = { ...blur, radius: value };
		} else if (value > 0) {
			effects.push({ type: "LAYER_BLUR", blurType: "NORMAL", radius: value, visible: true });
		}
		target.effects = effects;
	},
};

const cornerRadius: Adapter = {
	supports: (node) => has(node, "cornerRadius"),
	get: (node) => numberOrMixed((node as CornerMixin & SceneNode).cornerRadius),
	set: (node, value) => {
		(node as CornerMixin & SceneNode).cornerRadius = value;
	},
};

const strokeWeight: Adapter = {
	// Without a stroke, changing the weight does nothing visible, so it isn't offered.
	supports: (node) => has(node, "strokeWeight") && has(node, "strokes") && (node as MinimalStrokesMixin & SceneNode).strokes.length > 0,
	get: (node) => numberOrMixed((node as MinimalStrokesMixin & SceneNode).strokeWeight),
	set: (node, value) => {
		(node as MinimalStrokesMixin & SceneNode).strokeWeight = value;
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
