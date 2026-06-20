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
// a watcher that respawns it. The server crashes (ucrtbase 0xc0000409 / stack
// overflow 0xc00000fd) and the respawned instance can hang — alive but not
// listening on 1844 — which a Stream Deck restart does not fix.
//
// Recovery is staged so the common case stays quiet:
//   1. Kill the server and let the watcher respawn it (no prompt).
//   2. If that fails, the server is hung on startup because of the current audio
//      state, which only an audio-session reset clears. Restarting Windows Audio
//      needs admin, so we relaunch elevated (one UAC prompt) to bounce
//      AudioEndpointBuilder and start the server. (May still fail if the OS
//      can't reset cleanly — then a reboot is the only fix.)
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
 * Recovers the audio server. Stage 1 (no prompt): kill it and let the watcher
 * respawn it. Stage 2 (UAC): if it stays hung, restart Windows Audio elevated to
 * clear the session/device state and relaunch the server. Returns whether the
 * server became reachable.
 */
async function restartAudioServer(): Promise<boolean> {
  await run("taskkill", ["/F", "/IM", SERVER_IMAGE]).catch(() => {
    // Not running / already gone is fine — we still try to bring it up below.
  });

  // Drop our stale socket so the reachability probe forces a fresh connect.
  audioControlClient.disconnect();

  if (await waitForServer(10000)) {
    return true;
  }

  // Still hung — escalate to an elevated audio reset (pops a UAC prompt).
  await runElevatedAudioReset().catch((error) => {
    // Includes the user declining UAC; nothing more we can do without admin.
    streamDeck.logger.warn(`Elevated audio reset did not run: ${String(error)}`);
  });
  return waitForServer(14000);
}

/**
 * Relaunches PowerShell elevated (UAC) to bounce Windows Audio and start the
 * server. Resetting AudioEndpointBuilder cascades through Audiosrv, clearing the
 * audio sessions that make the server hang on startup. The inner script is
 * base64-encoded so its quoting survives the RunAs relaunch.
 */
function runElevatedAudioReset(): Promise<void> {
  const script = [
    "$ErrorActionPreference='SilentlyContinue';",
    `Get-Process -Name '${SERVER_IMAGE.replace(/\.exe$/i, "")}' | Stop-Process -Force;`,
    "Restart-Service -Name AudioEndpointBuilder -Force;",
    "Start-Sleep -Seconds 2;",
    `Start-Process -FilePath '${SERVER_EXE}'`,
  ].join(" ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const launch = `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`;
  return run("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", launch]);
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
