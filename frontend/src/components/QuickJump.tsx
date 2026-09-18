import { useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { useCachedData } from '../hooks/useCachedData';
import { useOperatorConfig } from '../contexts/OperatorConfigContext';
import { useViewingAs } from '../contexts/ViewingAsContext';
import { agentSlug } from '../hooks/sessionSlug';
import { fuzzyScore } from '../lib/fuzzyMatch';
import { listSupervisorAgents } from '../supervisor/agentReads';
import { listSupervisorBeads } from '../supervisor/beadReads';
import { listSupervisorMail } from '../supervisor/mailReads';

interface QuickJumpProps {
  open: boolean;
  onClose: () => void;
}

// #117 client-side slice: fuzzy-jump over data the dashboard already knows how
// to load (beads / agents / mail), not a new backend search index. See the
// issue for the maintainer's open question on backend full-text search.
export function QuickJump({ open, onClose }: QuickJumpProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Jump to…"
      caption="Beads, agents, mail"
      widthClass="max-w-xl"
    >
      {/* Mounted only while `open` (Modal renders null otherwise), so the
          fetches below fire on open, not on every page load. */}
      <QuickJumpBody onClose={onClose} />
    </Modal>
  );
}

interface QuickJumpEntry {
  key: string;
  kind: 'bead' | 'agent' | 'mail';
  label: string;
  detail: string;
  to: string;
}

const MAX_RESULTS = 20;

function QuickJumpBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const operator = useOperatorConfig();
  const { viewingAs } = useViewingAs();

  const beads = useCachedData('quickjump:beads', () =>
    listSupervisorBeads({ includeClosed: false }),
  );
  const agents = useCachedData('quickjump:agents', listSupervisorAgents);
  const mail = useCachedData(`quickjump:mail:${viewingAs.alias}:${operator.operatorWireAlias}`, () =>
    listSupervisorMail('inbox', viewingAs.alias, operator),
  );
  const failedSources = [
    beads.error ? 'beads' : null,
    agents.error ? 'agents' : null,
    mail.error ? 'mail' : null,
  ].filter((s): s is string => s !== null);

  const entries = useMemo<QuickJumpEntry[]>(() => {
    const beadEntries: QuickJumpEntry[] = (beads.data?.items ?? []).map((b) => ({
      key: `bead:${b.id}`,
      kind: 'bead',
      label: b.title,
      detail: `${b.issue_type} · ${b.status}`,
      to: `/beads?bead=${encodeURIComponent(b.id)}`,
    }));
    const agentEntries: QuickJumpEntry[] = (agents.data?.items ?? []).map((a) => ({
      key: `agent:${agentSlug(a)}`,
      kind: 'agent',
      label: a.display_name ?? a.name,
      detail: a.state,
      to: `/agents/${encodeURIComponent(agentSlug(a))}`,
    }));
    const mailEntries: QuickJumpEntry[] = (mail.data?.items ?? []).map((m) => ({
      key: `mail:${m.id}`,
      kind: 'mail',
      label: m.subject || '(no subject)',
      detail: `from ${m.from}`,
      to: `/mail?message=${encodeURIComponent(m.id)}`,
    }));
    return [...beadEntries, ...agentEntries, ...mailEntries];
  }, [beads.data, agents.data, mail.data]);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(() => {
    const q = query.trim();
    if (q.length === 0) return [];
    return entries
      .map((entry) => {
        const labelScore = fuzzyScore(q, entry.label);
        const detailScore = fuzzyScore(q, entry.detail);
        const best =
          labelScore !== null && detailScore !== null
            ? Math.max(labelScore, detailScore)
            : (labelScore ?? detailScore);
        return best === null ? null : { entry, score: best };
      })
      .filter((r): r is { entry: QuickJumpEntry; score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.entry);
  }, [entries, query]);

  const activeIndexClamped = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);

  const go = (entry: QuickJumpEntry) => {
    navigate(entry.to);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (Math.max(i, 0) + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (Math.max(i, 0) - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = results[activeIndexClamped];
      if (entry) go(entry);
    }
  };

  const listboxId = 'quickjump-listbox';
  const activeOptionId =
    activeIndexClamped >= 0 ? `quickjump-option-${activeIndexClamped}` : undefined;

  return (
    <div>
      <input
        type="text"
        autoFocus
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        aria-label="Jump to a bead, agent, or mail message"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search beads, agents, mail…"
        className="w-full bg-transparent border-0 border-b border-rule pb-2 text-body text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none transition-colors"
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Quick jump results"
        className="mt-3 space-y-0.5 max-h-80 overflow-auto"
      >
        {results.map((entry, i) => (
          <li
            id={`quickjump-option-${i}`}
            key={entry.key}
            role="option"
            aria-selected={i === activeIndexClamped}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => go(entry)}
            className={`flex items-baseline justify-between gap-3 px-2 py-1.5 rounded-sm cursor-pointer text-body text-fg ${
              i === activeIndexClamped ? 'bg-surface-tint' : 'hover:bg-surface-tint'
            }`}
          >
            <span className="truncate">{entry.label}</span>
            <span className="text-label uppercase tracking-wider text-fg-faint shrink-0">
              {entry.kind} · {entry.detail}
            </span>
          </li>
        ))}
        {query.trim().length > 0 && results.length === 0 && (
          <li className="text-body text-fg-muted px-2 py-1.5">No matches</li>
        )}
      </ul>
      {query.trim().length === 0 && (
        <p className="mt-3 text-label uppercase tracking-wider text-fg-faint px-2">
          Type to search open beads, agents, and inbox mail
        </p>
      )}
      {failedSources.length > 0 && (
        <p className="mt-3 text-label text-fg-muted px-2">
          Couldn't load {failedSources.join(', ')} — results may be incomplete.
        </p>
      )}
    </div>
  );
}
