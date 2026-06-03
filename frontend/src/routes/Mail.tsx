import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { useCachedData } from '../hooks/useCachedData';
import { useAttentionModel } from '../attention/context';
import {
  attentionRowProps,
  resourceAttentionSeverity,
} from '../attention/routeHighlight';
import { Button } from '../components/Button';
import { FilterChips } from '../components/FilterChips';
import { GroupedTable } from '../components/GroupedTable';
import { ListSearchBar } from '../components/ListSearchBar';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { type TableColumn } from '../components/Table';
import { AgentPanel } from '../components/AgentPanel';
import { ComposeModal } from '../components/mail/ComposeModal';
import { ThreadMessage } from '../components/mail/ThreadMessage';
import { Field } from '../components/Field';
import { useNow } from '../contexts/NowContext';
import { useViewingAs, OPERATOR_ALIAS } from '../contexts/ViewingAsContext';
import { displayLabel } from '../hooks/aliasPriority';
import { useListFilters, type FilterChip } from '../hooks/useListFilters';
import { mailProject } from '../hooks/projectOf';
import { formatRelative } from '../hooks/time';
import {
  DEFAULT_MAIL_HISTORY_LIMIT,
  fetchSupervisorMailThread,
  listSupervisorMail,
  MAIL_HISTORY_LIMITS,
  type MailHistoryLimit,
  type SupervisorMailItem,
} from '../supervisor/mailReads';
import {
  archiveSupervisorMail,
  markSupervisorMailRead,
  markSupervisorMailUnread,
  replySupervisorMail,
} from '../supervisor/mailWrites';

// Mail chips operate on read-state. "Sent" box has no unread concept;
// the chips still render but their match predicates are box-aware.
const MAIL_CHIPS: ReadonlyArray<FilterChip<SupervisorMailItem>> = [
  { id: 'unread', label: 'unread', match: (m) => !m.read },
  { id: 'read', label: 'read', match: (m) => m.read },
];

const MAIL_SEARCH_FIELDS = (m: SupervisorMailItem): ReadonlyArray<string | undefined> => [
  m.from,
  m.to,
  m.subject,
  m.rig,
  // First body line only — out-of-scope per bead description to search
  // full bodies; matching the preview keeps parity with what the table
  // already renders.
  m.body.split('\n')[0],
];

type MailBox = 'inbox' | 'sent' | 'all';
type MailAction = 'archive' | 'read' | 'reply' | 'unread';
const DEEP_LINK_MAIL_HISTORY_LIMIT: MailHistoryLimit = 1000;

