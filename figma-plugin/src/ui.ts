// Hidden UI iframe: owns the WebSocket to the Stream Deck plugin, because the plugin's main thread has no network access.
// Everything received is relayed to code.ts untouched; parsing happens there.
import { backoffMs, DEFAULT_PORT } from "@figmadeck/protocol";

import type { CodeToUi, UiToCode } from "./messages";

const url = `ws://localhost:${DEFAULT_PORT}`;
let socket: WebSocket | undefined;
let attempt = 0;

function showStatus(text: string): void {
	document.body.textContent = text;
}

function toCode(msg: UiToCode): void {
	parent.postMessage({ pluginMessage: msg }, "*");
}

function connect(): void {
	console.log(`[FigmaDeck] connecting to ${url} (attempt ${attempt + 1})`);
	showStatus(attempt === 0 ? "Connecting to Stream Deck…" : `Stream Deck not found, retrying (${attempt + 1})…`);
	let ws: WebSocket;
	try {
		ws = new WebSocket(url);
	} catch (err) {
		// Figma throws synchronously when the manifest's networkAccess doesn't allow the URL.
		console.error("[FigmaDeck] WebSocket blocked:", err);
		showStatus(`Blocked: ${String(err)}`);
		return;
	}
	socket = ws;

	ws.onopen = () => {
		console.log("[FigmaDeck] connected to Stream Deck");
		showStatus("Connected to Stream Deck ✓");
		attempt = 0;
		toCode({ kind: "status", connected: true });
	};
	ws.onmessage = (event) => toCode({ kind: "ws", data: String(event.data) });
	ws.onclose = (event) => {
		console.warn(`[FigmaDeck] connection closed (code ${event.code}), retrying in ${backoffMs(attempt) / 1000} s`);
		if (socket === ws) socket = undefined;
		toCode({ kind: "status", connected: false });
		setTimeout(connect, backoffMs(attempt++));
	};
	// onclose always follows onerror, so reconnecting happens there.
	ws.onerror = () => undefined;
}

window.onmessage = (event: MessageEvent<{ pluginMessage?: CodeToUi }>) => {
	const msg = event.data.pluginMessage;
	if (msg?.kind === "send" && socket?.readyState === WebSocket.OPEN) socket.send(msg.data);
};

connect();
