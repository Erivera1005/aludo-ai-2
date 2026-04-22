import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");

    const { audio, mime } = await req.json();
    if (!audio) {
      return new Response(JSON.stringify({ error: "audio requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // decode base64 to bytes in chunks
    const binary = atob(audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const inputMime: string = (mime || "audio/webm").toString();
    const ext = inputMime.includes("mp4") ? "mp4"
      : inputMime.includes("wav") ? "wav"
      : inputMime.includes("mpeg") ? "mp3"
      : inputMime.includes("ogg") ? "ogg"
      : "webm";
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: inputMime }), `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", "es");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("Whisper error", response.status, t);
      return new Response(JSON.stringify({ error: "Error transcribiendo" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify({ text: data.text || "" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
