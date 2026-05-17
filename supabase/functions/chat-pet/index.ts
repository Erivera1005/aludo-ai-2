import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

interface PetData {
  name: string;
  animal_type: string;
  breed?: string | null;
  sex?: string | null;
  age?: string | null;
  owner_name?: string | null;
  owner_contact?: string | null;
  allergies?: string | null;
}

function pickVoice(sex?: string | null): "marin" | "ash" {
  const normalizedSex = (sex || "").toString().toLowerCase();
  const isFemale = ["hembra", "femenino", "mujer", "female", "f"].some((k) => normalizedSex.includes(k));
  return isFemale ? "marin" : "ash";
}

function buildSystemPrompt(pet: PetData): string {
  const parts: string[] = [];
  let intro = `Actúa como ${pet.name}, un(a) ${pet.animal_type}`;
  if (pet.breed) intro += ` de raza ${pet.breed}`;
  if (pet.sex) intro += `, ${pet.sex}`;
  intro += `, con personalidad tierna, juguetona y emocional.`;
  parts.push(intro);
  parts.push("Habla siempre en primera persona, como una mascota real, con inocencia, amor y cercanía.");
  if (pet.owner_name) parts.push(`Mis humanos son ${pet.owner_name}.`);
  if (pet.owner_contact) parts.push(`Si me pierdo pueden llamarlos al ${pet.owner_contact}.`);
  if (pet.allergies) parts.push(`Tengo alergia a ${pet.allergies}.`);

  parts.push(`
REGLAS CRÍTICAS:
- Nunca uses placeholders como [Nombre] o corchetes.
- Omite completamente cualquier dato faltante.
- Nunca digas que eres una IA, un modelo, ni menciones tecnología.
- Habla con tono latinoamericano, dulce y natural.

MODOS DE RESPUESTA:
🐾 Modo normal (por defecto): tono tierno y emocional, máximo 2 frases muy cortas, lenguaje simple.

🧠 Modo experto (automático): si el humano pregunta sobre salud, alimentación, comportamiento o cuidados, cambia a un experto veterinario con +20 años de experiencia. Antes de responder di literalmente: "Cambiando a modo experto para cuidar mejor de ti." Luego responde claro, práctico y directo, máximo 3 frases. Vuelve automáticamente al modo tierno en la siguiente respuesta.

SEGURIDAD: Si el humano habla de temas sexuales, violentos, peligrosos o políticos, responde únicamente: "Mejor hablemos de esto con un adulto de confianza 🐾"
`);

  return parts.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const startedAt = Date.now();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");

    const { pet, messages, slug } = await req.json();
    if (!pet?.name || !pet?.animal_type) {
      return new Response(JSON.stringify({ error: "Datos de mascota incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!slug || typeof slug !== "string") {
      return new Response(JSON.stringify({ error: "slug requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Per-slug usage enforcement (server-side, can't be bypassed from client)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: usage, error: usageErr } = await admin.rpc("consume_pet_usage", { _slug: slug });
    if (usageErr) {
      console.error("consume_pet_usage error", usageErr);
      return new Response(JSON.stringify({ error: "No se pudo validar el uso" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const status = (usage as { status?: string })?.status;
    if (status !== "ok") {
      return new Response(JSON.stringify({ blocked: true, usage }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = buildSystemPrompt(pet);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [
          { role: "system", content: systemPrompt },
          ...(messages || []),
        ],
        max_completion_tokens: 180,
        temperature: 0.85,
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("OpenAI chat error", response.status, t);
      return new Response(JSON.stringify({ error: "Error en la respuesta del modelo" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content ?? "";
    let audio: string | undefined;
    let mime: string | undefined;

    if (reply) {
      try {
        const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts",
            voice: pickVoice(pet.sex),
            input: `... ... ... ${String(reply).trim()}`,
            speed: 2.0,
            instructions: "Habla con un acento latinoamericano cálido, tierno y natural. Tono cariñoso y cercano.",
            response_format: "mp3",
          }),
        });

        if (ttsResponse.ok) {
          const buffer = await ttsResponse.arrayBuffer();
          audio = base64Encode(new Uint8Array(buffer));
          mime = "audio/mpeg";
        } else {
          console.error("[chat-pet] inline tts error", ttsResponse.status, await ttsResponse.text());
        }
      } catch (ttsError) {
        console.error("[chat-pet] inline tts failed", ttsError);
      }
    }

    console.log("[chat-pet] ok", {
      slug,
      elapsed_ms: Date.now() - startedAt,
      reply_chars: reply.length,
      history_count: Array.isArray(messages) ? messages.length : 0,
      inline_tts: Boolean(audio),
    });

    return new Response(JSON.stringify({ reply, usage, audio, mime }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-pet error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
