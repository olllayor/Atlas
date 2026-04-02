import { Pencil2Icon } from '@radix-ui/react-icons';
import { Check, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import type { AppUpdateSnapshot, ConversationStats, SettingsSection, SettingsSummary } from '../../shared/contracts';
import { SidebarConversationRow } from './SidebarConversationRow';
import { SidebarSettingsMenu } from './SidebarSettingsMenu';
import type { SidebarConversationItem } from './sidebarViewModel';

type SidebarProps = {
  items: SidebarConversationItem[];
  selectedConversationId: string | null;
  collapsed: boolean;
  settings: SettingsSummary | null;
  updateState: AppUpdateSnapshot;
  isRefreshingModels: boolean;
  conversationStats: ConversationStats | null;
  loadedMessageCount: number;
  newChatShortcutLabel?: string | null;
  showNewChatShortcutHint: boolean;
  sidebarToggleShortcutLabel?: string | null;
  showSidebarToggleShortcutHint: boolean;
  settingsShortcutLabel?: string | null;
  showConversationJumpHints: boolean;
  conversationJumpLabelById: Map<string, string>;
  onSelect: (conversationId: string) => void;
  onCreate: () => void;
  onDelete: (conversationId: string) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onRefreshModels: () => void;
  onCheckForUpdates: () => void;
  onToggleCollapsed: () => void;
};

function SidebarToggleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.835 4c-.451.004-.82.012-1.137.038-.386.032-.659.085-.876.162l-.2.086c-.44.224-.807.564-1.063.982l-.103.184c-.126.247-.206.562-.248 1.076-.043.523-.043 1.19-.043 2.135v2.664c0 .944 0 1.612.043 2.135.042.515.122.829.248 1.076l.103.184c.256.418.624.758 1.063.982l.2.086c.217.077.49.13.876.162.316.026.685.034 1.136.038zm11.33 7.327c0 .922 0 1.654-.048 2.243-.043.522-.125.977-.305 1.395l-.082.177a4 4 0 0 1-1.473 1.593l-.276.155c-.465.237-.974.338-1.57.387-.59.048-1.322.048-2.244.048H7.833c-.922 0-1.654 0-2.243-.048-.522-.042-.977-.126-1.395-.305l-.176-.082a4 4 0 0 1-1.594-1.473l-.154-.275c-.238-.466-.34-.975-.388-1.572-.048-.589-.048-1.32-.048-2.243V8.663c0-.922 0-1.654.048-2.243.049-.597.15-1.106.388-1.571l.154-.276a4 4 0 0 1 1.594-1.472l.176-.083c.418-.18.873-.263 1.395-.305.589-.048 1.32-.048 2.243-.048h4.334c.922 0 1.654 0 2.243.048.597.049 1.106.15 1.571.388l.276.154a4 4 0 0 1 1.473 1.594l.082.176c.18.418.262.873.305 1.395.048.589.048 1.32.048 2.243zm-10 4.668h4.002c.944 0 1.612 0 2.135-.043.514-.042.829-.122 1.076-.248l.184-.103c.418-.256.758-.624.982-1.063l.086-.2c.077-.217.13-.49.162-.876.043-.523.043-1.19.043-2.135V8.663c0-.944 0-1.612-.043-2.135-.032-.386-.085-.659-.162-.876l-.086-.2a2.67 2.67 0 0 0-.982-1.063l-.184-.103c-.247-.126-.562-.206-1.076-.248-.523-.043-1.19-.043-2.135-.043H8.164L8.165 4z" />
    </svg>
  );
}

