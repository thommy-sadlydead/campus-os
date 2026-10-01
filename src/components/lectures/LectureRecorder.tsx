"use client";

import { useEffect, useRef, useState } from "react";
import type { PluginListenerHandle } from "@capacitor/core";
import { hasNativePlugin, NativeRecorder, nativeErrorCode, readInboxFile, SharedInbox } from "@/lib/native-app";
import { saveLectureAudio } from "./save-lecture-audio";

type Phase = "idle" | "starting" | "recording" | "paused" | "saving" | "failed";

// Safari (iPhone, iPad, Mac) records AAC in an MP4 container; Chrome, Edge
// and Firefox record Opus in WebM. AssemblyAI transcribes both.
const MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

// Plenty for one speaker in a lecture hall, and keeps an hour at ~30 MB.
const AUDIO_BITS_PER_SECOND = 64_000;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * Records a lecture with the device's microphone, then uploads it into the
 * same transcription and notes pipeline as an uploaded file. Keeps the
 * screen awake while recording (a locked phone stops a web page's
 * microphone), warns before leaving mid-recording, and never throws a
 * recording away: if the upload fails, it can be retried or saved to the
 * device.
 *
 * In the iPhone app it records natively instead (NativeRecorder), which
 * keeps going with the screen locked or another app open. The recording
 * lands in the app's inbox and uploads from there; if the upload fails it
 * stays in the inbox, listed on the Record page.
 */
