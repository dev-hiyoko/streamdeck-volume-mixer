import streamDeck from "@elgato/streamdeck";
import WebSocket, { type RawData } from "ws";

const AUDIO_CONTROL_URL = "ws://127.0.0.1:1844";
const REQUEST_TIMEOUT_MS = 3000;

export type AudioControlActivity = 2 | 3 | 4 | number;

export type SystemDefaultDevice = {
  deviceID: string;
  friendlyName: string;
  hardwareID?: string;
  iconPath?: string;
  mute: boolean;
  volume: number;
};

export type ApplicationInstance = {
  processID: number;
  name?: string;
  displayName?: string;
  executableFile: string;
  executablePath?: string;
  iconPath?: string;
  mute: boolean;
  volume: number;
  activity: AudioControlActivity;
};

type JsonRpcSuccess<T> = {
  jsonrpc: "2.0";
  id: number;
  result: T;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id: number;
  error: {
    code?: number;
    message?: string;
  };
};

type PendingRequest<T> = {
  method: string;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

export class AudioControlClient {
  private socket?: WebSocket;
  private connectPromise?: Promise<void>;
  private nextId = 1;
  private pending = new Map<number, PendingRequest<unknown>>();
  private messageListeners = new Set<(event: any) => void>();
  private instancesCache?: { at: number; value: ApplicationInstance[] };
  private instancesInFlight?: Promise<ApplicationInstance[]>;

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  onMessage(listener: (event: any) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  async getSystemDefaultDevice(): Promise<SystemDefaultDevice> {
    return this.request<SystemDefaultDevice>("getSystemDefaultDevice", {});
  }

  async setSystemDefaultDeviceVolume(volume: number): Promise<void> {
    await this.requestNoResponse("setSystemDefaultDeviceVolume", {
      processID: 0,
      volume: clampVolume(volume),
    });
  }

  async setSystemDefaultDeviceMute(mute: boolean): Promise<void> {
    await this.requestNoResponse("setSystemDefaultDeviceMute", {
      processID: 0,
      mute,
    });
  }

  async getApplicationInstanceCount(): Promise<number> {
    const result = await this.request<{ count: number }>("getApplicationInstanceCount", {});
    return result.count;
  }

  async getApplicationInstanceAtIndex(index: number): Promise<ApplicationInstance> {
    return this.request<ApplicationInstance>("getApplicationInstanceAtIndex", { index });
  }

  /**
   * Returns the application sessions, cached briefly. Every visible key reads
   * this on each refresh, so without caching a single notification would fan out
   * to N keys × (count + N index) WebSocket round-trips and swamp the server.
   * Concurrent callers share one in-flight fetch; `maxAgeMs` lets callers that
   * need fresh data (e.g. right before a key acts) bypass the cache.
   */
  async getApplicationInstances(maxAgeMs = 1000): Promise<ApplicationInstance[]> {
    const cache = this.instancesCache;
    if (cache && Date.now() - cache.at < maxAgeMs) {
      return cache.value;
    }

    if (this.instancesInFlight) {
      return this.instancesInFlight;
    }

    this.instancesInFlight = (async () => {
      try {
        const count = await this.getApplicationInstanceCount();
        const instances: ApplicationInstance[] = [];
        for (let index = 0; index < count; index += 1) {
          try {
            instances.push(await this.getApplicationInstanceAtIndex(index));
          } catch (error) {
            streamDeck.logger.warn(`Failed to read application instance ${index}: ${String(error)}`);
          }
        }
        this.instancesCache = { at: Date.now(), value: instances };
        return instances;
      } finally {
        this.instancesInFlight = undefined;
      }
    })();

    return this.instancesInFlight;
  }

  /** Drops the cached session list so the next read reflects a just-made change. */
  invalidateInstancesCache(): void {
    this.instancesCache = undefined;
  }

  async setApplicationInstanceMute(processID: number, mute: boolean): Promise<void> {
    await this.requestNoResponse("setApplicationInstanceMute", { processID, mute });
    this.invalidateInstancesCache();
  }

  async setApplicationInstanceVolume(processID: number, volume: number): Promise<void> {
    await this.requestNoResponse("setApplicationInstanceVolume", {
      processID,
      volume: clampVolume(volume),
    });
    this.invalidateInstancesCache();
  }

  private async requestNoResponse(method: string, params: Record<string, unknown>): Promise<void> {
    await this.ensureConnected();

    const payload = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params,
    };

    this.socket?.send(JSON.stringify(payload));
  }

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    await this.ensureConnected();

    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Audio Control request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timeout });
    });

    this.socket?.send(JSON.stringify(payload));
    return response;
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(AUDIO_CONTROL_URL);
      this.socket = socket;

      const cleanupStartupListeners = () => {
        socket.off("open", onOpen);
        socket.off("error", onError);
        socket.off("close", onStartupClose);
      };

      const onOpen = () => {
        cleanupStartupListeners();
        socket.on("message", (data) => this.handleMessage(data));
        socket.on("close", () => this.handleClose());
        socket.on("error", (error) => {
          streamDeck.logger.warn(`Audio Control WebSocket error: ${String(error)}`);
        });
        this.connectPromise = undefined;
        resolve();
      };

      const onError = (error: Error) => {
        cleanupStartupListeners();
        this.connectPromise = undefined;
        this.socket = undefined;
        reject(error);
      };

      const onStartupClose = () => {
        cleanupStartupListeners();
        this.connectPromise = undefined;
        this.socket = undefined;
        reject(new Error("Audio Control WebSocket closed before connection completed."));
      };

      socket.once("open", onOpen);
      socket.once("error", onError);
      socket.once("close", onStartupClose);
    });

    return this.connectPromise;
  }

  private handleMessage(data: RawData): void {
    let message: JsonRpcSuccess<unknown> | JsonRpcError;

    try {
      message = JSON.parse(data.toString()) as JsonRpcSuccess<unknown> | JsonRpcError;
    } catch (error) {
      streamDeck.logger.warn(`Failed to parse Audio Control message: ${String(error)}`);
      return;
    }

    if (!("id" in message)) {
      for (const listener of this.messageListeners) {
        listener(message);
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if ("error" in message) {
      pending.reject(new Error(message.error.message ?? `Audio Control request failed: ${pending.method}`));
      return;
    }

    pending.resolve(message.result);
  }

  private handleClose(): void {
    this.socket = undefined;
    this.connectPromise = undefined;

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Audio Control WebSocket closed during request: ${pending.method}`));
      this.pending.delete(id);
    }
  }
}

export const audioControlClient = new AudioControlClient();

export function clampVolume(volume: number): number {
  return Math.max(0, Math.min(1, volume));
}

export function getApplicationLabel(application: ApplicationInstance): string {
  return application.displayName ?? application.name ?? application.executableFile ?? `PID ${application.processID}`;
}
