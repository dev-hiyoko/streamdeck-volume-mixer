import { execFile } from "node:child_process";

import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { audioControlClient } from "../audio-control-client.js";
import { renderKeyImage } from "../key-image.js";

// The Elgato Volume Controller plugin launches ElgatoAudioControlServer.exe and
// a watcher that respawns it. The server occasionally crashes (0xc0000409 in
// ucrtbase) and the respawned instance can hang — alive but not listening on
// 1844 — which a Stream Deck restart does not fix. Killing the hung process lets
// the watcher spin up a working one; the direct launch is a fallback for when
// the watcher itself is gone.
const SERVER_IMAGE = "ElgatoAudioControlServer.exe";
const SERVER_EXE = "C:\\Program Files\\Elgato\\Volume Controller\\ElgatoAudioControlServer.exe";

type RestartSettings = JsonObject;

@action({ UUID: "fun.hiyoko.volumemixer.restart-server" })
export class RestartServerAction extends SingletonAction<RestartSettings> {
  override async onWillAppear(ev: WillAppearEvent<RestartSettings>): Promise<void> {
    await ev.action.setImage(renderKeyImage({ kind: "restart", status: "idle" }));
    await ev.action.setTitle("");
  }

  override async onKeyDown(ev: KeyDownEvent<RestartSettings>): Promise<void> {
    await ev.action.setImage(renderKeyImage({ kind: "restart", status: "working" }));
    let ok = false;
    try {
      ok = await restartAudioServer();
    } catch (error) {
      streamDeck.logger.warn(`Audio server restart failed: ${String(error)}`);
    }
    await ev.action.setImage(renderKeyImage({ kind: "restart", status: ok ? "ok" : "error" }));
    // Settle back to the idle glyph so the key is ready for next time.
    setTimeout(() => {
      ev.action.setImage(renderKeyImage({ kind: "restart", status: "idle" })).catch(() => {});
    }, 2500);
  }
}

/**
 * Kills the audio server and waits for it to listen on 1844 again — first via
 * the watcher's respawn, then via a direct launch as a fallback. Returns whether
 * the server became reachable within the timeout.
 */
async function restartAudioServer(): Promise<boolean> {
  await run("taskkill", ["/F", "/IM", SERVER_IMAGE]).catch(() => {
    // Not running / already gone is fine — we still try to bring it up below.
  });

  // Drop our stale socket so the reachability probe forces a fresh connect.
  audioControlClient.disconnect();

  if (await waitForServer(12000)) {
    return true;
  }

  // Watcher did not bring it back — launch the server directly.
  await run(SERVER_EXE, []).catch((error) => {
    streamDeck.logger.warn(`Direct audio-server launch failed: ${String(error)}`);
  });
  return waitForServer(8000);
}

/** Polls the audio server until a connection succeeds or the timeout elapses. */
async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(500);
    try {
      await audioControlClient.connect();
      return true;
    } catch {
      // Not up yet — keep polling.
    }
  }
  return false;
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
