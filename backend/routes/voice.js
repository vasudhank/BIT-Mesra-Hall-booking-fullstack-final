const express = require('express');
const axios = require('axios');

const router = express.Router();

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'hpp4J3VqNfWAUOO0d1Us';

const VOICES = {
  live: process.env.ELEVENLABS_LIVE_VOICE_ID || DEFAULT_VOICE_ID,
  immersive: process.env.ELEVENLABS_IMMERSIVE_VOICE_ID || DEFAULT_VOICE_ID
};

const MODELS = {
  live: process.env.ELEVENLABS_LIVE_MODEL_ID || 'eleven_flash_v2_5',
  immersive: process.env.ELEVENLABS_IMMERSIVE_MODEL_ID || 'eleven_v3'
};

const MODEL_FALLBACKS = ['eleven_multilingual_v2', 'eleven_turbo_v2_5'];

const toBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const normalizeLanguage = (value) => {
  const raw = String(value || 'auto').trim().toLowerCase();
  if (raw === 'hi' || raw === 'hindi') return 'hi';
  if (raw === 'en' || raw === 'english') return 'en';
  return 'auto';
};

const hasHindiScript = (text) => /[\u0900-\u097F]/.test(String(text || ''));

const pickVoiceAndModel = ({ mode, text, modelId, language }) => {
  const normalizedMode = String(mode || '').toLowerCase();
  const lowerText = String(text || '').toLowerCase();
  const requestedLanguage = normalizeLanguage(language);

  const immersiveRequested =
    normalizedMode === 'immersive_intro' ||
    normalizedMode === 'deep_dive' ||
    lowerText.includes('deep diving in immersive mode');

  const voiceCandidates = immersiveRequested
    ? Array.from(new Set([VOICES.immersive, VOICES.live].filter(Boolean)))
    : Array.from(new Set([VOICES.live].filter(Boolean)));
  const primaryVoice = voiceCandidates[0] || VOICES.live;

  const shouldPreferMultilingual =
    requestedLanguage === 'hi' ||
    (requestedLanguage === 'auto' && hasHindiScript(text));

  const primaryModel = modelId || (immersiveRequested ? MODELS.immersive : MODELS.live);
  const preferredModels = [
    shouldPreferMultilingual ? 'eleven_multilingual_v2' : null,
    primaryModel
  ].filter(Boolean);

  const modelCandidates = [...preferredModels, ...MODEL_FALLBACKS].filter(Boolean);
  const deduped = Array.from(new Set(modelCandidates));

  return {
    voiceCandidates,
    primaryVoice,
    modelCandidates: deduped,
    immersiveRequested,
    requestedLanguage
  };
};

const buildVoiceSettings = (immersiveRequested, providedSettings) => {
  const defaults = immersiveRequested
    ? {
      stability: 0.36,
      similarity_boost: 0.82,
      style: 0.48,
      use_speaker_boost: true
    }
    : {
      stability: 0.44,
      similarity_boost: 0.78,
      style: 0.34,
      use_speaker_boost: true
    };

  const settings = providedSettings && typeof providedSettings === 'object' ? providedSettings : {};
  return {
    stability: clamp(settings.stability, 0, 1, defaults.stability),
    similarity_boost: clamp(settings.similarity_boost, 0, 1, defaults.similarity_boost),
    style: clamp(settings.style, 0, 1, defaults.style),
    use_speaker_boost: toBoolean(settings.use_speaker_boost, defaults.use_speaker_boost)
  };
};

const normalizeVoiceSettingsForModel = (voiceSettings, modelId) => {
  const settings = { ...voiceSettings };
  if (String(modelId || '').toLowerCase() === 'eleven_v3') {
    const allowed = [0, 0.5, 1];
    const current = Number(settings.stability);
    const safeCurrent = Number.isNaN(current) ? 0.5 : current;
    let nearest = allowed[0];
    for (const value of allowed) {
      if (Math.abs(value - safeCurrent) < Math.abs(nearest - safeCurrent)) {
        nearest = value;
      }
    }
    settings.stability = nearest;
  }
  return settings;
};

