/** Read reviewed server-owned text; never accept arbitrary speech from visitors. */
export function taskAudioText(task) {
  return `Careweave demonstration. This is an approved care-team task for fictional patient ${task.patientId}. ${task.body} Assigned care-team role: ${task.owner}. Approval does not mean that this task has been carried out.`;
}

export async function generateTaskAudio(text, settings, signal) {
  if (text.length > 2400) throw new Error("audio_length");
  const response = await (settings.fetchImpl || fetch)(
    `https://api.elevenlabs.io/v1/text-to-speech/${settings.elevenLabsVoiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": settings.elevenLabsApiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: settings.elevenLabsModel || "eleven_flash_v2_5",
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
    },
  );
  if (!response.ok) throw new Error("audio_service");
  if (!/^audio\/mpeg(?:;|$)/i.test(response.headers.get("content-type") || ""))
    throw new Error("audio_format");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error("audio_size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size < 3) throw new Error("audio_format");
  const audio = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }
  if (
    !(
      (audio[0] === 73 && audio[1] === 68 && audio[2] === 51) ||
      (audio[0] === 255 && (audio[1] & 224) === 224)
    )
  )
    throw new Error("audio_format");
  return audio;
}
