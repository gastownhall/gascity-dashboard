import type {
  ContributorStat,
  ContributorTier,
  TriageCluster,
  TriageItem,
  TriageItemStatus,
  TriageTier,
  TriageTierSection,
} from 'gas-city-dashboard-shared';
import { useAttentionModel } from '../../../attention/context';
import {
  attentionBlockProps,
  resourceAttentionSeverity,
} from '../../../attention/routeHighlight';
import { useNow } from '../../../contexts/NowContext';
import { formatRelative } from '../../../hooks/time';
import { CollapsibleHeader } from '../../../components/CollapsibleHeader';
import { selectionKey } from './selectionKey';
import { maintainerResourceId } from './attentionKeys';
import { RunLink, SlungLink, TriageScore } from './TriageSignals';

export type ToggleSelect =
  | ((item: { kind: 'pr' | 'issue'; number: number }) => void)
  | null;

export function TierSection({
  section,
  counts,
  unfilteredItemCount,
  collapsed,
  onToggle,
  isCollapsed,
  toggleCluster,
  selection,
  onToggleSelect,
}: {
  section: TriageTierSection;
  counts: { vetted: number; awaiting: number };
  /**
   * Total item count from the unfiltered tier (gascity-dashboard-3lf).
   * When a filter chip (needs-PR / awaiting-only) is active, the rendered
   * `section` only contains the surviving items, which would make a bare
   * "N items" label misread as the tier's true size. When this prop is
   * supplied AND differs from the post-filter count, the header reads
   * "N of M items" to disambiguate. Pass `undefined` (or equal to the
   * rendered count) to keep the plain label.
   */
  unfilteredItemCount?: number;
  collapsed: boolean;
  onToggle: () => void;
  isCollapsed: (id: string) => boolean;
  toggleCluster: (id: string) => void;
  selection: ReadonlySet<string>;
  onToggleSelect: ToggleSelect;
}) {
  const itemCount =
    section.clusters.reduce((n, c) => n + c.items.length, 0) +
    section.unclustered.length;
  const showFilteredOf =
    unfilteredItemCount !== undefined && unfilteredItemCount !== itemCount;

  return (
    <section>
      <header className="mb-6 pb-2 border-b border-rule">
        <CollapsibleHeader collapsed={collapsed} onToggle={onToggle}>
          {({ glyph }) => (
            <>
              <h2
                className={
                  section.tier === 'regression_breaking'
                    ? 'text-headline font-semibold uppercase tracking-wide text-fg text-left'
                    : 'text-headline font-semibold uppercase tracking-wide text-fg-muted text-left'
                }
              >
                <span className="mr-2">{glyph}</span>
                {tierLabel(section.tier)}
              </h2>
              <span className="flex items-baseline gap-3 text-label uppercase tracking-wider text-fg-muted tnum">
                <span title="vetted by a triage agent · awaiting an agent assessment">
                  <span>{counts.vetted}</span> vetted <span aria-hidden>·</span>{' '}
                  <span>{counts.awaiting}</span> awaiting
                </span>
                <span aria-hidden>·</span>
                <span>
                  {showFilteredOf
                    ? `${itemCount} of ${unfilteredItemCount} items`
                    : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
                </span>
              </span>
            </>
          )}
        </CollapsibleHeader>
      </header>

      {collapsed ? null : section.clusters.length === 0 && section.unclustered.length === 0 ? (
        <p className="text-body text-fg-faint italic">No items in this tier.</p>
      ) : (
        <div className="space-y-10">
          {section.clusters.map((cluster) => (
            <ClusterBlock
              key={cluster.cluster_id}
              cluster={cluster}
              collapsed={isCollapsed(`cluster:${cluster.cluster_id}`)}
              onToggle={() => toggleCluster(`cluster:${cluster.cluster_id}`)}
              selection={selection}
              onToggleSelect={onToggleSelect}
            />
          ))}

          {section.unclustered.length > 0 && (
            <div className="space-y-2">
              <div className="text-title font-medium text-fg-muted">
                {section.clusters.length > 0 ? 'Unclustered' : 'Awaiting cluster enrichment'}
              </div>
              <RowList
                items={section.unclustered}
                selection={selection}
                onToggleSelect={onToggleSelect}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ClusterBlock({
  cluster,
  collapsed,
  onToggle,
  selection,
  onToggleSelect,
}: {
  cluster: TriageCluster;
  collapsed: boolean;
  onToggle: () => void;
  selection: ReadonlySet<string>;
  onToggleSelect: ToggleSelect;
}) {
  const issues = cluster.items.filter((i) => i.kind === 'issue').length;
  const prs = cluster.items.filter((i) => i.kind === 'pr').length;
  const totals: string[] = [];
  if (issues > 0) totals.push(`${issues} ${issues === 1 ? 'issue' : 'issues'}`);
  if (prs > 0) totals.push(`${prs} ${prs === 1 ? 'PR' : 'PRs'}`);
  if (cluster.lines_pending > 0) totals.push(`${cluster.lines_pending} lines pending`);

  const isTopic = cluster.files.every((f) => f.startsWith('@topic/'));
  const headerLabel = isTopic
    ? cluster.files.map((f) => f.replace(/^@topic\//, '')).join(', ')
    : cluster.files.join(', ');

  return (
    <div className="space-y-2">
      <CollapsibleHeader
        collapsed={collapsed}
        onToggle={onToggle}
        className="w-full flex items-baseline justify-between gap-4 focus-mark text-left"
      >
        {({ glyph }) => (
          <>
            <div
              className={
                isTopic
                  ? 'text-label uppercase tracking-wider font-medium text-fg-muted min-w-0 truncate'
                  : 'text-title font-medium text-fg min-w-0 truncate'
              }
            >
              <span className="mr-2">{glyph}</span>
              {isTopic && (
                <span className="text-fg-faint mr-2" aria-hidden>·</span>
              )}
              {headerLabel}
            </div>
            <div className="text-body text-fg-muted tnum shrink-0">
              {totals.join(' · ')}
            </div>
          </>
        )}
      </CollapsibleHeader>
      {!collapsed && (
        <RowList
          items={cluster.items}
          selection={selection}
          onToggleSelect={onToggleSelect}
        />
      )}
    </div>
  );
}

// In-flight work section (gascity-dashboard-2yr). Items the operator slung
// to an agent that are not yet vetted, lifted out of the backlog tiers by the
// serve-time overlay into `MaintainerTriage.slung_section`.
export function SlungSection({
  items,
  collapsed,
  onToggle,
}: {
  items: TriageItem[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section>
      <header className="mb-6 pb-2 border-b border-rule">
        <CollapsibleHeader collapsed={collapsed} onToggle={onToggle}>
          {({ glyph }) => (
            <>
              <h2 className="text-headline font-semibold uppercase tracking-wide text-fg-muted text-left">
                <span className="mr-2">{glyph}</span>
                Slung <span aria-hidden>·</span> awaiting agent
              </h2>
              <span className="text-label uppercase tracking-wider text-fg-muted tnum">
                {items.length} {items.length === 1 ? 'item' : 'items'}
              </span>
            </>
          )}
        </CollapsibleHeader>
      </header>
      {collapsed ? null : (
        <RowList items={items} selection={new Set<string>()} onToggleSelect={null} />
      )}
    </section>
  );
}

function RowList({
  items,
  selection,
  onToggleSelect,
}: {
  items: TriageItem[];
  selection: ReadonlySet<string>;
  onToggleSelect: ToggleSelect;
}) {
  const issueNumbersInList = new Set<number>();
  for (const it of items) {
    if (it.kind === 'issue') issueNumbersInList.add(it.number);
  }

  const nestedPrNumbers = new Set<number>();
  const childrenOf = new Map<number, TriageItem[]>();
  for (const it of items) {
    if (it.kind !== 'pr') continue;
    for (const linked of it.linked_numbers) {
      if (issueNumbersInList.has(linked)) {
        nestedPrNumbers.add(it.number);
        const list = childrenOf.get(linked);
        if (list) list.push(it);
        else childrenOf.set(linked, [it]);
      }
    }
  }

  return (
    <div>
      {items.map((it) => {
        if (it.kind === 'pr' && nestedPrNumbers.has(it.number)) return null;
        const children = it.kind === 'issue' ? childrenOf.get(it.number) ?? [] : [];
        return (
          <div key={rowKey(it)}>
            {it.kind === 'issue' ? (
              <IssueRow
                item={it}
                hasInListChildren={children.length > 0}
                selection={selection}
                onToggleSelect={onToggleSelect}
              />
            ) : (
              <PrRow
                item={it}
                nested={false}
                selection={selection}
                onToggleSelect={onToggleSelect}
              />
            )}
            {children.map((child) => (
              <PrRow
                key={rowKey(child)}
                item={child}
                nested={true}
                selection={selection}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SelectCheckbox({
  item,
  selection,
  onToggleSelect,
}: {
  item: TriageItem;
  selection: ReadonlySet<string>;
  onToggleSelect: NonNullable<ToggleSelect>;
}) {
  const key = selectionKey({ kind: item.kind, number: item.number });
  const checked = selection.has(key);
  return (
    <input
      type="checkbox"
      className="h-3.5 w-3.5 translate-y-[2px] cursor-pointer accent-fg focus-mark"
      checked={checked}
      onChange={() => onToggleSelect({ kind: item.kind, number: item.number })}
      aria-label={`select ${item.kind} #${item.number} for bulk triage`}
    />
  );
}

const ROW_GRID_NO_SELECT = 'grid grid-cols-[1.75em_2.25em_1fr_auto] items-baseline gap-x-3';
const ROW_GRID_WITH_SELECT =
  'grid grid-cols-[1.25em_1.75em_2.25em_1fr_auto] items-baseline gap-x-3';

export function IssueRow({
  item,
  hasInListChildren,
  selection,
  onToggleSelect,
}: {
  item: TriageItem;
  hasInListChildren: boolean;
  selection: ReadonlySet<string>;
  onToggleSelect: ToggleSelect;
}) {
  const showAnchored = item.linked_numbers.length > 0 && !hasInListChildren;
  const showNeedsPr = item.has_in_flight_pr === false;
  const gridClass = onToggleSelect ? ROW_GRID_WITH_SELECT : ROW_GRID_NO_SELECT;
  const attention = useAttentionModel();
  const highlightProps = attentionBlockProps(
    resourceAttentionSeverity(attention, 'maintainer', maintainerResourceId(item)),
  );
  return (
    <div
      {...highlightProps}
      className={`${gridClass} py-1.5 ${highlightProps.className ?? ''}`}
    >
      {onToggleSelect && (
        <SelectCheckbox item={item} selection={selection} onToggleSelect={onToggleSelect} />
      )}
      <span aria-hidden className="text-accent text-[0.85em] leading-none translate-y-[1px]">
        {item.is_marked ? '●' : ''}
      </span>
      <PriorityBadge labels={item.labels} />
      <div className="min-w-0">
        <span className="text-body text-fg">{item.title}</span>
        {item.weak_ties.length > 0 && (
          <span className="ml-3 text-body text-fg-faint">
            also in: {item.weak_ties.map((t) => `${t.label} (${t.count})`).join(', ')}
          </span>
        )}
        {showAnchored && (
          <span className="ml-3 text-label uppercase tracking-wider text-fg-faint">
            anchored
          </span>
        )}
        {showNeedsPr && (
          <span
            className="ml-3 text-label uppercase tracking-wider text-fg-faint"
            title="no in-flight PR claims to fix this; an agent or contributor needs to write one"
          >
            needs PR
          </span>
        )}
      </div>
      <RowMeta item={item} />
    </div>
  );
}

function PrRow({
  item,
  nested,
  selection,
  onToggleSelect,
}: {
  item: TriageItem;
  nested: boolean;
  selection: ReadonlySet<string>;
  onToggleSelect: ToggleSelect;
}) {
  const attention = useAttentionModel();
  const highlightProps = attentionBlockProps(
    resourceAttentionSeverity(attention, 'maintainer', maintainerResourceId(item)),
  );
  const leading = item.is_marked ? (
    <span className="text-accent text-[0.85em] leading-none translate-y-[1px]" aria-hidden>●</span>
  ) : nested ? (
    <span className="text-fg-faint leading-none translate-y-[1px]" aria-label="fixes issue above">↳</span>
  ) : (
    <span
      className="text-label uppercase tracking-wider text-fg-muted leading-none translate-y-[1px]"
      aria-label="pull request"
    >
      PR
    </span>
  );

  const gridClass = onToggleSelect ? ROW_GRID_WITH_SELECT : ROW_GRID_NO_SELECT;
  return (
    <div
      {...highlightProps}
      className={`${gridClass} py-1 ${nested ? 'pl-10' : ''} ${highlightProps.className ?? ''}`}
    >
      {onToggleSelect && (
        <SelectCheckbox item={item} selection={selection} onToggleSelect={onToggleSelect} />
      )}
      {leading}
      <PriorityBadge labels={item.labels} />
      <div className="min-w-0">
        <span className={nested ? 'text-body text-fg-muted' : 'text-body text-fg'}>
          {item.title}
        </span>
        {item.weak_ties.length > 0 && (
          <span className="ml-3 text-body text-fg-faint">
            also in: {item.weak_ties.map((t) => `${t.label} (${t.count})`).join(', ')}
          </span>
        )}
      </div>
      <RowMeta item={item} extraStatus={item.status} />
    </div>
  );
}

function PriorityBadge({ labels }: { labels: string[] }) {
  const p = extractPriorityLabel(labels);
  if (p === null) return <span aria-hidden />;
  return (
    <span
      className="text-label uppercase tracking-wider text-fg-muted tnum leading-none translate-y-[1px]"
      title={`labeled severity: priority/${p.toLowerCase()}`}
    >
      {p}
    </span>
  );
}

function extractPriorityLabel(labels: string[]): string | null {
  for (const l of labels) {
    const m = /^priority\/(p[0-3])$/i.exec(l);
    if (m && m[1] !== undefined) return m[1].toUpperCase();
  }
  return null;
}

function RowMeta({
  item,
  extraStatus,
}: {
  item: TriageItem;
  extraStatus?: TriageItemStatus;
}) {
  const now = useNow();
  return (
    <div className="flex items-baseline gap-3 text-body text-fg-muted shrink-0 tnum">
      <a
        href={item.html_url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-fg focus-mark"
      >
        #{item.number}
      </a>
      <TriageScore item={item} />
      <SlungLink item={item} />
      <RunLink item={item} />

      <span aria-hidden>·</span>
      <ContributorByline author={item.author} />
      <span aria-hidden>·</span>
      <span>{formatRelative(item.updated_at, now)}</span>
      {extraStatus && extraStatus !== 'open' && (
        <>
          <span aria-hidden>·</span>
          <PrStatus status={extraStatus} />
        </>
      )}
    </div>
  );
}

function PrStatus({ status }: { status: TriageItemStatus }) {
  const label = statusLabel(status);
  const className =
    status === 'approved'
      ? 'text-ok'
      : status === 'changes_requested'
        ? 'text-accent'
        : status === 'needs_review'
          ? 'text-warn'
          : 'text-fg-muted';
  return <span className={className}>{label}</span>;
}

function ContributorByline({ author }: { author: ContributorStat }) {
  const ratesAvailable =
    author.issues_accepted !== null &&
    author.issues_opened !== null &&
    author.prs_merged !== null &&
    author.prs_opened !== null;

  const ratesTitle = ratesAvailable
    ? `${author.issues_accepted}/${author.issues_opened} issues accepted · ${author.prs_merged}/${author.prs_opened} PRs merged`
    : 'rates not yet computed';

  return (
    <span title={ratesTitle} className="whitespace-nowrap">
      {author.login}{' '}
      <span className={tierClass(author.tier)}>{tierWord(author.tier)}</span>
    </span>
  );
}

function rowKey(item: TriageItem): string {
  return `${item.kind}-${item.number}`;
}

function tierLabel(tier: TriageTier): string {
  if (tier === 'regression_breaking') return 'Regression + breaking';
  if (tier === 'regression') return 'Regression';
  return 'Stability';
}

function tierWord(tier: ContributorTier): string {
  if (tier === 'spam_risk') return 'spam risk';
  return tier;
}

function tierClass(tier: ContributorTier): string {
  if (tier === 'core') return 'text-fg font-medium';
  if (tier === 'trusted') return 'text-fg';
  if (tier === 'regular') return 'text-fg-muted';
  if (tier === 'new') return 'text-fg-muted italic';
  return 'text-accent';
}

function statusLabel(status: TriageItemStatus): string {
  if (status === 'needs_review') return 'needs review';
  if (status === 'changes_requested') return 'changes requested';
  return status;
}
