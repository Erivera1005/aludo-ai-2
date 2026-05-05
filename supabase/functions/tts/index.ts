import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada");

    const { text, sex } = await req.json();
    if (!text) {
      return new Response(JSON.stringify({ error: "text requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedSex = (sex || "").toString().toLowerCase();
    const isFemale = ["hembra", "femenino", "mujer", "female", "f"].some((k) => normalizedSex.includes(k));
    const voiceName = isFemale ? "Gacrux" : "Algieba";

    const instruction = "Habla como Scooby Doo y habla rapido";
    const model = "gemini-2.5-flash-preview-tts";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${instruction}: ${text}` }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const t = await response.text();
      console.error("TTS error", response.status, t);
      return new Response(JSON.stringify({ error: "Error generando voz" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const part = data?.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data,
    );
    const pcmBase64: string = part?.inlineData?.data ?? "";
    const inlineMime: string = part?.inlineData?.mimeType ?? "audio/L16;rate=24000";
    if (!pcmBase64) {
      console.error("TTS: sin audio en respuesta", JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: "Sin audio" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gemini devuelve PCM16 raw. Lo envolvemos en un WAV para que el navegador lo reproduzca.
    const rateMatch = inlineMime.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    const pcmBytes = Uint8Array.from(atob(pcmBase64), (c) => c.charCodeAt(0));
    const wav = pcmToWav(pcmBytes, sampleRate, 1, 16);
    let bin = "";
    for (let i = 0; i < wav.length; i++) bin += String.fromCharCode(wav[i]);
    const audioBase64 = btoa(bin);

    return new Response(JSON.stringify({ audio: audioBase64, mime: "audio/wav" }), {
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

function pcmToWav(pcm: Uint8Array, sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}