router.post('/tts', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        message: 'ELEVENLABS_API_KEY is missing on server.'
      });
    }

    const text = String(req.body?.text || '').trim();
    const mode = String(req.body?.mode || 'live_chat').trim();
    const providedModel = String(req.body?.modelId || '').trim() || null;
    const requestedLanguage = normalizeLanguage(req.body?.language);

    if (!text) {
      return res.status(400).json({ ok: false, message: 'text is required' });
    }

    const safeText = text.slice(0, 5000);
    const {
      voiceCandidates,
      primaryVoice,
      modelCandidates,
      immersiveRequested,
      requestedLanguage: resolvedLanguage
    } = pickVoiceAndModel({
      mode,
      text: safeText,
      modelId: providedModel,
      language: requestedLanguage
    });
    const voiceSettings = buildVoiceSettings(immersiveRequested, req.body?.voice_settings);

    const failureReasons = [];

    for (const voiceId of voiceCandidates) {
      for (const modelId of modelCandidates) {
        try {
          const perModelSettings = normalizeVoiceSettingsForModel(voiceSettings, modelId);

          const elevenResponse = await axios.post(
            `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
            {
              text: safeText,
              model_id: modelId,
              voice_settings: perModelSettings
            },
            {
              responseType: 'arraybuffer',
              headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
                Accept: 'audio/mpeg'
              },
              timeout: 30000,
              validateStatus: () => true
            }
          );

          if (elevenResponse.status >= 200 && elevenResponse.status < 300) {
            const contentType = elevenResponse.headers['content-type'] || 'audio/mpeg';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-ElevenLabs-Voice-Id', voiceId);
            res.setHeader('X-ElevenLabs-Model-Used', modelId);
            res.setHeader('X-ElevenLabs-Language', resolvedLanguage);
            if (voiceId !== primaryVoice) {
              res.setHeader('X-ElevenLabs-Voice-Fallback', 'true');
            }
            return res.send(Buffer.from(elevenResponse.data));
          }

          const detailText = Buffer.from(elevenResponse.data || []).toString('utf8');
          failureReasons.push({
            voiceId,
            modelId,
            status: elevenResponse.status,
            detail: detailText.slice(0, 500)
          });
        } catch (err) {
          failureReasons.push({
            voiceId,
            modelId,
            status: 0,
            detail: err.message || 'Unknown ElevenLabs error'
          });
        }
      }
    }

    return res.status(502).json({
      ok: false,
      message: 'ElevenLabs TTS failed for all model candidates.',
      failures: failureReasons
    });
  } catch (err) {
    console.error('Voice /tts route error:', err);
    return res.status(500).json({ ok: false, message: 'Voice synthesis failed.' });
  }
});

router.post('/token', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        message: 'ELEVENLABS_API_KEY is missing on server.'
      });
    }

    const endpointCandidates = [
      `${ELEVENLABS_BASE_URL}/convai/conversation/token`,
      `${ELEVENLABS_BASE_URL}/single-use-token`
    ];

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const failures = [];

    for (const endpoint of endpointCandidates) {
      try {
        const tokenResponse = await axios.post(endpoint, body, {
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 15000,
          validateStatus: () => true
        });

        if (tokenResponse.status >= 200 && tokenResponse.status < 300) {
          return res.json({
            ok: true,
            endpoint,
            data: tokenResponse.data
          });
        }

        failures.push({
          endpoint,
          status: tokenResponse.status,
          data: tokenResponse.data
        });
      } catch (err) {
        failures.push({
          endpoint,
          status: 0,
          data: err.message || 'Unknown token error'
        });
      }
    }

    return res.status(502).json({
      ok: false,
      message: 'Unable to create ElevenLabs token with available endpoints.',
      failures
    });
  } catch (err) {
    console.error('Voice /token route error:', err);
    return res.status(500).json({ ok: false, message: 'Voice token creation failed.' });
  }
});

module.exports = router;
