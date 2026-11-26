import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type AiMode = 'standard' | 'lite' | 'byok';

const ROOM_AI_LIMIT = 20;

function normalizeAiMode(value: unknown): AiMode {
  if (value === 'standard' || value === 'lite' || value === 'byok') {
    return value;
  }
  return 'standard';
}

function resolveModelId(aiMode: AiMode): string {
  if (aiMode === 'lite') {
    return 'gemini-flash-lite-latest';
  }
  return 'gemini-flash-latest';
}

function createProvider(aiMode: AiMode, apiKey?: string) {
  if (aiMode === 'byok') {
    return createGoogleGenerativeAI({ apiKey });
  }
  return createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /quota|exceeded|429|rate.?limit/i.test(msg);
}

function isOverloadedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /503|unavailable|high demand|overloaded/i.test(msg);
}

function weatherCodeToLabel(code: number | undefined): string {
  if (code === undefined) return '不明';
  if (code === 0) return '快晴・晴れ';
  if (code === 1 || code === 2) return '晴れ時々くもり';
  if (code === 3) return 'くもり';
  if (code === 45 || code === 48) return '霧';
  if ([51, 53, 55, 56, 57].includes(code)) return '霧雨';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '雨';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '雪';
  if ([95, 96, 99].includes(code)) return '雷雨';
  return `天気コード(${code})`;
}

function extractPlaceFromText(text: string, latestUserText?: string): string | null {
  if (latestUserText) {
    const fromLatest = extractPlaceSingle(latestUserText);
    if (fromLatest) return fromLatest;
  }
  return extractPlaceSingle(text);
}

function extractPlaceSingle(text: string): string | null {
  const knownPlaces = [
    '札幌',
    '富良野',
    '旭川',
    '函館',
    '小樽',
    '帯広',
    '釧路',
    '北見',
    '網走',
    '稚内',
    '室蘭',
    '苫小牧',
    'ニセコ',
    '東京',
    '大阪',
    '名古屋',
    '福岡',
    '仙台',
    '那覇',
  ];
  for (const place of knownPlaces) {
    if (text.includes(place)) {
      return place;
    }
  }
  const match = text.match(
    /([一-鿥ぁ-んァ-ヶー]{2,10})(?:の天気|の気温|って寒|って暑|は晴れ|は雨|は雪)/
  );
  if (match?.[1]) {
    const candidate = match[1].replace(/^(今日|明日|昨日|今|さっき|そこ|あそこ|ここ)の?/, '');
    if (candidate.length >= 2) return candidate;
  }
  return null;
}

function getYesterdayTokyoDateStr(): string {
  const now = new Date();
  const tokyoNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  tokyoNow.setDate(tokyoNow.getDate() - 1);
  const y = tokyoNow.getFullYear();
  const m = String(tokyoNow.getMonth() + 1).padStart(2, '0');
  const d = String(tokyoNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLatestUserLine(historyText: string): string {
  const lines = historyText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes("Participant（修行中）") && !line.includes("(AI)")) {
      return line;
    }
  }
  return lines[lines.length - 1] ?? "";
}

function isYesterdayQuery(text: string): boolean {
  return /(昨日|きのう|前日|1日前|yesterday)/i.test(text);
}

