import { ChevronLeft, ChevronRight, Plus, Settings } from 'lucide-react';

import { SidebarConversationRow } from './SidebarConversationRow';
import type { SidebarConversationItem } from './sidebarViewModel';

type SidebarProps = {
  items: SidebarConversationItem[];
  selectedConversationId: string | null;
  collapsed: boolean;
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
  onToggleCollapsed: () => void;
};

export function Sidebar({
  items,
  selectedConversationId,
  collapsed,
  onSelect,
  onCreate,
  onOpenSettings,
  onToggleCollapsed,
}: SidebarProps) {
  return (
    <aside
      className={`relative flex flex-col border-r border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0)_16%),linear-gradient(180deg,#0d1015,#090b0f)] transition-all ${
        collapsed ? 'w-[68px]' : 'w-[284px]'
      }`}
      style={{ transitionDuration: 'var(--duration-normal)' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_34%)]" />

      {/* macOS title bar area - traffic lights + centered app name */}
      <div 
        className="relative flex h-[52px] items-center border-b border-white/6"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Spacer for traffic lights */}
        <div className="w-[78px] shrink-0" />
        
        {/* Centered app name */}
        {!collapsed && (
          <div className="flex flex-1 items-center justify-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#7c8cff]" />
            <h1 className="text-sm font-semibold tracking-[0.01em] text-white/96">Atlas</h1>
          </div>
        )}
        
        {/* Collapse button */}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="mr-2 rounded-lg p-1.5 text-text-muted transition hover:bg-white/6 hover:text-text-primary"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className="relative px-3 py-3">
        <button
          type="button"
          onClick={onCreate}
          className={`flex w-full items-center gap-2 rounded-xl border border-white/7 bg-white/[0.035] px-3 py-2.5 text-sm font-medium text-white/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:bg-white/[0.055] hover:text-white ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!collapsed && <span>New chat</span>}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {!collapsed && (
          <div className="px-2 pb-2 pt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/32">
            Conversations
          </div>
        )}

        <div className="space-y-1">
          {items.map((item) => {
            const isActive = item.id === selectedConversationId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`flex w-full items-center ${collapsed ? 'justify-center gap-0 px-0 py-2.5' : item.isRunning ? 'gap-2.5 px-3 py-2' : 'gap-0 px-3 py-1.5'} rounded-xl text-left transition ${
                  isActive
                    ? 'border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.045))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'border border-transparent text-text-tertiary hover:bg-white/[0.04] hover:text-text-secondary'
                }`}
              >
                <SidebarConversationRow
                  isActive={isActive}
                  isCollapsed={collapsed}
                  isRunning={item.isRunning}
                  primaryLabel={item.primaryLabel}
                  secondaryLabel={item.secondaryLabel}
                  timestampLabel={item.timestampLabel}
                  status={item.status}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-white/6 px-3 py-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-text-tertiary transition hover:bg-white/[0.04] hover:text-text-primary ${
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
