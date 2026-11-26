export type AiMode = "standard" | "lite" | "byok";

export interface AiSelectionConfig {
  aiMode: AiMode;
  apiKey?: string;
}

export interface AiModeOption {
  value: AiMode;
  label: string;
  description: string;
}

export const AI_MODE_OPTIONS: AiModeOption[] = [
  {
    value: "standard",
    label: "標準（Gemini Flash）",
    description: "バランスの良い基本の Participant。",
  },
  {
    value: "lite",
    label: "軽量・高速（Gemini Flash-Lite）",
    description: "軽快な応答向け。負荷やコストを抑えたいときに。",
  },
  {
    value: "byok",
    label: "自分のAPIキーを使う（BYOK）",
    description: "自分のキーを入力して Participant を動かします。",
  },
];

const STORAGE_KEY = "participant_ai_selection";

export function normalizeAiMode(value: unknown): AiMode {
  if (value === "standard" || value === "lite" || value === "byok") {
    return value;
  }
  return "standard";
}

export function saveAiSelection(config: AiSelectionConfig): void {
  if (typeof window === "undefined") return;
  const normalizedMode = normalizeAiMode(config.aiMode);
  const payload: AiSelectionConfig = {
    aiMode: normalizedMode,
    apiKey: normalizedMode === "byok" ? config.apiKey?.trim() || undefined : undefined,
  };
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearByokApiKey(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<AiSelectionConfig>;
    const payload: AiSelectionConfig = {
      aiMode: normalizeAiMode(parsed.aiMode),
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
}

export function loadAiSelection(queryMode?: string | null): AiSelectionConfig {
  const fallbackMode = normalizeAiMode(queryMode);
  if (typeof window === "undefined") {
    return { aiMode: fallbackMode };
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { aiMode: fallbackMode };
    }
    const parsed = JSON.parse(raw) as Partial<AiSelectionConfig>;
    const resolvedMode = queryMode ? fallbackMode : normalizeAiMode(parsed.aiMode);
    return {
      aiMode: resolvedMode,
      apiKey: resolvedMode === "byok" ? parsed.apiKey?.trim() || undefined : undefined,
    };
  } catch {
    return { aiMode: fallbackMode };
  }
}
