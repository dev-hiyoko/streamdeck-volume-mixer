import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

/**
 * Settings shared across every mixer key. Detection options decide the global
 * slot ordering and the volume step is a shared preference, so they live in
 * Stream Deck's global settings rather than per-action. App-name aliases let
 * the user rename a detected app everywhere it appears.
 */
export const MIN_POLL_MS = 500;
export const MAX_POLL_MS = 10000;

export type GlobalMixerSettings = {
  showApps: "all" | "active";
  groupDuplicates: boolean;
  /** Volume step as a 0.0–1.0 fraction. */
  step: number;
  /** How often to poll for newly started/stopped audio apps, in milliseconds. */
  pollMs: number;
  /** Map of detected app name -> custom display name. */
  aliases: Record<string, string>;
  /** App-name keys in priority order; listed apps take the lower slots first. */
  order: string[];
};

// The global settings object is shared with auto-app-state (which owns
// `devices`); we only read/write `detection`/`aliases`/`order` and preserve the rest.
type GlobalState = JsonObject & {
  detection?: Partial<Pick<GlobalMixerSettings, "showApps" | "groupDuplicates" | "step" | "pollMs">>;
  aliases?: Record<string, string>;
  order?: string[];
};

export const DEFAULT_MIXER_SETTINGS: GlobalMixerSettings = {
  showApps: "active",
  groupDuplicates: true,
  step: 0.05,
  pollMs: 1500,
  aliases: {},
  order: [],
};

function normalizeAliases(aliases: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (aliases && typeof aliases === "object") {
    for (const [key, value] of Object.entries(aliases)) {
      if (typeof value === "string" && value.trim()) {
        out[key] = value.trim();
      }
    }
  }
  return out;
}

export async function getGlobalMixerSettings(): Promise<GlobalMixerSettings> {
  const state = (await streamDeck.settings.getGlobalSettings<GlobalState>()) ?? {};
  const d = state.detection ?? {};
  const pollMs = Number(d.pollMs);
  return {
    showApps: d.showApps === "all" ? "all" : "active",
    groupDuplicates: d.groupDuplicates !== false,
    step: typeof d.step === "number" && d.step > 0 && d.step <= 1 ? d.step : DEFAULT_MIXER_SETTINGS.step,
    pollMs: Number.isFinite(pollMs) ? Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, pollMs)) : DEFAULT_MIXER_SETTINGS.pollMs,
    aliases: normalizeAliases(state.aliases),
    order: Array.isArray(state.order) ? state.order.filter((k): k is string => typeof k === "string") : [],
  };
}
