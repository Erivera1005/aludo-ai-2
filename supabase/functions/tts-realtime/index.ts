// WebSocket proxy: browser <-> this function <-> OpenAI Realtime API.
// Only used to turn the final reply text (produced by GPT-5.4 in chat-pet)
// into low-latency streaming audio with model `gpt-realtime-mini`.
// No reasoning, no conversation logic — just TTS streaming.

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-realtime-mini";

function pickVoice(sex?: string | null): "marin" | "ash" {
  const n = (sex || "").toString().toLowerCase();
  const isFemale = ["hembra", "femenino", "mujer", "female", "f"].some((k) =>
    n.includes(k),
  );
  return isFemale ? "marin" : "ash";
}

Deno.serve((req) => {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected websocket upgrade", { status: 426 });
  }
  if (!OPENAI_API_KEY) {
    return new Response("OPENAI_API_KEY missing", { status: 500 });
  }

  const { socket: client, response } = Deno.upgradeWebSocket(req);

  let upstream: WebSocket | null = null;
  let closed = false;
  const safeSendClient = (data: unknown) => {
    if (closed) return;
    try {
      client.send(typeof data === "string" ? data : JSON.stringify(data));
    } catch (_) { /* ignore */ }
  };
  const closeAll = () => {
    closed = true;
    try { upstream?.close(); } catch (_) { /* ignore */ }
    try { client.close(); } catch (_) { /* ignore */ }
  };

  client.onmessage = (ev) => {
    if (upstream) return; // ignore additional payloads on the same connection
    let payload: { text?: string; sex?: string | null } = {};
    try {
      payload = typeof ev.data === "string" ? JSON.parse(ev.data) : {};
    } catch (_) { /* ignore */ }
    const text = (payload.text || "").toString().trim();
    if (!text) {
      safeSendClient({ type: "error", error: "text requerido" });
      closeAll();
      return;
    }
    const voice = pickVoice(payload.sex);

    // OpenAI Realtime supports auth via subprotocols (works from any WebSocket
    // client that can't set headers, including Deno's built-in WebSocket).
    upstream = new WebSocket(OPENAI_REALTIME_URL, [
      "realtime",
      `openai-insecure-api-key.${OPENAI_API_KEY}`,
      "openai-beta.realtime-v1",
    ]);

    upstream.onopen = () => {
      // Configure session for audio-only TTS: PCM16 @ 24kHz, chosen voice,
      // no reasoning, no tool-calls. The model just speaks the user's text.
      upstream!.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["audio", "text"],
          voice,
          output_audio_format: "pcm16",
          instructions:
            "Eres un sintetizador de voz. Repite EXACTAMENTE el texto del usuario, palabra por palabra, sin agregar, omitir ni cambiar nada. Habla en español con acento latinoamericano cálido, tierno, cariñoso y natural. No respondas a lo que dice el texto, solo léelo en voz alta a velocidad natural.",
          turn_detection: null,
        },
      }));

      // Inject the text to be spoken as a user message.
      upstream!.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }));

      // Trigger streaming audio response.
      upstream!.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          voice,
          output_audio_format: "pcm16",
        },
      }));
    };

    upstream.onmessage = (m) => {
      let evt: { type?: string; delta?: string; error?: unknown } = {};
      try {
        evt = typeof m.data === "string" ? JSON.parse(m.data) : {};
      } catch (_) { return; }
      switch (evt.type) {
        case "response.audio.delta":
        case "response.output_audio.delta":
          if (evt.delta) safeSendClient({ type: "audio", data: evt.delta });
          break;
        case "response.audio.done":
        case "response.output_audio.done":
          safeSendClient({ type: "audio_done" });
          break;
        case "response.done":
          safeSendClient({ type: "done" });
          closeAll();
          break;
        case "error":
          console.error("[tts-realtime] upstream error", evt);
          safeSendClient({ type: "error", error: "upstream_error" });
          closeAll();
          break;
      }
    };

    upstream.onerror = (e) => {
      console.error("[tts-realtime] upstream ws error", e);
      safeSendClient({ type: "error", error: "upstream_ws_error" });
      closeAll();
    };
    upstream.onclose = () => {
      if (!closed) {
        safeSendClient({ type: "done" });
        closeAll();
      }
    };
  };

  client.onclose = () => closeAll();
  client.onerror = () => closeAll();

  return response;
});
