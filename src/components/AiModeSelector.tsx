"use client";

import React, { useState } from "react";
import { AI_MODE_OPTIONS, AiMode } from "@/types/ai-selection";

interface AiModeSelectorProps {
  aiMode: AiMode;
  apiKey: string;
  onChangeMode: (mode: AiMode) => void;
  onChangeApiKey: (key: string) => void;
}

export function AiModeSelector({
  aiMode,
  apiKey,
  onChangeMode,
  onChangeApiKey,
}: AiModeSelectorProps) {
  const [showKey, setShowKey] = useState(false);

  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <legend className="px-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
        Participant に使用する AI を選択
      </legend>

      <div className="space-y-2">
        {AI_MODE_OPTIONS.map((option) => {
          const checked = aiMode === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${
                checked
                  ? "border-blue-600 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-950/50"
                  : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:bg-slate-800"
              }`}
            >
              <input
                type="radio"
                name="aiMode"
                value={option.value}
                checked={checked}
                onChange={() => onChangeMode(option.value)}
                className="mt-1 accent-blue-600"
              />
              <div className="text-sm">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {option.label}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {option.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {aiMode === "byok" && (
        <div className="mt-3 space-y-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
              自分の Gemini API キーを用意する
            </span>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-blue-600 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-400 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-slate-950"
            >
              Google AI Studio で取得 ↗
            </a>
          </div>

          <ol className="list-decimal space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-300">
            <li>上のボタンから Google AI Studio を開き、Google アカウントでログイン</li>
            <li>「API キーを作成」から新しいキーを発行してコピー</li>
            <li>下の欄に貼り付け（前後の空白は自動で整えられます）</li>
          </ol>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="byok-api-key"
                className="block text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                API キー
              </label>
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                className="text-xs text-slate-600 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              >
                {showKey ? "隠す" : "表示する"}
              </button>
            </div>
            <input
              id="byok-api-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => onChangeApiKey(e.target.value)}
              onBlur={(e) => {
                const trimmed = e.target.value.trim();
                if (trimmed !== e.target.value) {
                  onChangeApiKey(trimmed);
                }
              }}
              placeholder="発行した Gemini API キーを貼り付け"
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </div>
      )}
    </fieldset>
  );
}
