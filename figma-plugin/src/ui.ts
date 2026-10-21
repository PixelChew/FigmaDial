// Hidden UI iframe: owns the WebSocket to the Stream Deck plugin, because the plugin's main thread has no network access.
// Everything received is relayed to code.ts untouched; parsing happens there.
import { backoffMs, DEFAULT_PORT } from "@figmadeck/protocol";

import type { CodeToUi, UiToCode } from "./messages";

const url = `ws://localhost:${DEFAULT_PORT}`;
let socket: WebSocket | undefined;
let attempt = 0;

function toCode(msg: UiToCode): void {
	parent.postMessage({ pluginMessage: msg }, "*");
}

function connect(): void {
	const ws = new WebSocket(url);
	socket = ws;

	ws.onopen = () => {
		attempt = 0;
		toCode({ kind: "status", connected: true });
	};
	ws.onmessage = (event) => toCode({ kind: "ws", data: String(event.data) });
	ws.onclose = () => {
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
