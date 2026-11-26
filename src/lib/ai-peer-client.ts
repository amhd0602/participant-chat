import { loadAiSelection, type AiSelectionConfig } from "@/types/ai-selection";

export interface CallAiPeerParams {
  roomId: string;
  messages: unknown;
  queryMode?: string | null;
  overrideConfig?: AiSelectionConfig;
}

export function buildAiPeerRequestBody({
  roomId,
  messages,
  queryMode,
  overrideConfig,
}: CallAiPeerParams) {
  const selection = overrideConfig ?? loadAiSelection(queryMode);

  return {
    roomId,
    messages,
    aiMode: selection.aiMode,
    ...(selection.aiMode === "byok" && selection.apiKey
      ? { apiKey: selection.apiKey }
      : {}),
  };
}

export async function requestAiPeer(params: CallAiPeerParams) {
  const body = buildAiPeerRequestBody(params);

  const response = await fetch("/api/ai-peer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}
