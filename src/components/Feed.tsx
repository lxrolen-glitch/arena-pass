"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { LogEntry } from "@/lib/poker/game";
import type { ChatMessage } from "@/lib/protocol";

type Item = {
  id: string;
  at: number;
  kind: LogEntry["kind"];
  name?: string;
  text: string;
  system?: boolean;
};

const KIND_STYLES: Record<Item["kind"], string> = {
  system: "text-slate-400",
  action: "text-slate-200",
  result: "text-emerald-300 font-semibold",
  chat: "text-slate-100",
};

export function Feed({
  chat,
  log,
  onSend,
  canSend,
}: {
  chat: ChatMessage[];
  log: LogEntry[];
  onSend: (text: string) => void;
  canSend: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const merged: Item[] = [
      ...log.map((entry) => ({
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        name: entry.name,
        text: entry.text,
      })),
      ...chat.map((message) => ({
        id: message.id,
        at: message.at,
        kind: "chat" as const,
        name: message.name,
        text: message.text,
        system: message.system,
      })),
    ];
    return merged.sort((a, b) => a.at - b.at).slice(-80);
  }, [chat, log]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [items.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="panel flex h-full min-h-0 flex-col">
      <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-slate-200">
        Table feed
      </div>

      <div ref={listRef} className="scroll-thin flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-[13px]">
        {items.length === 0 && <p className="text-slate-500">Nothing yet. Say hello 👋</p>}
        {items.map((item) => (
          <p
            key={item.id}
            className={`leading-snug ${item.system ? "italic text-slate-500" : KIND_STYLES[item.kind]}`}
          >
            {item.kind === "chat" && !item.system ? (
              <>
                <span className="font-semibold text-gold-400">{item.name}: </span>
                {item.text}
              </>
            ) : item.name ? (
              <>
                <span className="font-semibold text-slate-300">{item.name} </span>
                {item.text}
              </>
            ) : (
              item.text
            )}
          </p>
        ))}
      </div>

      <form onSubmit={submit} className="flex gap-2 border-t border-white/10 p-3">
        <input
          className="field"
          placeholder={canSend ? "Say something…" : "Sit down to chat"}
          value={draft}
          maxLength={240}
          disabled={!canSend}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn-ghost !px-3" disabled={!canSend || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
