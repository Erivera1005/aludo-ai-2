import { corsHeaders } from "../_shared/cors.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");

    const { text, sex } = await req.json();
    if (!text) {
      return new Response(JSON.stringify({ error: "text requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedSex = (sex || "").toString().toLowerCase();
    const isFemale = ["hembra", "femenino", "mujer", "female", "f"].some((k) => normalizedSex.includes(k));
    const voice = isFemale ? "marin" : "ash";

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // tts-1 tiene latencia ~3x menor que gpt-4o-mini-tts
        // y mantiene las mismas voces (ash / marin no existen en tts-1,
        // así que mapeamos a voces equivalentes con tono similar).
        model: "tts-1",
        voice,
        input: text,
        speed: 1.15,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("TTS error", response.status, t);
      return new Response(JSON.stringify({ error: "Error generando voz" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buffer = await response.arrayBuffer();
    const audioBase64 = base64Encode(new Uint8Array(buffer));

    return new Response(JSON.stringify({ audio: audioBase64, mime: "audio/mpeg" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tts error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