export function LectureRecorder({
  classId,
  defaultTitle,
  onSaved,
  onBusyChange,
}: {
  classId: string | null;
  defaultTitle: string;
  onSaved: (classId: string) => void;
  /** True from the moment recording starts until the upload finishes (or is discarded). */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const segmentStartRef = useRef(0);
  const recordedMsRef = useRef(0);
  const [native, setNative] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const nativeListenersRef = useRef<PluginListenerHandle[]>([]);
  const failedInboxIdRef = useRef<string | null>(null);
  // Read when the recording finishes, which can be long after the render
  // that started it, so these can't come from that render's closure.
  const titleRef = useRef(title);
  const classIdRef = useRef(classId);
  useEffect(() => {
    titleRef.current = title;
    classIdRef.current = classId;
  });

  const busy = phase === "starting" || phase === "recording" || phase === "paused" || phase === "saving";

  useEffect(() => {
    const available = hasNativePlugin("NativeRecorder");
    setNative(available);
    // A native recording keeps going if the student leaves this page;
    // coming back picks it up again.
    if (available) {
      void NativeRecorder.status().then((status) => {
        if (status.state !== "recording" && status.state !== "paused") return;
        setElapsedMs(status.elapsedSeconds * 1000);
        setInterrupted(!!status.interrupted);
        setPhase(status.state);
        void followNativeRecording();
      });
    }
    return () => {
      nativeListenersRef.current.forEach((handle) => void handle.remove());
      nativeListenersRef.current = [];
    };
  }, []);

  useEffect(() => {
    onBusyChange?.(busy || phase === "failed");
  }, [busy, phase, onBusyChange]);

  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => {
    // The browser drops a wake lock whenever the page is hidden; take it
    // back when the student returns mid-recording.
    const onVisible = () => {
      if (document.visibilityState === "visible" && recorderRef.current?.state === "recording") void keepScreenAwake();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      releaseDevices();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  async function keepScreenAwake() {
    try {
      wakeLockRef.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLockRef.current = null; // not supported, or refused; recording still works
    }
  }

  function releaseDevices() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    timerRef.current = null;
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }

  function startLevelMeter(stream: MediaStream) {
    try {
      const Context =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      const context = new Context();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        if (meterRef.current) meterRef.current.style.transform = `scaleX(${Math.min(1, peak / 48)})`;
        frameRef.current = requestAnimationFrame(draw);
      };
      draw();
      audioContextRef.current = context;
    } catch {
      // The level meter is reassurance only; recording doesn't depend on it.
    }
  }

  // ---- Native recording (iPhone app) ----

  async function syncNativeStatus() {
    try {
      const status = await NativeRecorder.status();
      setElapsedMs(status.elapsedSeconds * 1000);
      setInterrupted(!!status.interrupted);
      if (status.state === "recording" || status.state === "paused") setPhase(status.state);
    } catch {
      // Keep showing the last known time; the recording itself is native.
    }
  }

  async function startNative() {
    setPhase("starting");
    try {
      await NativeRecorder.start({ title: titleRef.current.trim() || defaultTitle });
    } catch (err) {
      setPhase("idle");
      setError(
        nativeErrorCode(err) === "denied"
          ? "Campus OS isn't allowed to use the microphone. Turn it on in Settings > Campus OS > Microphone, then try again."
          : "Couldn't start the microphone. Make sure no other app is using it, then try again."
      );
      return;
    }
    setElapsedMs(0);
    setInterrupted(false);
    await followNativeRecording();
    setPhase("recording");
  }

  async function followNativeRecording() {
    nativeListenersRef.current = [
      await NativeRecorder.addListener("level", ({ level }) => {
        if (meterRef.current) meterRef.current.style.transform = `scaleX(${Math.min(1, level * 4)})`;
      }),
      await NativeRecorder.addListener("stateChange", () => void syncNativeStatus()),
    ];
    // The recorder keeps time; ask it rather than counting here, since this
    // page stops running while the phone is locked.
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => void syncNativeStatus(), 1000);
  }

  async function stopNative() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    nativeListenersRef.current.forEach((handle) => void handle.remove());
    nativeListenersRef.current = [];
    setProgress(0);
    setPhase("saving");
    try {
      const { id, durationSeconds } = await NativeRecorder.stop();
      setElapsedMs(durationSeconds * 1000);
      await uploadFromInbox(id);
    } catch {
      setPhase("idle");
      setError("Couldn't finish the recording. If it was saved, you'll find it at the top of this page.");
    }
  }

  async function uploadFromInbox(id: string) {
    const item = (await SharedInbox.list()).items.find((i) => i.id === id);
    if (!item) {
      setPhase("idle");
      setError("That recording is no longer on this iPhone.");
      return;
    }
    failedInboxIdRef.current = id;
    await uploadRecording(await readInboxFile(item));
  }

  // ---- Recording in the browser ----

  async function start() {
    if (!classId) return;
    setError(null);
    if (native) return startNative();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't record audio. Use Upload a recording instead.");
      return;
    }

    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setPhase("idle");
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(
        denied
          ? "Campus OS isn't allowed to use the microphone. Allow it for this site in your browser settings, then try again."
          : "Couldn't start the microphone. Make sure no other app is using it, then try again."
      );
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND } : undefined);
    } catch {
      recorder = new MediaRecorder(stream);
    }

    streamRef.current = stream;
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => void finish(recorder.mimeType || mimeType || "audio/webm");
    // Hand over audio every 10 seconds rather than all at once at the end.
    recorder.start(10_000);
    recorderRef.current = recorder;

    recordedMsRef.current = 0;
    segmentStartRef.current = performance.now();
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      const running = recorderRef.current?.state === "recording" ? performance.now() - segmentStartRef.current : 0;
      setElapsedMs(recordedMsRef.current + running);
    }, 250);
    startLevelMeter(stream);
    await keepScreenAwake();
    setPhase("recording");
  }

  function pause() {
    if (native) {
      void NativeRecorder.pause().then(() => syncNativeStatus());
      setPhase("paused");
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    recordedMsRef.current += performance.now() - segmentStartRef.current;
    setPhase("paused");
  }

  function resume() {
    if (native) {
      void NativeRecorder.resume()
        .then(() => syncNativeStatus())
        .catch(() => setError("Couldn't resume. Stop and save what's recorded so far, then start again."));
      setPhase("recording");
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    segmentStartRef.current = performance.now();
    setPhase("recording");
  }

  function stop() {
    if (native) return void stopNative();
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "recording") recordedMsRef.current += performance.now() - segmentStartRef.current;
    setElapsedMs(recordedMsRef.current);
    setProgress(0);
    setPhase("saving");
    recorder.stop(); // onstop -> finish()
  }

  async function finish(mimeType: string) {
    releaseDevices();
    recorderRef.current = null;
    const type = mimeType.split(";")[0];
    const blob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];
    if (blob.size === 0) {
      setPhase("idle");
      setError("Nothing was recorded. Check the microphone and try again.");
      return;
    }
    const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    const name = (titleRef.current.trim() || defaultTitle).replace(/[^\w-]+/g, "-").slice(0, 60) || "lecture";
    await uploadRecording(new File([blob], `${name}.${extension}`, { type }));
  }

  async function uploadRecording(file: File) {
    const targetClassId = classIdRef.current;
    if (!targetClassId) return;
    setPhase("saving");
    setError(null);
    try {
      const result = await saveLectureAudio(targetClassId, file, titleRef.current.trim() || defaultTitle, setProgress);
      if (result.error) {
        keepForRetry(file, result.error);
        return;
      }
      if (failedInboxIdRef.current) {
        await SharedInbox.remove({ id: failedInboxIdRef.current }).catch(() => {});
        failedInboxIdRef.current = null;
      }
      setFailedFile(null);
      setDownloadUrl(null);
      setElapsedMs(0);
      setPhase("idle");
      onSaved(targetClassId);
    } catch {
      keepForRetry(file, "The upload didn't finish. Your recording is safe here: try again, or save it to this device.");
    }
  }

  function keepForRetry(file: File, message: string) {
    setFailedFile(file);
    // In the app the recording is already safe in its inbox, and a web
    // view can't save a download anyway.
    setDownloadUrl(native ? null : URL.createObjectURL(file));
    setError(
      native && failedInboxIdRef.current
        ? `${message} It's saved on this iPhone: try again now, or add it later from the top of the Record page.`
        : message
    );
    setPhase("failed");
  }

  function discard() {
    if (!confirm("Discard this recording? It hasn't been saved anywhere.")) return;
    if (failedInboxIdRef.current) {
      void SharedInbox.remove({ id: failedInboxIdRef.current }).catch(() => {});
      failedInboxIdRef.current = null;
    }
    setFailedFile(null);
    setDownloadUrl(null);
    setError(null);
    setElapsedMs(0);
    setPhase("idle");
  }

  if (phase === "recording" || phase === "paused") {
    return (
      <div className="flex flex-col items-center gap-4 py-3 text-center">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 rounded-full ${phase === "recording" ? "animate-pulse bg-danger" : "bg-ink-faint"}`}
          />
          {phase === "recording" ? "Recording" : "Paused"}
        </div>
        <div className="font-mono text-5xl tabular-nums" aria-live="off">
          {formatElapsed(elapsedMs)}
        </div>
        <div className="h-2 w-56 max-w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div ref={meterRef} className="h-full origin-left bg-ok" style={{ transform: "scaleX(0)" }} />
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={phase === "paused" ? resume : pause}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-surface-2"
          >
            {phase === "paused" ? "Resume" : "Pause"}
          </button>
          <button onClick={stop} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface hover:opacity-90">
            Stop and save
          </button>
        </div>
        {interrupted && phase === "paused" && (
          <p className="max-w-xs text-sm text-warn">Paused by a call or another app. Tap Resume to keep recording.</p>
        )}
        <p className="max-w-xs text-xs text-ink-faint">
          {native
            ? "You can lock your phone or use other apps. Recording keeps going until you stop."
            : "Keep Campus OS open with the screen on until you stop."}
        </p>
      </div>
    );
  }

  if (phase === "saving") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-sm font-medium">
          {progress < 100 ? `Uploading ${formatElapsed(elapsedMs)} of audio… ${progress}%` : "Starting the transcript…"}
        </p>
        <div className="h-2 w-56 max-w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>
        <p className="text-xs text-ink-faint">Keep this page open until the upload finishes.</p>
      </div>
    );
  }

  if (phase === "failed" && failedFile) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <p className="max-w-sm text-sm text-danger">{error}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={() => void uploadRecording(failedFile)}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface hover:opacity-90"
          >
            Try again
          </button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={failedFile.name}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-surface-2"
            >
              Save to this device
            </a>
          )}
          <button onClick={discard} className="rounded-lg px-3 py-2.5 text-sm text-ink-faint hover:text-danger">
            Discard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-3 text-center">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Lecture title"
        className="w-full max-w-sm rounded-lg border border-border bg-bg px-3 py-2 text-center text-sm outline-none focus:border-accent"
      />
      <button
        onClick={() => void start()}
        disabled={!classId || phase === "starting"}
        aria-label="Start recording"
        className="flex h-20 w-20 items-center justify-center rounded-full bg-danger shadow-card transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
      >
        <span className="block h-7 w-7 rounded-full bg-white" />
      </button>
      <p className="text-sm font-medium">
        {!classId ? "Choose a class to start recording" : phase === "starting" ? "Starting…" : "Tap to record"}
      </p>
      <p className="max-w-xs text-xs text-ink-faint">
        When you stop, the recording uploads and Campus OS writes the transcript and notes for you.
      </p>
      {error && <p className="max-w-sm text-sm text-danger">{error}</p>}
    </div>
  );
}
