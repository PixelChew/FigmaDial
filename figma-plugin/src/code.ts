// Main thread: applies dial messages to the selection and reports values back to the Stream Deck.
import {
	parseToFigma,
	PROPERTIES,
	PROPERTY_ORDER,
	stepValue,
	UNDO_IDLE_MS,
	type PropertyId,
	type StateMessage,
	type ToFigma,
} from "@figmadeck/protocol";

import type { CodeToUi, UiToCode } from "./messages";
import { ADAPTERS, aggregate, aggregateMode, cycleMode, firstNumber } from "./properties";

// A small status window, so it's obvious the plugin is running and whether it reached the Stream Deck.
figma.showUI(__html__, { width: 240, height: 56, title: "FigmaDeck", themeColors: true });
console.log("[FigmaDeck] plugin started");
figma.notify("FigmaDeck started, looking for Stream Deck…");

let undoTimer: ReturnType<typeof setTimeout> | undefined;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
let wasConnected = false;

function toUi(msg: CodeToUi): void {
	figma.ui.postMessage(msg);
}

function selection(): readonly SceneNode[] {
	return figma.currentPage.selection;
}

function sendState(): void {
	const nodes = selection();
	const values: StateMessage["values"] = {};
	const modes: StateMessage["modes"] = {};
	for (const id of PROPERTY_ORDER) {
		const value = aggregate(id, nodes);
		if (value !== undefined) values[id] = value;
		const mode = aggregateMode(id, nodes);
		if (mode !== undefined) modes[id] = mode;
	}
	const state: StateMessage = { type: "state", fileName: figma.root.name, selectionCount: nodes.length, values, modes };
	toUi({ kind: "send", data: JSON.stringify(state) });
}

/** Debounced, because a dial turn or a drag can fire many node changes in a row. */
function scheduleState(): void {
	if (stateTimer !== undefined) clearTimeout(stateTimer);
	stateTimer = setTimeout(sendState, 50);
}

/** Groups every change from one turn of the dial into a single undo step. */
function scheduleUndoCommit(): void {
	if (undoTimer !== undefined) clearTimeout(undoTimer);
	undoTimer = setTimeout(() => {
		undoTimer = undefined;
		figma.commitUndo();
	}, UNDO_IDLE_MS);
}

async function setAll(id: PropertyId, nodes: readonly SceneNode[], value: number): Promise<void> {
	await Promise.all(
		nodes.map(async (node) => {
			try {
				await ADAPTERS[id].set(node, value);
			} catch (err) {
				console.warn(`[FigmaDeck] couldn't set ${id} on ${node.name}:`, err);
			}
		}),
	);
}

async function handle(msg: ToFigma): Promise<void> {
	if (msg.type === "refresh") {
		sendState();
		return;
	}

	const nodes = selection();
	const current = aggregate(msg.property, nodes);
	if (current === undefined) return;
	const info = PROPERTIES[msg.property];

	if (msg.type === "reset") {
		const reset = ADAPTERS[msg.property].reset;
		if (reset) nodes.forEach(reset);
		else if (info.reset !== undefined) await setAll(msg.property, nodes, info.reset);
		else return;
		figma.commitUndo();
	} else if (msg.type === "mode") {
		await cycleMode(msg.property, nodes);
		figma.commitUndo();
	} else if (info.relative) {
		const adapter = ADAPTERS[msg.property];
		const delta = (adapter.invert ? -msg.ticks : msg.ticks) * (adapter.step?.() ?? (msg.fast ? info.fastStep : info.step));
		await Promise.all(
			nodes.map(async (node) => {
				const value = adapter.get(node);
				if (typeof value === "number") await adapter.set(node, value + delta);
			}),
		);
		scheduleUndoCommit();
	} else {
		// A mixed selection snaps to the first layer's value, then steps.
		const fallback = firstNumber(msg.property, nodes, info.reset ?? info.min);
		const adapter = ADAPTERS[msg.property];
		const ticks = adapter.invert ? -msg.ticks : msg.ticks;
		const next = stepValue(current, fallback, ticks, msg.fast, info, adapter.step?.());
		await setAll(msg.property, nodes, next);
		scheduleUndoCommit();
	}
	sendState();
}

/** Messages are handled one at a time, so a slow async change (loading fonts) can't interleave with the next tick. */
let queue: Promise<void> = Promise.resolve();

figma.ui.onmessage = (msg: UiToCode) => {
	if (msg.kind === "status") {
		if (msg.connected) {
			figma.notify("FigmaDeck connected to Stream Deck");
			sendState();
		} else if (wasConnected) {
			figma.notify("FigmaDeck lost the Stream Deck, retrying…");
		}
		wasConnected = msg.connected;
		return;
	}
	const parsed = parseToFigma(msg.data);
	if (parsed) queue = queue.then(() => handle(parsed)).catch((err) => console.error("[FigmaDeck]", err));
};

let watchedPage: PageNode | undefined;

function watchPage(page: PageNode): void {
	watchedPage?.off("nodechange", scheduleState);
	page.on("nodechange", scheduleState);
	watchedPage = page;
}

figma.on("selectionchange", sendState);
figma.on("currentpagechange", () => {
	watchPage(figma.currentPage);
	sendState();
});
watchPage(figma.currentPage);
