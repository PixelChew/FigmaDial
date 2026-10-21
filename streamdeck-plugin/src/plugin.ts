import streamDeck from "@elgato/streamdeck";

import { FieldDial } from "./actions/field-dial";
import { PropertyDial } from "./actions/property-dial";
import { ShortcutKey } from "./actions/shortcut-key";
import { bridge } from "./bridge";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new PropertyDial());
streamDeck.actions.registerAction(new FieldDial());
streamDeck.actions.registerAction(new ShortcutKey());

bridge.start();

streamDeck.connect();
