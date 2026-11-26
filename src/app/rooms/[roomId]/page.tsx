'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AI_MODE_OPTIONS, clearByokApiKey, loadAiSelection } from '@/types/ai-selection';

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

  const currentSelection = loadAiSelection(queryAiMode);
  const currentAiLabel =
    AI_MODE_OPTIONS.find((opt) => opt.value === currentSelection.aiMode)?.label ??
    '標準（Gemini Flash）';

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
          if (newMsg.sender_type === 'ai' && loadAiSelection(queryAiMode).aiMode !== 'byok') {
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
      const res = await fetch('/api/ai-peer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: currentRoomId,
          senderName: 'Participant（修行中）',
          aiMode: selection.aiMode,
          ...(selection.aiMode === 'byok' && selection.apiKey
            ? { apiKey: selection.apiKey }
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || roomNotFound) return;
    setErrorMsg('');
    const text = inputText.trim();
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
      setInputText('');

      if (isGroupChat) {
        void triggerAiPeer(roomId);
      } else {
        setSoloPromptShown(true);
      }
    } finally {
      setSending(false);
    }
  };

  if (!isRegistered) {
    return (
      <main className="mx-auto flex h-screen max-w-md flex-col justify-center p-4">
        <div className="rounded border p-6 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-bold">{roomName || 'チャットルーム'}</h1>
            <Link
              href="/"
              onClick={() => clearByokApiKey()}
              className="text-xs text-gray-500 hover:underline"
            >
              トップへ戻る
            </Link>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            このチャットに初めて参加します。表示名を登録してください。
          </p>

          <form onSubmit={handleRegisterName} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
              表示名
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="例: たろう（空欄なら ゲスト）"
                autoFocus
                className="rounded border px-3 py-2 text-sm text-gray-900"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
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
        <div className="rounded border p-6 text-center shadow-xs">
          <h1 className="text-lg font-bold">ルームが見つかりませんでした</h1>
          <p className="mt-2 text-xs text-gray-500">
            URLが間違っているか、ルームが存在しない可能性があります。
          </p>
          <Link
            href="/"
            onClick={() => clearByokApiKey()}
            className="mt-4 inline-block rounded bg-black px-4 py-2 text-sm text-white"
          >
            トップへ戻る
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col p-4">
      <header className="border-b pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">{roomName || 'チャットルーム'}</h1>
          <Link
            href="/"
            onClick={() => clearByokApiKey()}
            className="rounded border px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            ← 退室する
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-xs text-gray-500">Room ID: {roomId}</p>
          <button
            type="button"
            onClick={handleCopyInviteLink}
            className="rounded border px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            {copiedLink ? 'コピーしました' : '招待リンクをコピー'}
          </button>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              isGroupChat
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {isGroupChat
              ? `参加者 ${humanCount}人・Participant参加中`
              : '参加者 1人（招待待ち）'}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">表示名: {userName}</p>
        <p className="text-xs text-blue-600">使用AI: {currentAiLabel}</p>
        <p className="text-xs text-gray-500">
          AI利用枠:{' '}
          {currentSelection.aiMode === 'byok'
            ? '無制限（BYOK）'
            : aiUsedCount === null
              ? `上限 ${ROOM_AI_LIMIT}回`
              : `残り ${Math.max(0, ROOM_AI_LIMIT - aiUsedCount)} / ${ROOM_AI_LIMIT}回`}
        </p>
      </header>

      <div className="my-4 flex flex-1 flex-col gap-3 overflow-y-auto rounded border p-3">
        {messages.length === 0 && !soloPromptShown ? (
          <p className="text-sm text-gray-400">まだメッセージはありません。</p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className="rounded bg-gray-50 p-2.5 text-sm text-gray-900"
            >
              <div className="text-xs font-semibold text-gray-600">
                {msg.sender_name || msg.sender_type}
                {msg.sender_type === 'ai' ? ' (AI)' : ''}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))
        )}

        {!isGroupChat && soloPromptShown && (
          <div className="rounded border border-blue-100 bg-blue-50/70 p-3 text-sm text-gray-800">
            <div className="text-xs font-semibold text-blue-700">
              Participant（修行中） (AI)
            </div>
            <p className="mt-1 whitespace-pre-wrap">
              まだ1人みたいだけど、誰か呼ばないの？ グループチャットだから、もう1人くらいいるとボクも会話に混ざりやすいんだけどな〜。
            </p>
            <button
              type="button"
              onClick={handleCopyInviteLink}
              className="mt-2 rounded border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              {copiedLink ? '招待リンクをコピーしました！' : '招待リンクをコピーして誘う'}
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {quotaNotice && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
          <span>{quotaNotice}</span>
          <button
            type="button"
            onClick={() => setQuotaNotice('')}
            aria-label="通知を閉じる"
            className="px-1 font-bold text-amber-900"
          >
            ×
          </button>
        </div>
      )}

      {errorMsg && (
        <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-600">{errorMsg}</p>
      )}

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="メッセージを入力..."
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={sending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
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
