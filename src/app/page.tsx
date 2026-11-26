'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AiModeSelector } from '@/components/AiModeSelector';
import { clearByokApiKey, loadAiSelection, saveAiSelection, type AiMode } from '@/types/ai-selection';
import { AdSenseSlot } from '@/components/AdSenseSlot';

const emptySubscribe = () => () => {};

function useClientHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export default function HomePage() {
  const router = useRouter();
  const hydrated = useClientHydrated();
  const [userNameOverride, setUserNameOverride] = useState<string | null>(null);
  const [aiModeOverride, setAiModeOverride] = useState<AiMode | null>(null);
  const [apiKeyOverride, setApiKeyOverride] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const userName =
    userNameOverride !== null
      ? userNameOverride
      : hydrated
        ? (() => {
            const saved = localStorage.getItem('participant_user_name') || '';
            return saved === 'ゲスト' ? '' : saved;
          })()
        : '';

  const aiMode: AiMode =
    aiModeOverride !== null
      ? aiModeOverride
      : hydrated
        ? loadAiSelection().aiMode
        : 'standard';

  const apiKey =
    apiKeyOverride !== null
      ? apiKeyOverride
      : hydrated
        ? (loadAiSelection().apiKey ?? '')
        : '';

  useEffect(() => {
    clearByokApiKey();
  }, []);

  const validateAiSelection = () => {
    if (aiMode === 'byok' && !apiKey.trim()) {
      setErrorMsg('BYOK を選択した場合は API キーを入力してください。');
      return false;
    }
    return true;
  };

  const saveNameAndGo = (targetRoomId: string) => {
    const trimmedName = userName.trim() || 'ゲスト';
    localStorage.setItem('participant_user_name', trimmedName);
    sessionStorage.setItem(`participant_room_name_${targetRoomId}`, trimmedName);
    saveAiSelection({ aiMode, apiKey: apiKey.trim() });
    setApiKeyOverride("");
    router.push(`/rooms/${targetRoomId}?aiMode=${encodeURIComponent(aiMode)}`);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!validateAiSelection()) return;

    setLoading(true);

    try {
      const trimmedName = userName.trim() || 'ゲスト';
      const finalRoomName = roomName.trim() || `${trimmedName}のルーム`;

      const { data, error } = await supabase
        .from('rooms')
        .insert({ name: finalRoomName })
        .select('id')
        .single();

      if (error) {
        setErrorMsg(`ルーム作成エラー: ${error.message}`);
        return;
      }

      saveNameAndGo(data.id);
    } finally {
      setLoading(false);
    }
  };

  const extractRoomId = (raw: string) => {
    const trimmed = raw.trim();
    const match = trimmed.match(/\/rooms\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return trimmed.split(/[?#]/)[0];
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!validateAiSelection()) return;

    const targetId = extractRoomId(roomIdInput);
    if (!targetId) {
      setErrorMsg('参加するルームIDを入力してください。');
      return;
    }
    saveNameAndGo(targetId);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6">
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-2xl font-bold">Participant</h1>
          <span className="text-sm font-normal text-gray-900 dark:text-neutral-100">AI参加型グループチャット</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          使う AI を選択して、チャットルームを作成または参加してください。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">あなたの表示名</label>
        <input
          type="text"
          value={userName}
          onChange={(e) => setUserNameOverride(e.target.value)}
          placeholder="例：タロウ"
          className="rounded border px-3 py-2 text-sm"
        />
      </div>

      <AiModeSelector
        aiMode={aiMode}
        apiKey={apiKey}
        onChangeMode={setAiModeOverride}
        onChangeApiKey={setApiKeyOverride}
      />

      <form onSubmit={handleCreateRoom} className="flex flex-col gap-3 rounded border p-4">
        <h2 className="font-semibold">新しいルームを作成</h2>
        <input
          type="text"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          placeholder="ルーム名（空欄なら自動設定）"
          className="rounded border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-fit rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? '作成中...' : 'ルームを作成して入る'}
        </button>
      </form>

      <form onSubmit={handleJoinRoom} className="flex flex-col gap-3 rounded border p-4">
        <h2 className="font-semibold">既存のルームに参加</h2>
        <input
          type="text"
          value={roomIdInput}
          onChange={(e) => setRoomIdInput(e.target.value)}
          placeholder="ルームID（UUID）または招待URLを貼り付け"
          className="rounded border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="w-fit rounded border px-4 py-2 text-sm"
        >
          参加する
        </button>
      </form>

      {errorMsg && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-600">{errorMsg}</p>
      )}
      <AdSenseSlot />
    </main>
  );
}
