import streamDeck from "@elgato/streamdeck";

import { AppVolumeAction } from "./actions/app-volume.js";
import { audioControlClient } from "./audio-control-client.js";

streamDeck.actions.registerAction(new AppVolumeAction());

audioControlClient.connect().catch((error) => {
  streamDeck.logger.warn(`Audio Control WebSocket is not ready yet: ${String(error)}`);
});

streamDeck.connect();
