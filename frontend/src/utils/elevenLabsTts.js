import api from "../api/axiosInstance";

let activeAudio = null;
let activeObjectUrl = null;

const cleanupActiveAudio = () => {
  if (activeAudio) {
    try {
      activeAudio.pause();
    } catch (err) {
      // no-op
    }
    activeAudio = null;
  }

  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
};

export const stopElevenLabsPlayback = () => {
  cleanupActiveAudio();
};

export const playElevenLabsSpeech = async ({
  text,
  mode = "live_chat",
  modelId = null,
  language = "auto",
  onStart = null,
  onEnd = null,
  onError = null
}) => {
  const safeText = String(text || "").trim();
  if (!safeText) return false;

  try {
    cleanupActiveAudio();

    const response = await api.post(
      "/voice/tts",
      {
        text: safeText,
        mode,
        modelId: modelId || undefined,
        language
      },
      {
        responseType: "blob"
      }
    );

    const blob = response.data;
    const contentType =
      String(response?.headers?.["content-type"] || response?.headers?.["Content-Type"] || "").toLowerCase();

    if (!blob || !blob.size) throw new Error("Empty ElevenLabs audio response");

    if (contentType && !contentType.startsWith("audio/")) {
      let detailText = "";
      try {
        detailText = await blob.text();
      } catch (readErr) {
        // no-op
      }

      let parsed = null;
      try {
        parsed = detailText ? JSON.parse(detailText) : null;
      } catch (parseErr) {
        parsed = null;
      }

      const message =
        parsed?.message
        || parsed?.detail?.message
        || detailText
        || `Unexpected ElevenLabs response content type: ${contentType}`;
      const typedError = new Error(message);
      typedError.status = Number(response?.status) || 0;
      typedError.code = parsed?.code || "";
      typedError.detail = parsed?.failures || parsed || detailText;
      throw typedError;
    }

    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    activeAudio = audio;
    activeObjectUrl = objectUrl;

    let ended = false;
    const finalize = () => {
      if (ended) return;
      ended = true;
      cleanupActiveAudio();
      if (typeof onEnd === "function") onEnd();
    };

    audio.onplay = () => {
      if (typeof onStart === "function") onStart();
    };
    audio.onended = finalize;
    audio.onpause = () => {
      if (audio.currentTime >= audio.duration) finalize();
    };
    audio.onerror = (event) => {
      finalize();
      if (typeof onError === "function") onError(event);
    };

    await audio.play();
    return true;
  } catch (err) {
    if (typeof onError === "function") onError(err);
    cleanupActiveAudio();
    return false;
  }
};
