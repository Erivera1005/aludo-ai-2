# Plan: Migrar TTS a Gemini 2.5 Flash TTS

## Objetivo
Reemplazar completamente el motor de voz (`gpt-4o-mini-tts`) por **Gemini 2.5 Flash TTS**, sin tocar el cerebro (GPT-5.4), ni prompts, memoria, flujo conversacional, ni UI.

## Alcance — qué cambia y qué NO

**Cambia (solo capa de voz):**
- `supabase/functions/tts/index.ts` → llama a Gemini TTS en vez de OpenAI TTS.
- `supabase/functions/chat-pet/index.ts` → el bloque inline de TTS (que hoy llama a OpenAI) pasa a llamar a Gemini con la misma lógica. Todo lo demás del archivo (lookup canónico de pet, `buildSystemPrompt`, llamada a `gpt-5.4`, control de uso, historial) queda **idéntico**.

**NO cambia:**
- Modelo de chat (`gpt-5.4`), prompts, `buildSystemPrompt`, reglas, modo experto, seguridad.
- `transcribe` (sigue con `gpt-4o-mini-transcribe`).
- `VoiceChat.tsx`: el cliente sigue recibiendo `{ audio, mime }` en base64 y reproduciendo igual. Toda la lógica de desbloqueo de audio iOS/Safari, GainNode, `playsinline`, `el.load()` antes de `play()`, etc. se mantiene.
- Esquema de DB, RPC `consume_pet_usage`, slugs, formularios.

## Mapeo de voces (única personalización permitida)
- `sex` macho/masculino/male/m → **`Algieba`**
- `sex` hembra/femenino/female/f → **`Gacrux`**

Sin `speakingRate`, sin `pitch`, sin `instructions`, sin prefijos `"... ... ..."`. Texto plano tal cual lo emite GPT-5.4.

## Detalles técnicos

### API de Gemini TTS
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`
- Body:
  ```json
  {
    "contents": [{ "parts": [{ "text": "<reply>" }] }],
    "generationConfig": {
      "responseModalities": ["AUDIO"],
      "speechConfig": {
        "voiceConfig": {
          "prebuiltVoiceConfig": { "voiceName": "Algieba" | "Gacrux" }
        }
      }
    }
  }
  ```
- Respuesta: `candidates[0].content.parts[0].inlineData.data` (base64) con `mimeType` tipo `audio/L16;rate=24000` (PCM crudo 16-bit mono 24kHz).

### Compatibilidad móvil (crítico)
Los navegadores (Safari iOS, Chrome móvil, Android) **no reproducen PCM crudo**. Hay que envolverlo en un contenedor **WAV** en el edge function antes de devolverlo:
- Construir cabecera WAV de 44 bytes (sampleRate=24000, channels=1, bitsPerSample=16) y concatenar con los bytes PCM.
- Devolver al cliente: `{ audio: <base64 WAV>, mime: "audio/wav" }`.

`audio/wav` es soportado nativamente por Safari iOS, Chrome móvil y Android. El `VoiceChat.tsx` actual ya usa `data:${mime};base64,...` por lo que funcionará sin cambios.

### Variables de entorno
- Ya existe `GEMINI_API_KEY` en los secretos del proyecto. No se requiere acción del usuario.

### Manejo de errores
- Si Gemini devuelve 429/5xx → log + responder 500 con `{ error: "Error generando voz" }` (mismo contrato que hoy, el cliente ya muestra toast).
- Timeouts y tamaño: respuestas típicas (1–3 frases) producen WAV de ~50–150 KB, sin problemas para móvil.

## Archivos a modificar
1. `supabase/functions/tts/index.ts` — reescribir el cuerpo para llamar a Gemini + envolver PCM en WAV.
2. `supabase/functions/chat-pet/index.ts` — sustituir solo el bloque `fetch("https://api.openai.com/v1/audio/speech", ...)` por la misma llamada a Gemini + WAV. El resto del archivo intacto.

## Verificación antes de entregar
- Deploy de ambas edge functions.
- Revisar logs (`tts` y `chat-pet`) para confirmar status 200 y tamaño de audio.
- Confirmar en el preview que la respuesta llega y se reproduce (el cliente no requiere cambios).

## Lo que el usuario obtiene
Voz Gemini natural y estándar, sin alteraciones de velocidad/tono/estilo, con `Algieba`/`Gacrux` según sexo, reproducible en Safari iOS, Chrome móvil y Android. Toda la experiencia ALUDO actual (cerebro, prompt, flujo, memoria, UI) permanece exactamente igual.
