import streamDeck from "@elgato/streamdeck";
import { DEFAULT_PORT, parseToStreamDeck, type StateMessage, type ToFigma } from "@figmadeck/protocol";
import { WebSocket, WebSocketServer } from "ws";

const logger = streamDeck.logger.createScope("Bridge");

type StateListener = (state: StateMessage | undefined) => void;

/**
 * Localhost WebSocket server that the Figma plugin's hidden UI connects to.
 *
 * Several Figma files can run the plugin at once. The one that most recently sent a message
 * (it sends state whenever its selection changes) is treated as active and receives the dials.
 */
class FigmaBridge {
	private server: WebSocketServer | undefined;
	private active: WebSocket | undefined;
	private latest: StateMessage | undefined;
	private readonly listeners = new Set<StateListener>();

	start(port = DEFAULT_PORT): void {
		if (this.server) return;
		const server = new WebSocketServer({ host: "127.0.0.1", port });
		this.server = server;

		server.on("listening", () => logger.info(`Listening on ws://localhost:${port}`));
		server.on("error", (err) => logger.error(`Server error (is port ${port} taken?): ${err.message}`));
		server.on("connection", (socket) => {
			logger.info("Figma plugin connected");
			this.activate(socket);
			this.send({ type: "refresh" });

			socket.on("message", (data) => {
				const msg = parseToStreamDeck(data.toString());
				if (!msg) return;
				this.activate(socket);
				this.latest = msg;
				this.emit();
			});

			socket.on("close", () => {
				logger.info("Figma plugin disconnected");
				if (this.active !== socket) return;
				// Hand over to any other open Figma file, otherwise show the disconnected state.
				this.active = [...server.clients].find((c) => c !== socket && c.readyState === WebSocket.OPEN);
				this.latest = undefined;
				if (this.active) this.send({ type: "refresh" });
				this.emit();
			});
		});
	}

	get connected(): boolean {
		return this.active?.readyState === WebSocket.OPEN;
	}

	get state(): StateMessage | undefined {
		return this.latest;
	}

	send(msg: ToFigma): boolean {
		if (!this.connected) return false;
		this.active!.send(JSON.stringify(msg));
		return true;
	}

	onState(listener: StateListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private activate(socket: WebSocket): void {
		this.active = socket;
	}

	private emit(): void {
		for (const listener of this.listeners) listener(this.latest);
	}
}

export const bridge = new FigmaBridge();