async function fetchWeatherSummary(historyText: string): Promise<string | null> {
  if (!/(天気|気温|晴れ|雨|雪|寒|暑|予報|傘)/.test(historyText)) {
    return null;
  }
  const latestLine = getLatestUserLine(historyText);
  const place = extractPlaceFromText(historyText, latestLine) || '札幌';
  const wantsYesterday = isYesterdayQuery(latestLine) || isYesterdayQuery(historyText);

  try {
    const placeQueryMap: Record<string, string> = {
      "札幌": "Sapporo",
      "富良野": "Furano",
      "旭川": "Asahikawa",
      "函館": "Hakodate",
      "小樽": "Otaru",
      "帯広": "Obihiro",
      "釧路": "Kushiro",
      "北見": "Kitami",
      "網走": "Abashiri",
      "稚内": "Wakkanai",
      "室蘭": "Muroran",
      "苫小牧": "Tomakomai",
      "ニセコ": "Niseko",
      "東京": "Tokyo",
      "大阪": "Osaka",
      "名古屋": "Nagoya",
      "福岡": "Fukuoka",
      "仙台": "Sendai",
      "那覇": "Naha",
    };

    const candidates = Array.from(
      new Set([place, placeQueryMap[place]].filter((v): v is string => Boolean(v && v.trim())))
    );

    let first: { name?: string; latitude?: number; longitude?: number } | undefined;
    for (const q of candidates) {
      const urls = [
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ja&format=json`,
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&format=json`,
      ];
      for (const u of urls) {
        const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          results?: Array<{ name?: string; latitude?: number; longitude?: number }>;
        };
        if (json.results && json.results.length > 0) {
          first = json.results[0];
          break;
        }
      }
      if (first) break;
    }
    if (!first) {
    }
    if (
      !first ||
      typeof first.latitude !== 'number' ||
      typeof first.longitude !== 'number'
    ) {
      return null;
    }

    const resolvedName = first.name || place;

    if (wantsYesterday) {
      const yesterdayStr = getYesterdayTokyoDateStr();
      const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${first.latitude}&longitude=${first.longitude}&start_date=${yesterdayStr}&end_date=${yesterdayStr}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo`;
      const archiveRes = await fetch(archiveUrl, { signal: AbortSignal.timeout(4000) });
      if (!archiveRes.ok) { console.warn("Archive API non-200:", archiveRes.status, await archiveRes.text().catch(() => "")); return null; }
      const archiveJson = (await archiveRes.json()) as {
        daily?: {
          weather_code?: number[];
          temperature_2m_max?: number[];
          temperature_2m_min?: number[];
        };
      };
      const code = archiveJson.daily?.weather_code?.[0];
      const maxTemp = archiveJson.daily?.temperature_2m_max?.[0];
      const minTemp = archiveJson.daily?.temperature_2m_min?.[0];
      if (code === undefined && typeof maxTemp !== 'number' && typeof minTemp !== 'number') {
        return null;
      }
      const parts = [`場所: ${resolvedName}`, `日付: ${yesterdayStr}（昨日）`];
      if (code !== undefined) {
        parts.push(`天気: ${weatherCodeToLabel(code)}`);
      }
      if (typeof maxTemp === 'number' && typeof minTemp === 'number') {
        parts.push(`気温: 最高 ${maxTemp}℃ / 最低 ${minTemp}℃`);
      }
      return parts.join(' / ');
    }

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${first.latitude}&longitude=${first.longitude}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&forecast_days=1`;
    const weatherRes = await fetch(forecastUrl, { signal: AbortSignal.timeout(4000) });
    if (!weatherRes.ok) return null;
    const weatherJson = (await weatherRes.json()) as {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
      };
      daily?: {
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
      };
    };

    const currentTemp = weatherJson.current?.temperature_2m;
    const currentLabel = weatherCodeToLabel(weatherJson.current?.weather_code);
    const maxTemp = weatherJson.daily?.temperature_2m_max?.[0];
    const minTemp = weatherJson.daily?.temperature_2m_min?.[0];
    const dailyLabel = weatherCodeToLabel(weatherJson.daily?.weather_code?.[0]);

    const parts = [`場所: ${resolvedName}`];
    if (typeof currentTemp === 'number') {
      parts.push(`現在の天気: ${currentLabel}（${currentTemp}℃）`);
    } else {
      parts.push(`現在の天気: ${currentLabel}`);
    }
    if (typeof maxTemp === 'number' && typeof minTemp === 'number') {
      parts.push(`今日の予報: ${dailyLabel}（最高 ${maxTemp}℃ / 最低 ${minTemp}℃）`);
    }
    return parts.join(' / ');
  } catch (err) {
    console.warn('Weather API fetch skipped:', err);
    return null;
  }
}

const GATEKEEPER_PROMPT = [
  'あなたはグループチャット「Participant」の判定器（Gatekeeper）です。',
  '直近の会話履歴を見て、AIピア「Participant（修行中）」が今ここで発言すべきか、黙るべきかを判定してください。',
  '出力は必ず YES または NO の1単語のみにしてください。',
].join('\n');

const SYSTEM_PROMPT = [
  'あなたはグループチャット「Participant」に参加するAIピア「Participant（修行中）」です。',
  '人間同士の会話の流れを読みつつ、天気の話題ばかりに偏らず、雑談・日常・エンタメ・時事などの別視点や軽い話題振りも交えて自然に返答してください。',
  '直前の話題に引っ張られすぎず、会話が盛り上がったり別のテーマに広がったりするようなひと言を心がけてください。',
  '参考天気情報がある場合は必要なときだけ自然に活かし、不確実な最新情報や過去日の事実については推測や捏造をせず素直に伝えてください。',
  '出しゃばりすぎず、会話が不要な場面や自然に黙るべき場面では何も出力しない（空文字を返す）ことも選択してください。',
].join('\n');

