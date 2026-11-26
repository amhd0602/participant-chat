'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AiModeSelector } from '@/components/AiModeSelector';
import { AI_MODE_OPTIONS, type AiMode, clearByokApiKey, loadAiSelection, saveAiSelection } from '@/types/ai-selection';

type ChatMessage = {
  id: string;
  room_id: string;
  content: string;
  sender_name: string | null;
  sender_type: string;
  created_at: string;
};

const ROOM_AI_LIMIT = 20;
const roomNameListeners = new Set<() => void>();

function notifyRoomNameChange() {
  for (const listener of roomNameListeners) {
    listener();
  }
}

function subscribeRoomName(callback: () => void) {
  roomNameListeners.add(callback);
  window.addEventListener('storage', callback);
  return () => {
    roomNameListeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}

function getRoomNameSnapshot(roomId: string): string {
  if (!roomId || typeof window === 'undefined') return '';
  return sessionStorage.getItem(`participant_room_name_${roomId}`)?.trim() || '';
}

function getServerRoomNameSnapshot(): string {
  return '';
}

function ChatRoomContent() {
  const params = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const roomId = params.roomId;
  const queryAiMode = searchParams.get('aiMode');

  const userName = useSyncExternalStore(
    subscribeRoomName,
    () => getRoomNameSnapshot(roomId),
    getServerRoomNameSnapshot
  );
  const isRegistered = Boolean(userName);

  const [nameInput, setNameInput] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [quotaNotice, setQuotaNotice] = useState('');
  const [aiUsedCount, setAiUsedCount] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [onlineCount, setOnlineCount] = useState(1);
  const [soloPromptShown, setSoloPromptShown] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const presenceKeyRef = useRef<string>('');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const aiTriggeringRef = useRef(false);
  const lastAiTriggerAtRef = useRef(0);

  const [selectedAiMode, setSelectedAiMode] = useState<AiMode>(() => loadAiSelection(queryAiMode).aiMode);
  const [draftApiKey, setDraftApiKey] = useState<string>(() => loadAiSelection(queryAiMode).apiKey ?? '');
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);

  useEffect(() => {
    const loaded = loadAiSelection(queryAiMode);
    setSelectedAiMode(loaded.aiMode);
    setDraftApiKey(loaded.apiKey ?? '');
  }, [queryAiMode]);

  const storedSelection = loadAiSelection(queryAiMode);
  const currentSelection = {
    ...storedSelection,
    aiMode: selectedAiMode,
    apiKey: selectedAiMode === 'byok' ? (draftApiKey.trim() || storedSelection.apiKey) : undefined,
  };
  const currentAiLabel =
    AI_MODE_OPTIONS.find((opt) => opt.value === selectedAiMode)?.label ??
    '標準（Gemini Flash）';

  const handleToggleAiMode = () => {
    const nextMode: AiMode = selectedAiMode === 'lite' ? 'standard' : 'lite';
    saveAiSelection({
      aiMode: nextMode,
      apiKey: undefined,
    });
    setSelectedAiMode(nextMode);
    setErrorMsg('');
    setQuotaNotice('');
  };

  const handleSelectAiMode = (mode: AiMode) => {
    const trimmedKey = draftApiKey.trim();
    saveAiSelection({
      aiMode: mode,
      apiKey: mode === 'byok' ? (trimmedKey || undefined) : undefined,
    });
    setSelectedAiMode(mode);
    setErrorMsg('');
    setQuotaNotice('');
  };

  const handleChangeDraftApiKey = (nextKey: string) => {
    setDraftApiKey(nextKey);
    const trimmed = nextKey.trim();
    saveAiSelection({
      aiMode: selectedAiMode,
      apiKey: selectedAiMode === 'byok' ? (trimmed || undefined) : undefined,
    });
    if (trimmed) {
      setErrorMsg('');
    }
  };

  const handleClearRoomByokKey = () => {
    clearByokApiKey();
    setDraftApiKey('');
    setErrorMsg('');
  };

  const distinctHumanSenders = useMemo(() => {
    const names = new Set<string>();
    for (const m of messages) {
      if (m.sender_type === 'human' && m.sender_name?.trim()) {
        names.add(m.sender_name.trim());
      }
    }
    return names.size;
  }, [messages]);

  const humanCount = Math.max(onlineCount, distinctHumanSenders);
  const isGroupChat = humanCount >= 2;

  const hasScrolledInitiallyRef = useRef(false);

  useEffect(() => {
    if (!bottomRef.current) return;
    if (!hasScrolledInitiallyRef.current) {
      if (messages.length === 0) return;
      hasScrolledInitiallyRef.current = true;
      bottomRef.current.scrollIntoView({ behavior: 'instant' });
      return;
    }
    bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, soloPromptShown]);

  useEffect(() => {
    if (!roomId || !isRegistered) return;

    let active = true;
    if (!presenceKeyRef.current) {
      presenceKeyRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `user-${Math.random().toString(36).slice(2)}`;
    }

    const loadRoomInfo = async () => {
      const { data, error } = await supabase
        .from('rooms')
        .select('name')
        .eq('id', roomId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        setErrorMsg(`ルーム情報取得エラー: ${error.message}`);
        return;
      }
      if (!data) {
        setRoomNotFound(true);
        return;
      }
      setRoomNotFound(false);
      if (data.name) {
        setRoomName(data.name);
      }
    };

    const loadMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, room_id, content, sender_name, sender_type, created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });

      if (!active) return;
      if (error) {
        setErrorMsg(`履歴取得エラー: ${error.message}`);
        return;
      }
      const list = data ?? [];
      setMessages(list);
      setAiUsedCount(list.filter((m) => m.sender_type === 'ai').length);
    };

    void loadRoomInfo();
    void loadMessages();

    const channel = supabase.channel(`room-${roomId}`, {
      config: {
        presence: {
          key: presenceKeyRef.current,
        },
      },
    });
    channelRef.current = channel;

    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          if (newMsg.sender_type === 'ai' && selectedAiMode !== 'byok') {
            setAiUsedCount((prev) => (prev === null ? 1 : prev + 1));
          }
        }
      )
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const count = Object.keys(state).length;
        setOnlineCount(Math.max(1, count));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_name: userName,
            joined_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      active = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [roomId, queryAiMode, isRegistered, userName]);

  useEffect(() => {
    if (!isRegistered || isGroupChat || soloPromptShown) return;
    const timer = setTimeout(() => {
      setSoloPromptShown(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, [isRegistered, isGroupChat, soloPromptShown]);

  const handleRegisterName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId) return;
    const trimmed = nameInput.trim() || 'ゲスト';
    sessionStorage.setItem(`participant_room_name_${roomId}`, trimmed);
    notifyRoomNameChange();
  };

  const triggerAiPeer = async (currentRoomId: string) => {
    const now = Date.now();
    if (aiTriggeringRef.current || now - lastAiTriggerAtRef.current < 3000) {
      return;
    }
    aiTriggeringRef.current = true;
    lastAiTriggerAtRef.current = now;
    try {
      const selection = loadAiSelection(queryAiMode);
      const effectiveApiKey = draftApiKey.trim() || selection.apiKey;
      if (selectedAiMode === 'byok' && !effectiveApiKey) {
        setIsAiSettingsOpen(true);
        setErrorMsg('BYOK を使うには Gemini API キーを入力してください。');
        return;
      }
      const res = await fetch('/api/ai-peer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: currentRoomId,
          senderName: 'Participant（修行中）',
          aiMode: selectedAiMode,
          ...(selectedAiMode === 'byok' && effectiveApiKey
            ? { apiKey: effectiveApiKey }
            : {}),
        }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        if (data?.code === 'ROOM_AI_LIMIT_REACHED') {
          setAiUsedCount(ROOM_AI_LIMIT);
          setQuotaNotice(
            `このルームのAI応答上限（${ROOM_AI_LIMIT}回）に達しました。チャットはそのまま続けられます（自分のAPIキーを使うBYOKなら無制限です）。`
          );
        } else {
          setQuotaNotice(
            'AI（Participant）は現在Gemini APIのクォータ上限に達しているため待機中です。チャットはそのまま続けられます。'
          );
        }
        return;
      }

      if (res.status === 503) {
        setQuotaNotice(
          'AI（Participant）は現在アクセス集中により応答を待機しています。少し時間を置くか「軽量・高速（Gemini Flash-Lite）」をお試しください。'
        );
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(`AI応答エラー: ${data.error || res.statusText}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`AI通信エラー: ${msg}`);
    } finally {
      aiTriggeringRef.current = false;
    }
  };

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setErrorMsg('URLのコピーに失敗しました。アドレスバーから直接コピーしてください。');
    }
  };

  const sendContent = async (rawText: string, clearInput: boolean) => {
    if (sending || roomNotFound) return;
    setErrorMsg('');
    const text = rawText.trim();
    if (!text || !roomId) return;
    if (text.length > 2000) {
      setErrorMsg(`メッセージは2000文字以内で入力してください（現在${text.length}文字）。`);
      return;
    }

    setSending(true);
    try {
      const { error } = await supabase.from('messages').insert({
        room_id: roomId,
        content: text,
        sender_name: userName,
        sender_type: 'human',
      });

      if (error) {
        setErrorMsg(`送信エラー: ${error.message}`);
        return;
      }
      if (clearInput) {
        setInputText('');
      }

      if (isGroupChat) {
        void triggerAiPeer(roomId);
      } else {
        setSoloPromptShown(true);
      }
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendContent(inputText, true);
  };

  const handleQuickEmojiSend = async (emoji: string) => {
    await sendContent(emoji, false);
  };

  if (!isRegistered) {
    return (
      <main className="mx-auto flex h-screen max-w-md flex-col justify-center p-4">
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-900 shadow-xs dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-bold">{roomName || 'チャットルーム'}</h1>
            <Link
              href="/"
              onClick={() => clearByokApiKey()}
              className="text-xs text-gray-600 hover:underline dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              トップへ戻る
            </Link>
          </div>
          <p className="mt-2 text-xs text-gray-600 dark:text-neutral-400">
            このチャットに初めて参加します。表示名を登録してください。
          </p>

          <form onSubmit={handleRegisterName} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 dark:text-neutral-200">
              表示名
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="例: たろう（空欄なら ゲスト）"
                autoFocus
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              この名前で参加する
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (roomNotFound) {
    return (
      <main className="mx-auto flex h-screen max-w-md flex-col justify-center p-4">
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-900 shadow-xs dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
          <h1 className="text-lg font-bold">ルームが見つかりませんでした</h1>
          <p className="mt-2 text-xs text-gray-600 dark:text-neutral-400">
            URLが間違っているか、ルームが存在しない可能性があります。
          </p>
          <Link
            href="/"
            onClick={() => clearByokApiKey()}
            className="mt-4 inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            トップへ戻る
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col p-4">
      <header className="border-b border-gray-200 pb-2.5 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base font-bold sm:text-lg">
              {roomName || 'チャットルーム'}
            </h1>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                isGroupChat
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300'
              }`}
            >
              {isGroupChat
                ? `参加者 ${humanCount}人・AI参加中`
                : `参加者 1人（招待待ち）`}
            </span>
          </div>
          <Link
            href="/"
            onClick={() => clearByokApiKey()}
            className="shrink-0 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            ← 退室
          </Link>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-neutral-400">
          <span title={roomId} className="font-mono text-[11px]">
            ID: {roomId ? `${roomId.slice(0, 8)}…` : ''}
          </span>
          <button
            type="button"
            onClick={handleCopyInviteLink}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {copiedLink ? 'コピー済み' : '招待リンクをコピー'}
          </button>
          <span aria-hidden="true">・</span>
          <span>表示名: {userName}</span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleToggleAiMode}
            className="text-left text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:decoration-blue-700 dark:hover:text-blue-300"
          >
            AI: {currentAiLabel}（切替）
          </button>
          <button
            type="button"
            onClick={() => setIsAiSettingsOpen((prev) => !prev)}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {isAiSettingsOpen ? '設定を閉じる' : 'AI設定・BYOK'}
          </button>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-neutral-800 dark:text-neutral-300">
            利用枠:{' '}
            {currentSelection.aiMode === 'byok'
              ? '無制限 (BYOK)'
              : aiUsedCount === null
                ? `上限${ROOM_AI_LIMIT}回`
                : `残り${Math.max(0, ROOM_AI_LIMIT - aiUsedCount)}/${ROOM_AI_LIMIT}回`}
          </span>
        </div>

        {isAiSettingsOpen && (
          <div className="mt-2 max-h-[45vh] space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/90">
            <AiModeSelector
              aiMode={selectedAiMode}
              apiKey={draftApiKey}
              onChangeMode={handleSelectAiMode}
              onChangeApiKey={handleChangeDraftApiKey}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs text-gray-500 dark:text-neutral-400">
                ※ API キーはこのブラウザの sessionStorage にのみ保存されます。
              </span>
              {draftApiKey && (
                <button
                  type="button"
                  onClick={handleClearRoomByokKey}
                  className="rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/70 dark:bg-neutral-950 dark:text-red-400 dark:hover:bg-red-950/50"
                >
                  保存済みキーを消去
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="my-3 flex flex-1 flex-col gap-2.5 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950/60">
        {messages.length === 0 && !soloPromptShown ? (
          <p className="text-sm text-gray-400 dark:text-neutral-500">まだメッセージはありません。</p>
        ) : (
          messages.map((msg) => {
            const isAi = msg.sender_type === 'ai';
            const isSelf = !isAi && Boolean(userName) && msg.sender_name === userName;
            const bubbleClass = isAi
              ? 'border border-blue-200/80 bg-blue-50/80 text-gray-900 dark:border-blue-900/60 dark:bg-blue-950/35 dark:text-neutral-100'
              : isSelf
                ? 'border border-emerald-200/70 bg-emerald-50/50 text-gray-900 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-neutral-100'
                : 'border border-gray-200/80 bg-gray-50 text-gray-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100';
            const nameClass = isAi
              ? 'text-blue-700 dark:text-blue-300'
              : isSelf
                ? 'text-emerald-800 dark:text-emerald-300'
                : 'text-gray-600 dark:text-neutral-400';

            return (
              <div
                key={msg.id}
                className={`rounded-lg p-2.5 text-sm ${bubbleClass}`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <span className={nameClass}>
                    {msg.sender_name || msg.sender_type}
                  </span>
                  {isAi && (
                    <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/70 dark:text-blue-200">
                      AI
                    </span>
                  )}
                  {isSelf && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/70 dark:text-emerald-200">
                      自分
                    </span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            );
          })
        )}

        {!isGroupChat && soloPromptShown && (
          <div className="rounded-lg border border-blue-200/80 bg-blue-50/80 p-3 text-sm text-gray-800 dark:border-blue-900/60 dark:bg-blue-950/35 dark:text-neutral-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
              <span>Participant（修行中）</span>
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/70 dark:text-blue-200">
                AI
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed">
              まだ1人みたいだけど、誰か呼ばないの？ グループチャットだから、もう1人くらいいるとボクも会話に混ざりやすいんだけどな〜。
            </p>
            <button
              type="button"
              onClick={handleCopyInviteLink}
              className="mt-2 rounded border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-neutral-900 dark:text-blue-300 dark:hover:bg-neutral-800"
            >
              {copiedLink ? '招待リンクをコピーしました！' : '招待リンクをコピーして誘う'}
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {quotaNotice && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
          <span>{quotaNotice}</span>
          <button
            type="button"
            onClick={() => setQuotaNotice('')}
            aria-label="通知を閉じる"
            className="px-1 font-bold text-amber-900 hover:opacity-75 dark:text-amber-100"
          >
            ×
          </button>
        </div>
      )}

      {errorMsg && (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
          {errorMsg}
        </p>
      )}

      <div className="mb-2 flex items-center gap-1.5">
        {["👍","👏","🙏","😄"].map((emoji) => (
          <button
            key={emoji}
            type="button"
            disabled={sending || roomNotFound}
            onClick={() => void handleQuickEmojiSend(emoji)}
            aria-label={`${emoji}を送信`}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-base leading-none hover:bg-gray-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            {emoji}
          </button>
        ))}
      </div>

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="メッセージを入力..."
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={sending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {sending ? '送信中...' : '送信'}
        </button>
      </form>
    </main>
  );
}

export default function ChatRoomPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex h-screen max-w-2xl items-center justify-center p-4">
          <p className="text-sm text-gray-500">ルームを読み込み中...</p>
        </main>
      }
    >
      <ChatRoomContent />
    </Suspense>
  );
}
