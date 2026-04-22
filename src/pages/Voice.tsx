import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, Square, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { clearPet, loadPet, type Pet } from "@/lib/petStorage";
import { toast } from "sonner";
import logo from "@/assets/logo.jpeg";

type Status = "idle" | "recording" | "processing" | "speaking";

interface Msg { role: "user" | "assistant"; content: string }

const Voice = () => {
  const navigate = useNavigate();
  const [pet, setPet] = useState<Pet | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [hint, setHint] = useState("Toca el micrófono para hablar");
  const [history, setHistory] = useState<Msg[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const p = loadPet();
    if (!p) {
      navigate("/", { replace: true });
      return;
    }
    setPet(p);
  }, [navigate]);

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
    if (!pet) return;
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
      setHint("Estoy escuchándote...");
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
    if (!pet) return;
    setStatus("processing");
    setHint("Pensando...");
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      if (blob.size < 800) {
        setStatus("idle");
        setHint("No te escuché, intenta de nuevo");
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
        setHint("No te escuché, intenta de nuevo");
        return;
      }

      const newHistory: Msg[] = [...history, { role: "user", content: userText }];
      setHistory(newHistory);

      const { data: chat, error: cErr } = await supabase.functions.invoke("chat-pet", {
        body: { pet, messages: newHistory },
      });
      if (cErr || chat?.error) throw new Error(cErr?.message || chat?.error);
      const reply: string = (chat?.reply || "").trim();
      setHistory((h) => [...h, { role: "assistant", content: reply }]);

      setStatus("speaking");
      setHint(reply);

      const { data: voice, error: vErr } = await supabase.functions.invoke("tts", {
        body: { text: reply, sex: pet.sex },
      });
      if (vErr || voice?.error) throw new Error(vErr?.message || voice?.error);

      const audioUrl = `data:${voice.mime || "audio/mpeg"};base64,${voice.audio}`;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        setStatus("idle");
        setHint("Toca el micrófono para hablar");
      };
      audio.onerror = () => {
        setStatus("idle");
        setHint("Toca el micrófono para hablar");
      };
      await audio.play();
    } catch (err) {
      console.error(err);
      toast.error("Algo salió mal, intenta de nuevo");
      setStatus("idle");
      setHint("Toca el micrófono para hablar");
    }
  };

  const onMicClick = () => {
    if (status === "recording") stopRecording();
    else if (status === "idle") startRecording();
  };

  const reset = () => {
    audioRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    clearPet();
    navigate("/", { replace: true });
  };

  const isRecording = status === "recording";
  const isBusy = status === "processing" || status === "speaking";

  return (
    <main className="min-h-screen bg-hero flex flex-col items-center justify-between px-5 py-10 relative">
      <header className="w-full flex items-center justify-between max-w-md">
        <img src={logo} alt="Aludo" className="h-10 w-auto select-none" draggable={false} />
        <button
          onClick={reset}
          className="text-foreground/50 hover:text-foreground/90 transition-colors p-2"
          aria-label="Cambiar mascota"
        >
          <RotateCcw size={18} />
        </button>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center w-full max-w-md">
        {pet && (
          <p className="text-foreground/70 text-sm mb-2 animate-fade-in-up">
            Hablando con <span className="text-foreground font-medium">{pet.name}</span>
          </p>
        )}

        <p
          key={hint}
          className="text-foreground/85 text-center text-base sm:text-lg leading-snug min-h-[3.5rem] mb-12 px-4 animate-fade-in-up"
        >
          {hint}
        </p>

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

export default Voice;
