# Figma Dial

Control Figma from the Stream Deck+ dials and keys (macOS).

| Action | Where | What it does |
| --- | --- | --- |
| **Property dial** | Dial | Turn to change opacity, layer blur, corner radius, stroke weight or auto-layout gap on the selection. Press to cycle to the next property your selection supports. Tap the touch strip to reset. Hold while turning for bigger steps. The touch strip shows the live value. One turn is one undo step. |
| **Focused field** | Dial | Nudges whichever number field has focus in Figma's properties panel (it sends ↑/↓, hold to send Shift+↑/↓ for ×10). Press to Tab to the next field, tap the strip to leave the field. Works on any field, without the Figma plugin, but can't show the value. |
| **Figma shortcut** | Key | Fires a Figma shortcut: paste in place, paste to replace, copy/paste properties, frame selection, auto layout, group, component, run last plugin, and more. |

## How it fits together

```
Stream Deck+ ──► Stream Deck plugin (Node) ──ws://localhost:8787──► Figma plugin UI (hidden iframe) ──postMessage──► Figma plugin code ──► your selection
                         ▲                                                                                                │
                         └─────────────────────────── state: current values for the selection ◄──────────────────────────┘
```

- `protocol/` holds the message types and the pure logic (stepping, clamping, cycling), shared by both sides so they can't drift apart.
- `streamdeck-plugin/` is the Elgato plugin. It runs a WebSocket server on `127.0.0.1:8787`.
- `figma-plugin/` is a Figma development plugin. Its hidden UI connects to that server and reconnects on its own (1 s, 2 s, 4 s… up to 10 s).

The Property dial needs the Figma plugin running in the file you're working on. The Focused field dial and shortcut keys don't; they send keystrokes, and only while Figma is the frontmost app.

## First-time setup (Mac)

You need Node 20 or later (`brew install node`), the Stream Deck app 7.1 or later, and the Figma **desktop** app.

```sh
git clone https://github.com/PixelChew/FigmaDial.git
cd FigmaDial
npm install
npm run build
```

### 1. Load the Stream Deck plugin

```sh
npm install -g @elgato/cli
streamdeck dev                     # turns on developer mode in the Stream Deck app (once)
cd streamdeck-plugin
streamdeck link com.pixelchew.figma-dial.sdPlugin
streamdeck restart com.pixelchew.figma-dial
```

"Figma Dial" now shows up in the Stream Deck app's action list. Drag **Property dial** and **Focused field** onto dials, and **Figma shortcut** onto keys (pick the shortcut in the panel below).

### 2. Load the Figma plugin

In Figma desktop, open any design file, then **Plugins → Development → Import plugin from manifest…** and pick `figma-plugin/manifest.json`. Run it from **Plugins → Development → Figma Dial**. A "connected to Stream Deck" toast means the bridge works.

The plugin has no window; it keeps running until you close the file. Put a **Figma shortcut → Run last plugin** key on your deck so starting it is one press.

### 3. Allow keystrokes (for Focused field and shortcut keys)

macOS needs to let Stream Deck send keys:

1. **System Settings → Privacy & Security → Accessibility**: turn on **Elgato Stream Deck**.
2. The first time you use a keystroke action, macOS asks whether Stream Deck may control **System Events**. Allow it. (If you missed it, it's under **Privacy & Security → Automation**.)

## Developing

```sh
cd streamdeck-plugin && npm run watch     # rebuilds and restarts the Stream Deck plugin on save
cd figma-plugin && npm run watch          # rebuilds the Figma plugin; re-run it in Figma with ⌥⌘P
npm test                                  # from the repo root: protocol logic and bridge tests
npm run typecheck
```

Stream Deck plugin logs are in `streamdeck-plugin/com.pixelchew.figma-dial.sdPlugin/logs/`. Figma plugin logs are in Figma's developer console (**Plugins → Development → Show/Hide console**).

### Adding a property

1. Add it to `PropertyId`, `PROPERTIES` and `PROPERTY_ORDER` in `protocol/src/index.ts`.
2. Add an adapter (supports / get / set) in `figma-plugin/src/properties.ts`.
3. Add a checkbox in `streamdeck-plugin/com.pixelchew.figma-dial.sdPlugin/ui/property-dial.html`.

## Known limits

- A Figma plugin can't see which properties-panel field has focus, so "the dial follows the field I clicked" is done with keystrokes (Focused field), not the plugin API.
- Plugins can't paste, so paste actions are keystrokes too.
- The Figma plugin only works as a development plugin (Figma allows `localhost` only under `devAllowedDomains`).
- Port 8787 is fixed for now. If something else uses it, the Stream Deck log says so.
- The icons are Elgato's template placeholders.
