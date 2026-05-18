import { corsHeaders } from "../_shared/cors.ts";
import { encode as base64Encode, decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

// Build a 44-byte RIFF/WAV header for raw PCM data.
// Gemini TTS returns signed 16-bit little-endian mono PCM at 24 kHz.
function buildWavFromPcm(pcm: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16): Uint8Array {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const out = new Uint8Array(buffer);
  out.set(pcm, 44);
  return out;
}

function pickGeminiVoice(sex?: string | null): "Algieba" | "Gacrux" {
  const s = (sex || "").toString().toLowerCase();
  const isFemale = ["hembra", "femenino", "mujer", "female", "f"].some((k) => s.includes(k));
  return isFemale ? "Gacrux" : "Algieba";
}

// Parse a Gemini audio mimeType such as "audio/L16;rate=24000" to extract sample rate.
function parseSampleRate(mimeType?: string): number {
  if (!mimeType) return 24000;
  const m = mimeType.match(/rate=(\d+)/i);
  return m ? parseInt(m[1], 10) : 24000;
}

export async function synthesizeWithGemini(text: string, sex?: string | null): Promise<{ audioB64: string; mime: string } | null> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada");
  const voice = pickGeminiVoice(sex);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: String(text).trim() }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("[gemini-tts] error", resp.status, t);
    return null;
  }
  const data = await resp.json();
  const part = data?.candidates?.[0]?.content?.parts?.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data);
  const inlineData = part?.inlineData;
  if (!inlineData?.data) {
    console.error("[gemini-tts] no audio in response", JSON.stringify(data).slice(0, 500));
    return null;
  }
  const pcm = base64Decode(inlineData.data);
  const sampleRate = parseSampleRate(inlineData.mimeType);
  const wav = buildWavFromPcm(pcm, sampleRate, 1, 16);
  return { audioB64: base64Encode(wav), mime: "audio/wav" };
}

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
