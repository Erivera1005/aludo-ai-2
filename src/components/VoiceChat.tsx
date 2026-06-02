import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Pet } from "@/lib/petTypes";
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
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const recordMimeRef = useRef<string>("");
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Pre-create the <audio> element so we can reuse it (required for iOS autoplay policies)
  useEffect(() => {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.setAttribute("playsinline", "true");
    el.volume = 1.0;
    audioElRef.current = el;
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try { audioElRef.current?.pause(); } catch { /* noop */ }
      try { audioCtxRef.current?.close(); } catch { /* noop */ }
    };
  }, []);

  // Unlock audio playback on the FIRST user gesture (required for Safari iOS)
  const unlockAudio = async () => {
    if (audioUnlockedRef.current) return;
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && !audioCtxRef.current) {
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current?.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      // Route the <audio> through a GainNode so we can boost volume on mobile.
      // On iOS this also forces playback through the main (loud) speaker
      // instead of the quiet earpiece.
      try {
        const ctx = audioCtxRef.current;
        const el = audioElRef.current;
        if (ctx && el && !sourceNodeRef.current) {
          const src = ctx.createMediaElementSource(el);
          const gain = ctx.createGain();
          // Boost: mobile gets a stronger gain than desktop
          gain.gain.value = (isIOS || isSafari) ? 2.5 : 1.5;
          src.connect(gain);
          gain.connect(ctx.destination);
          sourceNodeRef.current = src;
          gainNodeRef.current = gain;
        }
      } catch (e) {
        console.warn("[VoiceChat] could not wire gain node", e);
      }
      // Prime the <audio> element with a tiny silent mp3 so subsequent .play() works without a fresh gesture
      const audioEl = audioElRef.current;
      if (audioEl) {
        const el = audioEl;
        el.muted = true;
        el.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//FJAhEhU3F2sahUIu7gI5VBEZQjr/TI3Cnu3eDyHLBrmJsCRbr+cYrV5QIO9NLU8qqPg6q0okLYK9Mh3nnkOEXdG4ZIWaWJ4M8tTo6CpzQRXlHDPyCAwf2KoFmZuTI4eIuhDpNJxlHMq2mnNYy+jjMA9Q3wmtmgLkUnmpjlmGSJ55kIIWDdRQYFJBXGgWZPPgtDBNnjbXNlvL0V6whL2IVFsZ8sM41NRC5TNPCxd9e1OvJrYf81mWsB+T0yRJrgcRtDPN1+G/XDUJyJyUgBBIVy9LYkPACNDDXaQUbsZRpnRdF7M2kx9cYj+/9rXkAFSGAxgCKICRZkw+IzcyJpmBoKE2cFYhKzgCKLN4tBEKKCx3pdFrxbY//tSxA8DR2QrSm09JEjBhWiBpiGwm+CwUUCblm0eiIjoNzd1xN6ZN8x4juL8RlqcG0/YcGRREVWfWcIuzMxIgxQEWdyhI8j8ICy+hQAEcEbhXyWjBgUJgg4GWXJYyOJYAlgrdCk+rNT5Ucvr46ymO99fScsOKDV3PYEJWG2/n0bDoIu+OaO//1QQDIDwgUByMhxg4VRjdBxjsZ6XYSO5HwjBNkJEVB12YLJxhA9NYVkS1U3//Jv3//7d3lAhAFJOl70DxoAJDPQAEFh1B5IRvwYkPlIEFAQQp46wEhJxIFDAyMCb8aBkIUtNiZeb3cjWZ2/3OXavl8/jXq30/FQiR06Ji+/3I2UBjYJgwygsBKYBwHKkAZHQGAuSeHhEAY4tNRBHCvmEmZA+RWQs2D5CldJqu5gFgRxjEkmWYzIqGDBIlc/3fTMV3eAEoAYE3eDsTkdi6KXM55ggwIu//7UsQOA8jcCT5OPSNJD4CnBcekaIGGCKIQDsuiMxDCSAcRf4QBmwOIzL4IOgUMVj7s6ofahsMq5xEGcnFL81wjElFeegkNWO6uGIShgxbFLyXiUYXSk0XRCsAkEGAxNN2ImAtENB60FRJBFY6wSWDmUOPNJqiMc5K2ZKeMVqDawgRWVgbNOY0Ob/WhgMtwt8nZIyNJsAQGXAYg4gJlIMwJzIYPC1k5UlLBGTMfBYKaB6QURllrA+AwjqI8wQRQ23VCRwCS7BVWizUJYZsbkSCOSvCO5x1HOCm6JwvqHrz1uUgCx40hyfqGJTM1MPGZAQH3gIGNAEgZkD2HBkRZGRKHpAkTFIQDDEsnVktCY0PjUW9JUGRKawnRD5Qk1szGZsnhmeLpxRxPOEAS5YxJYHPnqV3cT0vdDoX3rl5NgGE0cAhGw0cFsg5Kk+OAyDBoEN6L5gkCmS0X9JnX/+1LEFAPJDFVAjjzjyTILqJ3JCHUYgUUTnFgCVc3CSWMypOFRRbn0e2WJ6ueZmEW0bvGUBjmGu9AolyQk8ZiPoMHZPlwaQqq0pAgZyXPIAgfkBGEwjoljNCJgaIHUTYi1ETI0R2jyOl5wWSyTLB0Ujx6jmaUKzrr5WHmESjzPnnwfeIfYemHmw2tmqg0eqSVIB3Y8vGUXjBwkSURDhcHRWCCZElECIQYhO61VSGxchcQRgwQRDKFxZEh0c4xZMQU1FMy45OS41VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";
        try {
          await el.play();
        } catch { /* may still need a tap, that's fine */ }
        el.pause();
        el.muted = false;
        el.removeAttribute("src");
        el.load();
      }
      audioUnlockedRef.current = true;
    } catch (e) {
      console.warn("[VoiceChat] unlockAudio failed", e);
    }
  };

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
      const inlineAudio: string | undefined = typeof chatBody?.audio === "string" ? chatBody.audio : undefined;
      const inlineMime: string | undefined = typeof chatBody?.mime === "string" ? chatBody.mime : undefined;
      setHistory((h) => [...h, { role: "assistant", content: reply }]);

      setStatus("speaking");

      let voiceData: { audio?: string; mime?: string; error?: string } | null = null;
      if (inlineAudio) {
        voiceData = { audio: inlineAudio, mime: inlineMime || "audio/mpeg" };
      } else {
        const { data: voice, error: vErr } = await supabase.functions.invoke("tts", {
          body: { text: reply, sex: pet.sex },
        });
        if (vErr || voice?.error) {
          console.error("[VoiceChat] tts error", vErr, voice);
          throw new Error(vErr?.message || voice?.error);
        }
        voiceData = voice as typeof voiceData;
      }

      const audioUrl = `data:${voiceData?.mime || "audio/mpeg"};base64,${voiceData?.audio}`;
      const el = audioElRef.current;
      if (!el) {
        setStatus("idle");
        return;
      }
      await setAudioSessionType("playback");
      // Resume the AudioContext if it was suspended between plays (mobile/Safari).
      // Without this, the GainNode chain stays silent on the 2nd+ playback.
      try {
        if (audioCtxRef.current?.state === "suspended") {
          await audioCtxRef.current.resume();
        }
      } catch (e) {
        console.warn("[VoiceChat] could not resume audio context", e);
      }
      el.pause();
      el.currentTime = 0;
      el.src = audioUrl;
      el.volume = 1;
      el.onended = () => {
        void setAudioSessionType("auto");
        setStatus("idle");
      };
      el.onerror = (e) => {
        console.error("[VoiceChat] audio playback error", e);
        void setAudioSessionType("auto");
        setStatus("idle");
      };
      try {
        // Force the element to load the new source before playing. Without this,
        // mobile Safari often starts playback before the decoder is ready and
        // clips the first ~300-500ms (cutting the first word).
        el.load();
        await new Promise<void>((resolve) => {
          const onReady = () => {
            el.removeEventListener("canplaythrough", onReady);
            el.removeEventListener("loadeddata", onReady);
            resolve();
          };
          el.addEventListener("canplaythrough", onReady, { once: true });
          el.addEventListener("loadeddata", onReady, { once: true });
          // Safety timeout in case events don't fire
          setTimeout(onReady, 400);
        });
        await el.play();
      } catch (playErr) {
        console.error("[VoiceChat] audio.play() failed", playErr);
        void setAudioSessionType("auto");
        toast.error("Toca el botón otra vez para escuchar la respuesta");
        setStatus("idle");
      }
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
