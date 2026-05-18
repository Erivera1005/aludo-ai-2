import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Pet } from "@/lib/petStorage";
import { toast } from "sonner";
import logo from "@/assets/logo.png";

type Status = "idle" | "recording" | "processing" | "speaking";
interface Msg { role: "user" | "assistant"; content: string }

interface Props { pet: Pet; slug: string; onBlocked: (variant: "daily" | "monthly" | "expired") => void }

// Detect Safari / iOS
const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
const isSafari = typeof navigator !== "undefined" &&
  /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

// Pick a recording mime supported by the current browser. Safari supports mp4.
const pickRecordingMime = (): string => {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = isIOS || isSafari
    ? ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/wav", "audio/webm"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch { /* ignore */ }
  }
  return "";
};

type AudioSessionKind = "auto" | "playback" | "play-and-record";

const setAudioSessionType = async (type: AudioSessionKind) => {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: AudioSessionKind } };
    if (nav.audioSession) nav.audioSession.type = type;
  } catch (e) {
    console.warn("[VoiceChat] could not set audioSession", type, e);
  }
};

const VoiceChat = ({ pet, slug, onBlocked }: Props) => {
  const [status, setStatus] = useState<Status>("idle");
  const [history, setHistory] = useState<Msg[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const recordMimeRef = useRef<string>("");
  const gainNodeRef = useRef<GainNode | null>(null);

  // Streaming TTS state
  const ttsSocketRef = useRef<WebSocket | null>(null);
  const playheadRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopStreamingTts();
      try { audioCtxRef.current?.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unlock audio playback on the FIRST user gesture (required for Safari iOS)
  const unlockAudio = async () => {
    if (audioUnlockedRef.current) return;
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && !audioCtxRef.current) {
        // OpenAI Realtime sends PCM16 @ 24kHz. Match the AudioContext rate to
        // avoid resampling artefacts on mobile Safari.
        try {
          audioCtxRef.current = new Ctx({ sampleRate: 24000 });
        } catch {
          audioCtxRef.current = new Ctx();
        }
      }
      if (audioCtxRef.current?.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      // Create a gain node we can route streamed PCM buffers through.
      try {
        const ctx = audioCtxRef.current;
        if (ctx && !gainNodeRef.current) {
          const gain = ctx.createGain();
          gain.gain.value = (isIOS || isSafari) ? 2.2 : 1.3;
          gain.connect(ctx.destination);
          gainNodeRef.current = gain;
        }
      } catch (e) {
        console.warn("[VoiceChat] could not wire gain node", e);
      }
      // Prime audio output with a brief silent buffer so subsequent .start()
      // calls work without needing a fresh user gesture on iOS.
      try {
        const ctx = audioCtxRef.current;
        if (ctx) {
          const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
        }
      } catch { /* noop */ }
      audioUnlockedRef.current = true;
    } catch (e) {
      console.warn("[VoiceChat] unlockAudio failed", e);
    }
  };

  // ---- Streaming PCM16 playback (gpt-realtime-mini) ----
  const stopStreamingTts = () => {
    try { ttsSocketRef.current?.close(); } catch { /* noop */ }
    ttsSocketRef.current = null;
    for (const s of activeSourcesRef.current) {
      try { s.onended = null; s.stop(0); } catch { /* noop */ }
    }
    activeSourcesRef.current = [];
    playheadRef.current = 0;
  };

  const base64ToInt16 = (b64: string): Int16Array => {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    // PCM16 little-endian
    return new Int16Array(bytes.buffer, bytes.byteOffset, len >> 1);
  };

  const enqueuePcmChunk = (b64: string) => {
    const ctx = audioCtxRef.current;
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;
    const pcm = base64ToInt16(b64);
    if (pcm.length === 0) return;
    const sampleRate = 24000; // OpenAI Realtime PCM16 default
    const buf = ctx.createBuffer(1, pcm.length, sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, playheadRef.current);
    src.start(startAt);
    playheadRef.current = startAt + buf.duration;
    activeSourcesRef.current.push(src);
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
    };
  };

  const speakWithRealtime = (text: string, sex?: string | null) =>
    new Promise<void>((resolve) => {
      // Cancel any prior playback / socket immediately.
      stopStreamingTts();

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const wsUrl = `wss://${projectId}.functions.supabase.co/tts-realtime?apikey=${anonKey}`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        console.error("[VoiceChat] ws open failed", e);
        resolve();
        return;
      }
      ttsSocketRef.current = ws;

      let finished = false;
      const finishWhenDrained = () => {
        if (finished) return;
        finished = true;
        const ctx = audioCtxRef.current;
        const remaining = ctx
          ? Math.max(0, playheadRef.current - ctx.currentTime)
          : 0;
        window.setTimeout(() => {
          ttsSocketRef.current = null;
          resolve();
        }, Math.ceil(remaining * 1000) + 60);
      };

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ text, sex: sex ?? null }));
        } catch (e) {
          console.error("[VoiceChat] ws send failed", e);
          finishWhenDrained();
        }
      };
      ws.onmessage = (ev) => {
        let msg: { type?: string; data?: string; error?: string } = {};
        try {
          msg = typeof ev.data === "string" ? JSON.parse(ev.data) : {};
        } catch { return; }
        if (msg.type === "audio" && msg.data) {
          enqueuePcmChunk(msg.data);
        } else if (msg.type === "done" || msg.type === "audio_done") {
          finishWhenDrained();
        } else if (msg.type === "error") {
          console.error("[VoiceChat] realtime tts error", msg.error);
          finishWhenDrained();
        }
      };
      ws.onerror = (e) => {
        console.error("[VoiceChat] ws error", e);
        finishWhenDrained();
      };
      ws.onclose = () => {
        finishWhenDrained();
      };
    });

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const startRecording = async () => {
    try {
      console.log("[VoiceChat] requesting mic", { isIOS, isSafari, ua: navigator.userAgent });
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Tu navegador no soporta micrófono");
        return;
      }

      await setAudioSessionType("play-and-record");

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: isIOS || isSafari
            ? {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
              }
            : true,
        });
      } catch (err) {
        console.warn("[VoiceChat] constrained getUserMedia failed, falling back", err);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;

      const mimeType = pickRecordingMime();
      recordMimeRef.current = mimeType || "audio/webm";
      console.log("[VoiceChat] using mime", recordMimeRef.current);

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch (err) {
        console.warn("[VoiceChat] MediaRecorder mime failed, falling back", err);
        recorder = new MediaRecorder(stream);
        recordMimeRef.current = recorder.mimeType || "audio/mp4";
      }

      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => handleStop();
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (err) {
      console.error("[VoiceChat] mic error", err);
      const name = (err as { name?: string })?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        toast.error("Necesitamos acceso al micrófono para hablar contigo 🐾");
      } else if (name === "NotFoundError") {
        toast.error("No encontramos un micrófono en tu dispositivo");
      } else {
        toast.error("No pude acceder al micrófono");
      }
    }
  };

  const stopRecording = () => {
    try { mediaRecorderRef.current?.stop(); } catch (e) { console.warn(e); }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const handleStop = async () => {
    setStatus("processing");
    try {
      const recordedMime = recordMimeRef.current || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: recordedMime });
      if (blob.size < 800) {
        setStatus("idle");
        return;
      }
      const audioB64 = await blobToBase64(blob);

      const { data: trans, error: tErr } = await supabase.functions.invoke("transcribe", {
        body: { audio: audioB64, mime: recordedMime },
      });
      if (tErr || trans?.error) {
        console.error("[VoiceChat] transcribe error", tErr, trans);
        throw new Error(tErr?.message || trans?.error);
      }
      const userText: string = (trans?.text || "").trim();
      if (!userText) {
        setStatus("idle");
        return;
      }

      const newHistory: Msg[] = [...history, { role: "user", content: userText }];
      setHistory(newHistory);

      const { data: chat, error: cErr } = await supabase.functions.invoke("chat-pet", {
        body: { pet, messages: newHistory, slug },
      });
      // When the edge function returns 403, supabase-js puts the JSON body
      // in `cErr.context` (a Response). Read it to detect block reasons.
      let chatBody: {
        blocked?: boolean;
        usage?: { status?: string };
        reply?: string;
        error?: string;
        audio?: string;
        mime?: string;
      } | null =
        (chat as typeof chatBody) ?? null;
      if (cErr) {
        try {
          const ctx = (cErr as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            chatBody = await ctx.clone().json();
          }
        } catch (e) {
          console.warn("[VoiceChat] could not parse error body", e);
        }
      }
      const usageStatus = chatBody?.usage?.status;
      const isBlocked = chatBody?.blocked === true || (usageStatus && usageStatus !== "ok");
      if (isBlocked) {
        setStatus("idle");
        if (usageStatus === "expired") onBlocked("expired");
        else if (usageStatus === "monthly_blocked") onBlocked("monthly");
        else onBlocked("daily");
        return;
      }
      if (cErr || chatBody?.error) {
        console.error("[VoiceChat] chat error", cErr, chatBody);
        throw new Error((cErr as Error)?.message || chatBody?.error || "chat failed");
      }
      const reply: string = (chatBody?.reply || "").trim();
      setHistory((h) => [...h, { role: "assistant", content: reply }]);

      setStatus("speaking");

      await setAudioSessionType("playback");
      try {
        if (audioCtxRef.current?.state === "suspended") {
          await audioCtxRef.current.resume();
        }
      } catch (e) {
        console.warn("[VoiceChat] could not resume audio context", e);
      }
      try {
        await speakWithRealtime(reply, pet.sex);
      } catch (e) {
        console.error("[VoiceChat] realtime tts failed", e);
      }
      void setAudioSessionType("auto");
      setStatus("idle");
    } catch (err) {
      console.error("[VoiceChat] handleStop failed", err);
      void setAudioSessionType("auto");
      toast.error("Algo salió mal, intenta nuevamente");
      setStatus("idle");
    }
  };

  const onMicClick = () => {
    // Fire-and-forget: unlocking audio must happen during the user gesture,
    // but we must NOT await it — awaiting breaks the gesture context on mobile
    // (getUserMedia silently fails / first click does nothing).
    void unlockAudio();
    if (status === "recording") stopRecording();
    else if (status === "idle") void startRecording();
  };

  const isRecording = status === "recording";
  const isBusy = status === "processing" || status === "speaking";

  return (
    <main className="min-h-screen bg-hero flex flex-col items-center justify-between px-5 py-10 relative">
      <header className="w-full max-w-md h-8" />

      <section className="flex-1 flex flex-col items-center justify-center w-full max-w-md gap-20 -mt-4">
        <img
          src={logo}
          alt="Aludo"
          className="w-56 max-w-[70vw] h-auto select-none animate-fade-in-up"
          draggable={false}
        />

        <div className="relative w-44 h-44 flex items-center justify-center">
          {isRecording && (
            <>
              <span className="mic-ring" />
              <span className="mic-ring delay-1" />
              <span className="mic-ring delay-2" />
            </>
          )}

          <button
            onClick={onMicClick}
            onTouchEnd={(e) => {
              // On iOS, ensure the gesture is captured even if click is flaky
              e.preventDefault();
              onMicClick();
            }}
            disabled={isBusy}
            aria-label={isRecording ? "Detener" : "Hablar"}
            className={`relative w-32 h-32 rounded-full bg-mic shadow-mic flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-70 touch-manipulation select-none ${
              status === "speaking" ? "animate-soft-pulse" : ""
            }`}
          >
            {status === "processing" ? (
              <span className="flex gap-1.5 items-end h-8">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="wave-bar w-1.5 h-full bg-white rounded-full"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </span>
            ) : isRecording ? (
              <Square size={36} fill="currentColor" />
            ) : (
              <Mic size={42} strokeWidth={2.2} />
            )}
          </button>
        </div>
      </section>

      <footer className="text-foreground/30 text-[11px] tracking-wide">ALUDO® · voz con IA</footer>
    </main>
  );
};

export default VoiceChat;