export function Sidebar({
  items,
  selectedConversationId,
  collapsed,
  settings,
  updateState,
  isRefreshingModels,
  conversationStats,
  loadedMessageCount,
  newChatShortcutLabel,
  showNewChatShortcutHint,
  sidebarToggleShortcutLabel,
  showSidebarToggleShortcutHint,
  settingsShortcutLabel,
  showConversationJumpHints,
  conversationJumpLabelById,
  onSelect,
  onCreate,
  onDelete,
  onOpenSettings,
  onRefreshModels,
  onCheckForUpdates,
  onToggleCollapsed,
}: SidebarProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  return (
    <aside
      className={`relative flex shrink-0 flex-col overflow-hidden ${
        collapsed
          ? '-mr-px w-[72px] bg-transparent'
          : 'border-r border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0)_16%),linear-gradient(180deg,#0d1015,#090b0f)]'
      } ${collapsed ? '' : 'w-[284px]'}`}
    >
      {!collapsed ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_34%)]" />
      ) : null}

      {/* macOS title bar area - traffic lights + centered app name */}
      <div
        className={`relative flex h-[52px] items-center ${
          collapsed ? 'justify-start gap-2 px-2.5' : 'border-b border-white/6'
        }`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {!collapsed ? <div className="w-[78px] shrink-0" /> : null}

        {/* Centered app name */}
        {!collapsed && (
          <div className="flex flex-1 items-center justify-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#7c8cff]" />
            <h1 className="text-sm font-semibold tracking-[0.01em] text-white/96">Atlas</h1>
          </div>
        )}

        {collapsed ? (
          <div className="grid grid-cols-2 gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="relative flex h-9 w-9 items-center justify-center">
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Show sidebar"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition hover:bg-white/6 hover:text-text-primary"
              >
                <SidebarToggleIcon />
              </button>
              {showSidebarToggleShortcutHint && sidebarToggleShortcutLabel ? (
                <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#141922]/92 px-1.5 py-1 font-mono text-[10px] leading-none text-white/62 shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-sm">
                  {sidebarToggleShortcutLabel}
                </span>
              ) : null}
            </div>

            <div className="relative flex h-9 w-9 items-center justify-center">
              <button
                type="button"
                onClick={onCreate}
                aria-label="New chat"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition hover:bg-white/6 hover:text-text-primary"
              >
                <Pencil2Icon className="h-4 w-4" />
              </button>
              {showNewChatShortcutHint && newChatShortcutLabel ? (
                <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#141922]/92 px-1.5 py-1 font-mono text-[10px] leading-none text-white/62 shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-sm">
                  {newChatShortcutLabel}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Hide sidebar"
            className="mr-2 rounded-lg p-1.5 text-text-muted transition hover:bg-white/6 hover:text-text-primary"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {showSidebarToggleShortcutHint && sidebarToggleShortcutLabel ? (
              <span className="inline-flex min-w-[30px] items-center justify-center rounded-md border border-white/10 bg-white/[0.07] px-1.5 py-1 font-mono text-[10px] leading-none text-white/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                {sidebarToggleShortcutLabel}
              </span>
            ) : (
              <SidebarToggleIcon />
            )}
          </button>
        )}
      </div>

      {!collapsed ? (
        <div className="relative px-3 py-3">
          <button
            type="button"
            onClick={onCreate}
            className="group relative flex w-full items-center gap-2 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2 text-[13px] font-medium text-white/72 transition hover:border-white/10 hover:bg-white/[0.045] hover:text-white"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/7 bg-white/[0.03] text-white/58 transition group-hover:border-white/10 group-hover:bg-white/[0.05] group-hover:text-white/74">
              <Pencil2Icon className="h-3.5 w-3.5" />
            </span>
            <span>New chat</span>
            {showNewChatShortcutHint && newChatShortcutLabel ? (
              <span className="absolute right-2 top-1/2 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-white/10 bg-white/[0.07] px-1.5 font-mono text-[10px] leading-none text-white/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                {newChatShortcutLabel}
              </span>
            ) : null}
          </button>
        </div>
      ) : null}

      {!collapsed ? (
        <div className="scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto px-3">
          <div className="px-2 pb-2 pt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/32">
            Conversations
          </div>

          <div className="space-y-1">
            {items.map((item) => {
              const isActive = item.id === selectedConversationId;
              const isDeletePending = pendingDeleteId === item.id;
              return (
                <div key={item.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDeleteId(null);
                      onSelect(item.id);
                    }}
                    className={`flex w-full items-center ${collapsed ? 'justify-center gap-0 px-0 py-2.5' : item.isRunning ? 'gap-2.5 px-3 py-2' : 'gap-0 px-3 py-1.5'} rounded-xl text-left transition ${
                      isActive
                        ? 'border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.045))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                        : 'border border-transparent text-text-tertiary hover:bg-white/[0.04] hover:text-text-secondary'
                    } ${!collapsed ? (isDeletePending ? 'pr-[92px]' : 'pr-8') : ''}`}
                  >
                    <SidebarConversationRow
                      isActive={isActive}
                      isCollapsed={collapsed}
                      isRunning={item.isRunning}
                      primaryLabel={item.primaryLabel}
                      secondaryLabel={item.secondaryLabel}
                      timestampLabel={item.timestampLabel}
                      jumpLabel={conversationJumpLabelById.get(item.id)}
                      showJumpHint={showConversationJumpHints && conversationJumpLabelById.has(item.id)}
                      status={item.status}
                      hideTimestamp={isDeletePending}
                    />
                  </button>

                  {!collapsed ? (
                    <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                      {isDeletePending ? (
                        <>
                          <button
                            type="button"
                            aria-label={`Confirm delete session ${item.primaryLabel}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDeleteId(null);
                              onDelete(item.id);
                            }}
                            className="flex h-6 items-center gap-1 rounded-md bg-rose-500/16 px-2 text-[10px] font-medium text-rose-200 transition hover:bg-rose-500/24 hover:text-rose-100"
                          >
                            <Check className="h-3 w-3" />
                            <span>Delete</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Cancel delete session ${item.primaryLabel}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDeleteId(null);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-white/34 transition hover:bg-white/[0.05] hover:text-white/72"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete session ${item.primaryLabel}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDeleteId(item.id);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-white/30 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-300 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {!collapsed ? (
        <div className="border-t border-white/6 px-3 py-3">
          <SidebarSettingsMenu
            collapsed={collapsed}
            settings={settings}
            updateState={updateState}
            isRefreshingModels={isRefreshingModels}
            conversationStats={conversationStats}
            loadedMessageCount={loadedMessageCount}
            settingsShortcutLabel={settingsShortcutLabel}
            onOpenSettings={onOpenSettings}
            onRefreshModels={onRefreshModels}
            onCheckForUpdates={onCheckForUpdates}
          />
        </div>
      ) : null}
    </aside>
  );
}
