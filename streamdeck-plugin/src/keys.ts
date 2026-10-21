import streamDeck from "@elgato/streamdeck";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const logger = streamDeck.logger.createScope("Keys");

export type Modifier = "command" | "shift" | "option" | "control";

/** A key command: either a macOS virtual key code (arrows, Tab…) or a character, with modifiers and a repeat count. */
export type KeyCommand = { code: number; char?: never } | { char: string; code?: never };
export type KeyPress = KeyCommand & { modifiers?: Modifier[]; repeat?: number };

export const KEY = { up: 126, down: 125, tab: 48, return: 36, escape: 53 } as const;

/**
 * A long-running JavaScript for Automation process that reads one JSON key press per line from stdin
 * and sends it through System Events, but only while Figma is the frontmost app.
 * Spawning osascript per keystroke costs ~100 ms, which makes a dial feel laggy, so it stays alive.
 */
const JXA = String.raw`
ObjC.import("Foundation");
const se = Application("System Events");
const stdin = $.NSFileHandle.fileHandleWithStandardInput;
let buffer = "";
function frontmostIsFigma() {
	try { return se.processes.whose({ frontmost: true })[0].name().startsWith("Figma"); } catch (e) { return false; }
}
while (true) {
	const data = stdin.availableData;
	if (data.length === 0) break;
	buffer += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
	const lines = buffer.split("\n");
	buffer = lines.pop();
	for (const line of lines) {
		if (!line) continue;
		const press = JSON.parse(line);
		if (!frontmostIsFigma()) continue;
		const using = (press.modifiers || []).map((m) => m + " down");
		for (let i = 0; i < (press.repeat || 1); i++) {
			if (press.code !== undefined) se.keyCode(press.code, { using });
			else se.keystroke(press.char, { using });
		}
	}
}
`;

class KeySender {
	private child: ChildProcessWithoutNullStreams | undefined;

	send(press: KeyPress): void {
		if (process.platform !== "darwin") {
			logger.warn("Keystrokes are only implemented for macOS");
			return;
		}
		this.ensureRunning().stdin.write(`${JSON.stringify(press)}\n`);
	}

	private ensureRunning(): ChildProcessWithoutNullStreams {
		if (this.child && this.child.exitCode === null) return this.child;

		const child = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", JXA]);
		child.stderr.on("data", (data) => {
			// Most likely cause: Stream Deck hasn't been granted Accessibility access in System Settings.
			logger.error(`osascript: ${data.toString().trim()}`);
		});
		child.on("exit", (code) => {
			logger.warn(`osascript exited with code ${code}; it restarts on the next key press`);
			if (this.child === child) this.child = undefined;
		});
		this.child = child;
		return child;
	}
}

export const keys = new KeySender();
