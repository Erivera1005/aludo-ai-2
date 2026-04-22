import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Pet } from "@/lib/petStorage";
import { toast } from "sonner";
import logo from "@/assets/logo.png";

type Status = "idle" | "recording" | "processing" | "speaking";
interface Msg { role: "user" | "assistant"; content: string }

interface Props { pet: Pet; slug: string; onBlocked: (variant: "daily" | "monthly" | "expired") => void }

const VoiceChat = ({ pet, slug, onBlocked }: Props) => {
  const [status, setStatus] = useState<Status>("idle");
  const [history, setHistory] = useState<Msg[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
    };
  }, []);

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => handleStop();
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (err) {
      console.error(err);
      toast.error("No pude acceder al micrófono");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  };

  const handleStop = async () => {
    setStatus("processing");
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      if (blob.size < 800) {
        setStatus("idle");
        return;
      }
      const audioB64 = await blobToBase64(blob);

      const { data: trans, error: tErr } = await supabase.functions.invoke("transcribe", {
        body: { audio: audioB64 },
      });
      if (tErr || trans?.error) throw new Error(tErr?.message || trans?.error);
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
      console.log("[chat-pet]", { chat, cErr });
      const usageStatus = (chat as { blocked?: boolean; usage?: { status?: string } } | null)?.usage?.status;
      const isBlocked = (chat as { blocked?: boolean } | null)?.blocked === true
        || (usageStatus && usageStatus !== "ok");
      if (isBlocked) {
        setStatus("idle");
        if (usageStatus === "expired") onBlocked("expired");
        else if (usageStatus === "monthly_blocked") onBlocked("monthly");
        else onBlocked("daily");
        return;
      }
      if (cErr) throw new Error(`chat-pet: ${cErr.message}`);
      if (chat?.error) throw new Error(`chat-pet: ${chat.error}`);
      const reply: string = (chat?.reply || "").trim();
      if (!reply) throw new Error("respuesta vacía del modelo");
      setHistory((h) => [...h, { role: "assistant", content: reply }]);

      setStatus("speaking");

      const { data: voice, error: vErr } = await supabase.functions.invoke("tts", {
        body: { text: reply, sex: pet.sex },
      });
      console.log("[tts]", { hasAudio: !!voice?.audio, vErr, err: voice?.error });
      if (vErr) throw new Error(`tts: ${vErr.message}`);
      if (voice?.error) throw new Error(`tts: ${voice.error}`);
      if (!voice?.audio) throw new Error("tts: sin audio");

      const audioUrl = `data:${voice.mime || "audio/mpeg"};base64,${voice.audio}`;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => setStatus("idle");
      audio.onerror = () => setStatus("idle");
      await audio.play();
    } catch (err) {
      console.error(err);
      toast.error("Algo salió mal, intenta de nuevo");
      setStatus("idle");
    }
  };

  const onMicClick = () => {
    if (status === "recording") stopRecording();
    else if (status === "idle") startRecording();
  };

  const isRecording = status === "recording";
  const isBusy = status === "processing" || status === "speaking";

  return (
    <main className="min-h-screen bg-hero flex flex-col items-center justify-between px-5 py-10 relative">
      <header className="w-full max-w-md" />

      <section className="flex-1 flex flex-col items-center justify-center w-full max-w-md gap-16">
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
            disabled={isBusy}
            aria-label={isRecording ? "Detener" : "Hablar"}
            className={`relative w-32 h-32 rounded-full bg-mic shadow-mic flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-70 ${
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