export function MailPage() {
  const attention = useAttentionModel();
  const [searchParams] = useSearchParams();
  const selectedMessageParam = normalizeSelectedMessageParam(searchParams.get('message'));
  const {
    viewingAs,
    setAlias,
    resetToOperator,
    aliasBuckets,
    aliasesLoading,
    sessionsUnavailable,
    loadAliases,
  } = useViewingAs();
  const [box, setBox] = useState<MailBox>(() => selectedMessageParam === null ? 'inbox' : 'all');
  const [historyLimit, setHistoryLimit] = useState<MailHistoryLimit>(
    () => selectedMessageParam === null ? DEFAULT_MAIL_HISTORY_LIMIT : DEEP_LINK_MAIL_HISTORY_LIMIT,
  );

  // Lazy alias prefetch — Mail is the only consumer of the dropdown, so
  // non-Mail routes don't pay the cost (code-reviewer HIGH-1). Idempotent
  // on the context side, so re-entries are no-ops.
  useEffect(() => {
    loadAliases();
  }, [loadAliases]);
  const now = useNow();

  const { data: mailData, loading, error: mailError, refresh } = useCachedData(
    `mail:${box}:${viewingAs.alias}:${historyLimit}`,
    () => listSupervisorMail(box, viewingAs.alias, historyLimit),
  );
  const items = useMemo(() => mailData?.items ?? [], [mailData]);
  const [error, setError] = useState<string | null>(null);
  // Surface fetch errors from the cached hook through the same state
  // local handlers use, so the existing error banner keeps working.
  useEffect(() => {
    if (mailError) setError(mailError);
  }, [mailError]);

  const [threadFor, setThreadFor] = useState<SupervisorMailItem | null>(null);
  const [threadItems, setThreadItems] = useState<SupervisorMailItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const openedMessageParam = useRef<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [actionInFlight, setActionInFlight] = useState<MailAction | null>(null);

  const [composing, setComposing] = useState(false);

  const openThread = useCallback(
    async (mail: SupervisorMailItem) => {
      setThreadFor(mail);
      setThreadItems([]);
      setReplyBody('');
      setError(null);
      if (!mail.thread_id) return;
      setThreadLoading(true);
      try {
        const data = await fetchSupervisorMailThread(mail.thread_id, viewingAs.alias, historyLimit);
        setThreadItems(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'thread failed');
      } finally {
        setThreadLoading(false);
      }
    },
    [historyLimit, viewingAs.alias],
  );

  useEffect(() => {
    if (selectedMessageParam === null) {
      openedMessageParam.current = null;
      return;
    }
    if (openedMessageParam.current === selectedMessageParam) return;
    const selectedMessage = items.find((mail) => mail.id === selectedMessageParam);
    if (selectedMessage === undefined) return;
    openedMessageParam.current = selectedMessageParam;
    void openThread(selectedMessage);
  }, [items, openThread, selectedMessageParam]);

  const runMailAction = useCallback(
    async (action: MailAction) => {
      const message = threadFor;
      if (message === null) return;
      setActionInFlight(action);
      setError(null);
      try {
        if (action === 'read') {
          await markSupervisorMailRead(message);
          setThreadFor({ ...message, read: true });
        } else if (action === 'unread') {
          await markSupervisorMailUnread(message);
          setThreadFor({ ...message, read: false });
        } else if (action === 'archive') {
          await archiveSupervisorMail(message);
          setThreadFor(null);
          setThreadItems([]);
        } else {
          const body = replyBody.trim();
          if (body.length === 0) return;
          await replySupervisorMail(message, { body });
          setReplyBody('');
          if (message.thread_id) {
            const data = await fetchSupervisorMailThread(message.thread_id, viewingAs.alias, historyLimit);
            setThreadItems(data.items);
          }
        }
        await refresh();
      } catch (err) {
        setError(formatApiError(err, `${action} failed`));
      } finally {
        setActionInFlight(null);
      }
    },
    [historyLimit, refresh, replyBody, threadFor, viewingAs.alias],
  );

  const columns = useMemo<ReadonlyArray<TableColumn<SupervisorMailItem>>>(() => [
    {
      key: 'from',
      label: 'From',
      sortable: true,
      sortValue: (r) => r.from,
      render: (r) => <span className="text-fg-muted">{r.from}</span>,
      className: 'w-48',
    },
    {
      key: 'subject',
      label: 'Subject',
      sortable: true,
      sortValue: (r) => r.subject,
      render: (r) => (
        <div className="min-w-0">
          <p className={`truncate ${r.read ? 'text-fg-muted' : 'text-fg font-medium'}`}>
            {r.subject}
          </p>
          <p className="text-label uppercase tracking-wider text-fg-faint mt-1 truncate">
            {r.body.split('\n')[0] ?? ''}
          </p>
        </div>
      ),
    },
    {
      key: 'created_at',
      label: 'When',
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => (
        <span className="tnum text-fg-muted">{formatRelative(r.created_at, now)}</span>
      ),
      className: 'w-24',
      align: 'right',
    },
  ], [now]);

  const aliasLabel = useMemo(
    () => displayLabel(viewingAs.alias, OPERATOR_ALIAS),
    [viewingAs.alias],
  );

  const synopsis = useMemo(() => {
    const noun = box === 'all' ? 'all mail' : box === 'inbox' ? 'inbox' : 'sent';
    if (items.length === 0) return `${capitalize(noun)} empty for ${aliasLabel}.`;
    const unread = box === 'sent' ? 0 : items.filter((m) => !m.read).length;
    if (unread > 0) return `${items.length} in ${noun}, ${unread} unread.`;
    return `${items.length} in ${noun}.`;
  }, [box, items, aliasLabel]);

  // Mail view key includes box so collapsed-project state is independent
  // between inbox and sent (different mental models).
  const filters = useListFilters<SupervisorMailItem>({
    viewKey: `mail:${box}`,
    rows: items,
    projectOf: mailProject,
    searchOf: MAIL_SEARCH_FIELDS,
    chips: MAIL_CHIPS,
  });
  const rowProps = useMemo(
    () => (mail: SupervisorMailItem) =>
      attentionRowProps(resourceAttentionSeverity(attention, 'mail', mail.id)),
    [attention],
  );
  const mailSeverity = useCallback(
    (mail: SupervisorMailItem) => resourceAttentionSeverity(attention, 'mail', mail.id),
    [attention],
  );

  // Sent box has no unread concept; suppress those chips there.
  const visibleChips = box === 'sent' ? [] : MAIL_CHIPS;
  const replyDisabled =
    threadFor === null ||
    replyBody.trim().length === 0 ||
    actionInFlight !== null ||
    !viewingAs.isOperator;

  return (
    <section>
      <PageHeader
        title="Mail"
        synopsis={synopsis}
        meta={
          <>
            {error && (
              <span className="normal-case text-body text-accent" role="alert">
                {error}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => setComposing(true)}
              disabled={!viewingAs.isOperator}
              title={
                viewingAs.isOperator
                  ? 'Compose a new message (sends as the operator)'
                  : 'Switch back to the operator to compose'
              }
            >
              Compose
            </Button>
            <Button size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      <div className="flex gap-8 items-start">
        <AgentPanel
          buckets={aliasBuckets}
          loading={aliasesLoading}
          sessionsUnavailable={sessionsUnavailable}
          value={viewingAs.alias}
          onChange={setAlias}
          onReset={resetToOperator}
          isOperator={viewingAs.isOperator}
        />

        <div className="flex-1 min-w-0">
          <div className="mb-6">
            <BoxTabs box={box} onChange={setBox} />
          </div>

          <div className="mb-6 space-y-3">
            <ListSearchBar
              value={filters.search}
              onChange={filters.setSearch}
              placeholder="Search mail by sender, subject, rig"
              matchCount={filters.totalMatches}
              totalCount={items.length}
              ariaLabel="Search mail"
            />
            {visibleChips.length > 0 && (
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <FilterChips
                  chips={visibleChips}
                  activeIds={filters.activeChipIds}
                  onToggle={filters.toggleChip}
                  legend="Read state"
                />
                <HistoryLimitSelect
                  value={historyLimit}
                  onChange={setHistoryLimit}
                />
              </div>
            )}
            {visibleChips.length === 0 && (
              <div className="flex justify-end">
                <HistoryLimitSelect
                  value={historyLimit}
                  onChange={setHistoryLimit}
                />
              </div>
            )}
          </div>

          <GroupedTable
            groups={filters.groups}
            columns={columns}
            rowKey={(r) => r.id}
            onToggleProject={filters.toggleProject}
            onRowClick={(r) => void openThread(r)}
            rowProps={rowProps}
            emptyMessage={
              filters.search.length > 0 || filters.activeChipIds.size > 0
                ? 'No messages match the current search or filter.'
                : `${box === 'inbox' ? 'Inbox' : 'Sent'} empty for ${aliasLabel}.`
            }
            perProjectEmpty="No messages in this project."
            initialSort={{ key: 'created_at', dir: 'desc' }}
          />
        </div>
      </div>

      <Modal
        open={threadFor !== null}
        onClose={() => setThreadFor(null)}
        title={threadFor?.subject ?? 'Thread'}
        caption={`Reading as ${aliasLabel}, ${threadItems.length} message(s)`}
        widthClass="max-w-3xl"
        footer={
          threadFor === null ? null : (
            <>
              <Button
                tone="quiet"
                size="sm"
                disabled={actionInFlight !== null}
                onClick={() => void runMailAction(threadFor.read ? 'unread' : 'read')}
              >
                {threadFor.read ? 'Mark unread' : 'Mark read'}
              </Button>
              <Button
                tone="quiet"
                size="sm"
                disabled={actionInFlight !== null}
                onClick={() => void runMailAction('archive')}
              >
                {actionInFlight === 'archive' ? 'Archiving' : 'Archive'}
              </Button>
              <Button
                tone="accent"
                size="sm"
                disabled={replyDisabled}
                onClick={() => void runMailAction('reply')}
              >
                {actionInFlight === 'reply' ? 'Replying' : 'Reply'}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-6">
          {threadLoading ? (
            <p className="text-fg-muted italic">Loading thread.</p>
          ) : threadItems.length === 0 && threadFor ? (
            <ThreadMessage message={threadFor} attentionSeverity={mailSeverity(threadFor)} />
          ) : (
            <ol className="space-y-6">
              {threadItems.map((m) => (
                <li key={m.id}>
                  <ThreadMessage message={m} attentionSeverity={mailSeverity(m)} />
                </li>
              ))}
            </ol>
          )}
          {threadFor !== null && (
            <Field label="Reply" variant="form">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={5}
                maxLength={16 * 1024}
                disabled={!viewingAs.isOperator}
                className="w-full bg-surface-tint border border-rule rounded-sm px-3 py-2 text-body text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 resize-y disabled:opacity-50"
              />
            </Field>
          )}
        </div>
      </Modal>

      <ComposeModal
        open={composing}
        onClose={() => setComposing(false)}
        onSent={() => {
          setComposing(false);
          if (box === 'sent') void refresh();
        }}
      />
    </section>
  );
}

function BoxTabs({ box, onChange }: { box: MailBox; onChange: (b: MailBox) => void }) {
  return (
    <div className="flex items-baseline gap-6">
      {(['inbox', 'sent', 'all'] as MailBox[]).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onChange(b)}
          className={`text-title transition-colors duration-150 ease-out-quart focus-mark rounded-sm ${
            box === b
              ? 'text-fg font-semibold'
              : 'text-fg-muted hover:text-fg'
          }`}
        >
          {b === 'all' ? 'All' : capitalize(b)}
        </button>
      ))}
    </div>
  );
}

function HistoryLimitSelect({
  value,
  onChange,
}: {
  value: MailHistoryLimit;
  onChange: (value: MailHistoryLimit) => void;
}) {
  return (
    <label className="flex items-baseline gap-2 text-label uppercase tracking-wider text-fg-muted">
      <span>History</span>
      <select
        aria-label="Mail history limit"
        value={value}
        onChange={(e) => onChange(toMailHistoryLimit(e.target.value))}
        className="bg-transparent border border-rule rounded-sm px-2 py-1 text-label uppercase tracking-wider text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
      >
        {MAIL_HISTORY_LIMITS.map((limit) => (
          <option key={limit} value={limit}>
            Recent {limit}
          </option>
        ))}
      </select>
    </label>
  );
}

function toMailHistoryLimit(value: string): MailHistoryLimit {
  const parsed = Number(value);
  return MAIL_HISTORY_LIMITS.includes(parsed as MailHistoryLimit)
    ? parsed as MailHistoryLimit
    : DEFAULT_MAIL_HISTORY_LIMIT;
}

function normalizeSelectedMessageParam(value: string | null): string | null {
  const clean = value?.trim();
  return clean && clean.length > 0 ? clean : null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
