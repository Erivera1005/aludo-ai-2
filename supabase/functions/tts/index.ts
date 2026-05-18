import { corsHeaders } from "../_shared/cors.ts";
import { synthesizeWithGemini, pickGeminiVoice } from "../_shared/gemini-tts.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const startedAt = Date.now();
    const { text, sex } = await req.json();
    if (!text) {
      return new Response(JSON.stringify({ error: "text requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await synthesizeWithGemini(String(text), sex);
    if (!result) {
      return new Response(JSON.stringify({ error: "Error generando voz" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[tts] ok", {
      elapsed_ms: Date.now() - startedAt,
      voice: pickGeminiVoice(sex),
      text_chars: String(text).length,
      audio_b64_chars: result.audioB64.length,
    });

    return new Response(JSON.stringify({ audio: result.audioB64, mime: result.mime }), {
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