export async function POST(req: Request) {
  try {
    let body: {
      roomId?: unknown;
      senderName?: unknown;
      aiMode?: unknown;
      apiKey?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
    const senderName =
      typeof body.senderName === 'string' && body.senderName.trim()
        ? body.senderName.trim()
        : 'Participant';
    const aiMode = normalizeAiMode(body.aiMode);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

    if (!roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
    }

    if (aiMode === 'byok' && !apiKey) {
      return NextResponse.json(
        { error: 'BYOK mode requires an apiKey', code: 'MISSING_API_KEY' },
        { status: 400 }
      );
    }

    if (aiMode !== 'byok' && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
      return NextResponse.json(
        {
          error: 'サーバー側の GOOGLE_GENERATIVE_AI_API_KEY が設定されていません。',
          code: 'MISSING_SERVER_API_KEY',
        },
        { status: 500 }
      );
    }

    const { data: roomRow, error: roomError } = await supabase
      .from('rooms')
      .select('id')
      .eq('id', roomId)
      .maybeSingle();

    if (roomError) {
      return NextResponse.json({ error: roomError.message }, { status: 500 });
    }

    if (!roomRow) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    let usedAiCount = 0;
    if (aiMode !== 'byok') {
      const { count, error: countError } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', roomId)
        .eq('sender_type', 'ai');

      if (countError) {
        return NextResponse.json({ error: countError.message }, { status: 500 });
      }

      usedAiCount = count ?? 0;
      if (usedAiCount >= ROOM_AI_LIMIT) {
        return NextResponse.json(
          {
            error: `このルームのAI応答上限（${ROOM_AI_LIMIT}回）に達しました。BYOKモードを使うと続けて利用できます。`,
            code: 'ROOM_AI_LIMIT_REACHED',
            aiUsage: {
              used: usedAiCount,
              limit: ROOM_AI_LIMIT,
              remaining: 0,
              unlimited: false,
            },
          },
          { status: 429 }
        );
      }
    }

    const { data: recentMessages, error: fetchError } = await supabase
      .from('messages')
      .select('content, sender_name, sender_type, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(15);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!recentMessages || recentMessages.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'empty_history' });
    }

    const distinctHumanNames = new Set<string>();
    for (const m of recentMessages) {
      if (m.sender_type === 'human' && m.sender_name?.trim()) {
        distinctHumanNames.add(m.sender_name.trim());
      }
    }

    if (distinctHumanNames.size < 2) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'not_group_chat' });
    }

    const provider = createProvider(aiMode, apiKey);
    const modelId = resolveModelId(aiMode);
    const model = provider(modelId);

    const orderedMessages = [...recentMessages].reverse();
    const historyText = orderedMessages
      .map((m) => `${m.sender_name || m.sender_type}: ${m.content}`)
      .join('\n');

    const gateRes = await generateText({
      model,
      maxRetries: 1,
      system: GATEKEEPER_PROMPT,
      prompt: `直近の会話:\n${historyText}\n\n発言すべきなら YES、黙るべきなら NO を返してください。`,
    });
    const decision = gateRes.text.trim().toUpperCase();
    const shouldSpeak = decision.startsWith('YES');

    if (!shouldSpeak) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'gatekeeper_no' });
    }

    const weatherSummary = await fetchWeatherSummary(historyText);

    const weatherContextBlock = weatherSummary
      ? `\n\n【重要・事実データ（Open-Meteo）】\n${weatherSummary}\n上記の【重要・事実データ】がある場合は、それを事実として使って自然に答えてください。「分からない」「過去のデータは出せない」とは言わないでください。質問された地名とデータの地名が異なる場合は、取得できたデータの地名・日付を明示したうえで伝えてください。`
      : '';

    const res = await generateText({
      model,
      maxRetries: 1,
      system: SYSTEM_PROMPT,
      prompt: `これまでの会話:\n${historyText}${weatherContextBlock}\n\nこの流れを踏まえて、必要であれば短く自然にひと言返答してください。黙るべきなら空文字にしてください。`,
    });

    const replyContent = res.text.trim();
    if (!replyContent) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'empty_response' });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('messages')
      .insert({
        room_id: roomId,
        content: replyContent,
        sender_name: senderName,
        sender_type: 'ai',
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const nextUsed = aiMode === 'byok' ? usedAiCount : usedAiCount + 1;
    const aiUsage =
      aiMode === 'byok'
        ? { used: nextUsed, limit: null, remaining: null, unlimited: true }
        : {
            used: nextUsed,
            limit: ROOM_AI_LIMIT,
            remaining: Math.max(0, ROOM_AI_LIMIT - nextUsed),
            unlimited: false,
          };

    return NextResponse.json({ message: inserted, aiUsage });
  } catch (err) {
    console.error('AI peer error:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (isQuotaError(err)) {
      return NextResponse.json(
        { error: 'Gemini API quota exceeded', code: 'QUOTA_EXCEEDED', detail: message },
        { status: 429 }
      );
    }
    if (isOverloadedError(err)) {
      return NextResponse.json(
        { error: 'Gemini API is temporarily overloaded', code: 'MODEL_OVERLOADED', detail: message },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message, detail: String(err) }, { status: 500 });
  }
}
