import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/utils";
import { queryInstalledFontFamilies } from "../../lib/appearanceFonts";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const CURATED_SANS_FAMILIES = [
  "Instrument Sans",
  "Inter",
  "Geist",
  "SF Pro",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
];

const CURATED_MONO_FAMILIES = [
  "Geist Mono",
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Menlo",
  "Consolas",
  "Cascadia Code",
  "Courier New",
];

export function FontFamilyPicker({
  value,
  defaultValue = "",
  placeholder = "Default",
  requireMonospace = false,
  onSelect,
}: {
  value: string;
  defaultValue?: string;
  placeholder?: string;
  requireMonospace?: boolean;
  onSelect: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    queryInstalledFontFamilies().then((res) => {
      if (!cancelled && res.status === "granted") {
        setInstalledFonts([...res.families]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const curated = requireMonospace ? CURATED_MONO_FAMILIES : CURATED_SANS_FAMILIES;

  const allFamilies = useMemo(() => {
    const set = new Set<string>();
    // Curated always first
    for (const f of curated) set.add(f);
    for (const f of installedFonts) set.add(f);
    return Array.from(set);
  }, [curated, installedFonts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allFamilies;
    return allFamilies.filter((f) => f.toLowerCase().includes(q));
  }, [allFamilies, query]);

  const displayLabel = value.trim() ? value : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-44 items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs text-[var(--text-primary)] shadow-xs transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
        >
          <span className="truncate font-normal" style={value.trim() ? { fontFamily: value } : undefined}>
            {displayLabel}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {/* Search header */}
        <div className="relative mb-1 flex items-center border-b border-[var(--border-subtle)] pb-1 px-1">
          <Search className="size-3.5 text-[var(--text-muted)] shrink-0 mr-1.5" />
          <input
            type="text"
            placeholder="Search fonts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
        </div>

        {/* Font List */}
        <div className="max-h-60 overflow-y-auto space-y-0.5">
          {/* Default Option */}
          <button
            type="button"
            onClick={() => {
              onSelect("");
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
              !value.trim()
                ? "bg-[var(--bg-active)] font-semibold text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            )}
          >
            <span>{placeholder}</span>
            {!value.trim() && <Check className="size-3.5 text-[var(--accent)]" />}
          </button>

          {/* Filtered items */}
          {filtered.map((family) => {
            const isSelected = value.toLowerCase() === family.toLowerCase();
            return (
              <button
                key={family}
                type="button"
                onClick={() => {
                  onSelect(family);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  isSelected
                    ? "bg-[var(--bg-active)] font-semibold text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                )}
              >
                <span className="truncate" style={{ fontFamily: family }}>
                  {family}
                </span>
                {isSelected && <Check className="size-3.5 text-[var(--accent)]" />}
              </button>
            );
          })}

          {filtered.length === 0 && query.trim() && (
            <button
              type="button"
              onClick={() => {
                onSelect(query.trim());
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-[var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              <span>Use &ldquo;{query.trim()}&rdquo;</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
