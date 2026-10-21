/** Messages between the plugin's main thread (code.ts) and its hidden UI iframe (ui.ts), which owns the WebSocket. */
export type UiToCode = { kind: "ws"; data: string } | { kind: "status"; connected: boolean };
export type CodeToUi = { kind: "send"; data: string };
