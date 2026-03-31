import { ChevronLeft, ChevronRight, MessageSquare, Plus, Settings } from 'lucide-react';
import { useState } from 'react';

import type { ConversationSummary } from '../../shared/contracts';

type SidebarProps = {
  conversations: ConversationSummary[];
  selectedConversationId: string | null;
  collapsed: boolean;
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
  onToggleCollapsed: () => void;
};

export function Sidebar({
  conversations,
  selectedConversationId,
  collapsed,
  onSelect,
  onCreate,
  onOpenSettings,
  onToggleCollapsed,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <aside
      className={`flex flex-col border-r border-white/8 bg-[#0a0c10] transition-all duration-200 ${
        collapsed ? 'w-[60px]' : 'w-[260px]'
      }`}
    >
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-4">
        {!collapsed && (
          <h1 className="text-base font-semibold text-white">CheapChat</h1>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-white"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className="px-2 py-3">
        <button
          type="button"
          onClick={onCreate}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!collapsed && <span>New chat</span>}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <div className="space-y-0.5">
          {conversations.map((conv) => {
            const isActive = conv.id === selectedConversationId;
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition ${
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                } ${collapsed ? 'justify-center' : ''}`}
              >
                <MessageSquare className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-600'}`} />
                {!collapsed && (
                  <div className="min-w-0">
                    <p className="truncate text-sm">{conv.title}</p>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-white/8 px-2 py-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  );
}
