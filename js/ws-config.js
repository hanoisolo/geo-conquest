/* ============================================================
   ws-config.js — shared constants for the worksheet import flow
   (OCR model, providers, file limits, caps, dedup threshold).
   Plain browser JS, no imports, no build step.
   ============================================================ */
"use strict";

const GeoWSConfig = Object.freeze({
  OCR_MODEL: "mistral-ocr-latest",
  PROVIDER_IDS: Object.freeze(["mistral", "gemini", "openai"]),
  PROVIDERS: Object.freeze({
    mistral: Object.freeze({
      id: "mistral",
      label: "Mistral (OCR + GLM 5.3)",
      model: "zai-glm-5-3",
      fallbackModel: "mistral-large-4",
      keyUrl: "https://console.mistral.ai/api-keys"
    }),
    gemini: Object.freeze({
      id: "gemini",
      label: "Google Gemini",
      model: "gemini-3.8-flash",
      keyUrl: "https://aistudio.google.com/apikey"
    }),
    openai: Object.freeze({
      id: "openai",
      label: "OpenAI",
      model: "gpt-6-luna",
      keyUrl: "https://platform.openai.com/api-keys"
    })
  }),
  MAX_FILE_MB: 5,
  MAX_FILES: 10,
  ACCEPT_MIME: Object.freeze(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
  QUESTIONS_PER_SHEET: Object.freeze({ min: 10, max: 20 }),
  MAX_PER_SHEET: 25,
  MAX_PER_DECK: 500,
  SMALL_DECK: 25,
  CAPS: Object.freeze({
    q: 300,
    option: 120,
    explain: 400,
    hint: 200,
    category: 40,
    title: 80,
    subject: 40,
    grade: 20
  }),
  NEAR_DUP_JACCARD: 0.85
});

if (typeof module !== "undefined" && module.exports) module.exports = GeoWSConfig;
