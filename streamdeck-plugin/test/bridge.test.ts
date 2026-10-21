import { afterAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

vi.mock("@elgato/streamdeck", () => {
	const scope = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	return { default: { logger: { createScope: () => scope } } };
});

const { bridge } = await import("../src/bridge");

const PORT = 18787;
const sockets: WebSocket[] = [];

/** Connects like the Figma plugin's UI does, collecting what the bridge sends. */
async function figmaClient(): Promise<{ socket: WebSocket; received: unknown[] }> {
	const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
	sockets.push(socket);
	const received: unknown[] = [];
	socket.on("message", (data) => received.push(JSON.parse(data.toString())));
	await new Promise((resolve) => socket.once("open", resolve));
	return { socket, received };
}

const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 1000 });

afterAll(() => sockets.forEach((s) => s.close()));

describe("bridge", () => {
	bridge.start(PORT);

	it("asks a new client for state and relays its state to listeners", async () => {
		const states: unknown[] = [];
		bridge.onState((s) => states.push(s));
		const a = await figmaClient();
		await until(() => a.received.length === 1);
		expect(a.received[0]).toEqual({ type: "refresh" });

		a.socket.send(JSON.stringify({ type: "state", fileName: "A", selectionCount: 1, values: { opacity: 40 } }));
		await until(() => bridge.state?.fileName === "A");
		expect(states.at(-1)).toMatchObject({ values: { opacity: 40 } });
	});

	it("sends dials to whichever file spoke last, and falls back when it closes", async () => {
		const b = await figmaClient();
		b.socket.send(JSON.stringify({ type: "state", fileName: "B", selectionCount: 0, values: {} }));
		await until(() => bridge.state?.fileName === "B");

		expect(bridge.send({ type: "dial", property: "opacity", ticks: 2, fast: false })).toBe(true);
		await until(() => b.received.some((m) => (m as { type: string }).type === "dial"));

		b.socket.close();
		await until(() => bridge.state === undefined);
		expect(bridge.connected).toBe(true);
	});
});
