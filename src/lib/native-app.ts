import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

// The website also runs inside the Campus OS iPhone and iPad app (ios/, a
// Capacitor shell around this same site; see ios/README.md). These are the
// native features it can use there. On the web isNativeApp() is false and
// none of the plugins below are called. Client-side only.

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

/** A recording waiting in the app to be added to a class (ios/App/App/SharedInbox.swift). */
export interface InboxItem {
  id: string;
  title: string;
  fileName: string;
  contentType: string;
  size: number;
  /** ISO time the audio was recorded, when the file says. */
  recordedAt?: string;
  durationSeconds?: number;
  addedAt: string;
  /** "share" came from Voice Memos or another app; "recorder" was recorded in Campus OS. */
  source: "share" | "recorder";
}

interface SharedInboxPlugin {
  list(): Promise<{ items: InboxItem[] }>;
  readChunk(options: { id: string; offset: number }): Promise<{ data: string; bytes: number; done: boolean }>;
  remove(options: { id: string }): Promise<void>;
}

export type NativeRecorderState = "idle" | "recording" | "paused" | "error";

export interface NativeRecorderStatus {
  state: NativeRecorderState;
  elapsedSeconds: number;
  interrupted?: boolean;
  message?: string;
}

interface NativeRecorderPlugin {
  start(options: { title: string }): Promise<NativeRecorderStatus>;
  pause(): Promise<NativeRecorderStatus>;
  resume(): Promise<NativeRecorderStatus>;
  stop(): Promise<{ id: string; durationSeconds: number; size: number }>;
  discard(): Promise<void>;
  status(): Promise<NativeRecorderStatus>;
  addListener(event: "level", listener: (data: { level: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: "stateChange", listener: (data: NativeRecorderStatus) => void): Promise<PluginListenerHandle>;
}

interface AuthSessionPlugin {
  start(options: { url: string; callbackScheme?: string }): Promise<{ url: string }>;
}

export const SharedInbox = registerPlugin<SharedInboxPlugin>("SharedInbox");
export const NativeRecorder = registerPlugin<NativeRecorderPlugin>("NativeRecorder");
export const AuthSession = registerPlugin<AuthSessionPlugin>("AuthSession");

/** True in an app build that has this native plugin (an older build might not). */
export function hasNativePlugin(name: "SharedInbox" | "NativeRecorder" | "AuthSession"): boolean {
  return isNativeApp() && Capacitor.isPluginAvailable(name);
}

/** The error code a plugin rejected with, such as "cancelled" or "denied". */
export function nativeErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Reads a recording out of the app's inbox as a File, a couple of
 * megabytes at a time, so it can go through the same upload as a file
 * picked on the website (saveLectureAudio).
 */
export async function readInboxFile(item: InboxItem, onProgress?: (fraction: number) => void): Promise<File> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await SharedInbox.readChunk({ id: item.id, offset });
    parts.push(base64ToBytes(chunk.data));
    offset += chunk.bytes;
    onProgress?.(item.size > 0 ? Math.min(1, offset / item.size) : 1);
    if (chunk.done || chunk.bytes === 0) break;
  }
  const extension = item.fileName.split(".").pop() || "m4a";
  const name = item.title.replace(/[^\w-]+/g, "-").slice(0, 60) || "recording";
  return new File(parts, `${name}.${extension}`, { type: item.contentType || "audio/mp4" });
}
