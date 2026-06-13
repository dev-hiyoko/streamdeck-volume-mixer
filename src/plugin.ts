import streamDeck from "@elgato/streamdeck";

import { AppVolumeAction } from "./actions/app-volume.js";
import { RestartServerAction } from "./actions/restart-server.js";
import { audioControlClient } from "./audio-control-client.js";

// Survival net: a transient WebSocket timeout/close rejects a pending request,
// and any such rejection that escapes a background task would otherwise kill the
// Node process — which is exactly what shows up as the key going "offline" and
// never coming back. Audio Control errors are always transient (the server
// crashes/hangs and the watcher respawns it), so log and keep running; the poll
// loop reconnects on its own. Never exit on these.
process.on("unhandledRejection", (reason) => {
  streamDeck.logger.warn(`Ignored unhandled rejection to keep the plugin alive: ${String(reason)}`);
});

process.on("uncaughtException", (error) => {
  streamDeck.logger.error(`Ignored uncaught exception to keep the plugin alive: ${String(error)}`);
});

streamDeck.actions.registerAction(new AppVolumeAction());
streamDeck.actions.registerAction(new RestartServerAction());

audioControlClient.connect().catch((error) => {
  streamDeck.logger.warn(`Audio Control WebSocket is not ready yet: ${String(error)}`);
});

streamDeck.connect();
