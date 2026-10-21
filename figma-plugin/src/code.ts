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
import { ADAPTERS, aggregate, firstNumber } from "./properties";

figma.showUI(__html__, { visible: false });
console.log("[FigmaDeck] plugin started");

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
	for (const id of PROPERTY_ORDER) {
		const value = aggregate(id, nodes);
		if (value !== undefined) values[id] = value;
	}
	const state: StateMessage = { type: "state", fileName: figma.root.name, selectionCount: nodes.length, values };
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

function setAll(id: PropertyId, nodes: readonly SceneNode[], value: number): void {
	for (const node of nodes) ADAPTERS[id].set(node, value);
}

function handle(msg: ToFigma): void {
	if (msg.type === "refresh") {
		sendState();
		return;
	}

	const nodes = selection();
	const current = aggregate(msg.property, nodes);
	if (current === undefined) return;
	const info = PROPERTIES[msg.property];

	if (msg.type === "reset") {
		setAll(msg.property, nodes, info.reset);
		figma.commitUndo();
	} else {
		// A mixed selection snaps to the first layer's value, then steps.
		const next = stepValue(current, firstNumber(msg.property, nodes, info.reset), msg.ticks, msg.fast, info);
		setAll(msg.property, nodes, next);
		scheduleUndoCommit();
	}
	sendState();
}

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
	if (parsed) handle(parsed);
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
