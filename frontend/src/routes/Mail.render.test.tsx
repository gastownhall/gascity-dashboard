import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor } from '../attention/compose';
import { NowProvider } from '../contexts/NowContext';
import { ReadOnlyProvider } from '../contexts/ReadOnlyContext';
import { MailPage } from './Mail';

interface FetchCall {
  method: string;
  url: string;
  body: unknown;
  gcRequest: string | null;
}

const fetchCalls: FetchCall[] = [];
const pendingResponses = new Map<string, Promise<Response>>();

// Stateful read-state overrides so a mark-read/unread POST is reflected by the
// next mailbox GET — lets the bulk-mark tests assert the needs-you count (the
// same selectOperatorActionableUnread the nav badge reads) actually updates.
const markedRead = new Map<string, boolean>();

function applyReadState(item: Record<string, unknown>): Record<string, unknown> {
  const id = item.id as string;
  return markedRead.has(id) ? { ...item, read: markedRead.get(id) } : item;
}

vi.mock('../contexts/ViewingAsContext', () => ({
  useViewingAs: () => ({
    viewingAs: { alias: 'stephanie', isOperator: true },
    setAlias: vi.fn(),
    resetToOperator: vi.fn(),
    aliasBuckets: [],
    aliasesLoading: false,
    sessionsUnavailable: false,
    loadAliases: vi.fn(),
  }),
}));

// Operator identity from /config (gascity-dashboard-bhvn): display alias
// `stephanie` maps to the gc wire alias `human` for mailbox filtering.
vi.mock('../contexts/OperatorConfigContext', () => ({
  useOperatorConfig: () => ({
    operatorAlias: 'stephanie',
    operatorWireAlias: 'human',
    decisionLabel: 'needs/stephanie',
  }),
}));

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      fetchCalls.push({
        method,
        url,
        body: await requestBody(input, init),
        gcRequest: requestHeader(input, init, 'X-GC-Request'),
      });
      const pending = pendingResponses.get(`${method} ${url}`);
      if (pending !== undefined) return pending;
      if (url === '/gc-supervisor/v0/city/test-city/mail?limit=100') {
        return jsonResponse({
          items: [
            mail({
              id: 'mail-inbox',
              from: 'mayor',
              to: 'human',
              subject: 'direct supervisor inbox',
              body: 'inbox preview',
              created_at: '2026-06-01T10:00:00Z',
              thread_id: 'thread-direct',
            }),
            // Unread and addressed to the operator, but pool-worker firehose: it
            // counts as inbox unread yet must NOT count toward "needs you"
            // (gascity-dashboard-2j8e.5).
            mail({
              id: 'mail-firehose',
              from: '/home/ds/gascity/polecat-2',
              to: 'human',
              subject: 'worker firehose noise',
              body: 'status update preview',
              created_at: '2026-06-01T09:59:00Z',
              thread_id: 'thread-firehose',
            }),
            mail({
              id: 'mail-sent',
              from: 'human',
              to: 'mechanic',
              subject: 'operator sent only',
              body: 'sent preview',
              created_at: '2026-06-01T10:01:00Z',
              read: true,
              thread_id: 'thread-direct',
            }),
            mail({
              id: 'mail-other',
              from: 'mechanic',
              to: 'mayor',
              subject: 'other inbox',
              body: 'other preview',
              created_at: '2026-06-01T10:02:00Z',
              thread_id: 'thread-other',
            }),
          ].map(applyReadState),
          total: 4,
        });
      }
      if (url === '/gc-supervisor/v0/city/test-city/mail?limit=1000') {
        return jsonResponse({
          items: [
            mail({
              id: 'mail-inbox',
              from: 'mayor',
              to: 'human',
              subject: 'direct supervisor inbox',
              body: 'inbox preview',
              created_at: '2026-06-01T10:00:00Z',
              thread_id: 'thread-direct',
            }),
            mail({
              id: 'mail-sent',
              from: 'human',
              to: 'mechanic',
              subject: 'operator sent only',
              body: 'sent preview',
              created_at: '2026-06-01T10:01:00Z',
              read: true,
              thread_id: 'thread-direct',
            }),
            mail({
              id: 'mail-other',
              from: 'mechanic',
              to: 'mayor',
              subject: 'other inbox',
              body: 'other preview',
              created_at: '2026-06-01T10:02:00Z',
              thread_id: 'thread-other',
            }),
            mail({
              id: 'mail-older',
              from: 'mayor',
              to: 'human',
              subject: 'expanded history item',
              body: 'older preview',
              created_at: '2026-05-30T10:02:00Z',
              read: true,
              thread_id: 'thread-older',
            }),
          ],
          total: 4,
        });
      }
      if (url === '/gc-supervisor/v0/city/test-city/mail/thread/thread-direct') {
        return jsonResponse({
          items: [
            mail({
              id: 'thread-new',
              from: 'human',
              to: 'mayor',
              subject: 'direct supervisor inbox',
              body: 'newest in thread',
              created_at: '2026-06-01T10:02:00Z',
              thread_id: 'thread-direct',
            }),
            mail({
              id: 'thread-old',
              from: 'mayor',
              to: 'human',
              subject: 'direct supervisor inbox',
              body: 'oldest in thread',
              created_at: '2026-06-01T10:00:00Z',
              thread_id: 'thread-direct',
            }),
          ],
          total: 2,
        });
      }
      if (url === '/gc-supervisor/v0/city/test-city/mail' && method === 'POST') {
        return jsonResponse(
          {
            id: 'mail-new',
            from: 'human',
            to: 'mayor',
            subject: 'status',
            body: 'all green',
            created_at: '2026-06-01T10:03:00Z',
            read: false,
            thread_id: 'thread-new',
          },
          201,
        );
      }
      const readMatch = url.match(/\/mail\/([^/]+)\/read$/);
      if (readMatch?.[1] !== undefined && method === 'POST') {
        markedRead.set(readMatch[1], true);
        return jsonResponse({ status: 'ok' });
      }
      const unreadMatch = url.match(/\/mail\/([^/]+)\/mark-unread$/);
      if (unreadMatch?.[1] !== undefined && method === 'POST') {
        markedRead.set(unreadMatch[1], false);
        return jsonResponse({ status: 'ok' });
      }
      if (url === '/gc-supervisor/v0/city/test-city/mail/mail-inbox/archive' && method === 'POST') {
        return jsonResponse({ status: 'ok' });
      }
      if (url === '/gc-supervisor/v0/city/test-city/mail/mail-inbox/reply' && method === 'POST') {
        return jsonResponse(
          {
            id: 'mail-reply',
            from: 'human',
            to: 'mayor',
            subject: 'direct supervisor inbox',
            body: 'got it',
            created_at: '2026-06-01T10:04:00Z',
            read: false,
            thread_id: 'thread-direct',
          },
          201,
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function requestUrl(input: RequestInfo | URL): string {
  const url =
    input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
  return stripSameOrigin(url);
}

function stripSameOrigin(url: string): string {
  const origin = window.location.origin;
  return url.startsWith(origin) ? url.slice(origin.length) : url;
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method !== undefined) return init.method;
  if (input instanceof Request) return input.method;
  return 'GET';
}

async function requestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<unknown> {
  const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return JSON.parse(raw) as unknown;
}

function requestHeader(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  name: string,
): string | null {
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  return headers.get(name);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mail(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'mail-1',
    from: 'mayor',
    to: 'human',
    subject: 'subject',
    body: 'body',
    created_at: '2026-06-01T10:00:00Z',
    read: false,
    ...overrides,
  };
}

beforeEach(() => {
  fetchCalls.length = 0;
  pendingResponses.clear();
  markedRead.clear();
  invalidate('mail');
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MailPage supervisor reads', () => {
  it('loads the operator inbox from the supervisor API instead of the dashboard GET mirror', async () => {
    renderMailPage();

    await screen.findByText('direct supervisor inbox');

    expect(fetchCalls.map((call) => call.url)).toContain(
      '/gc-supervisor/v0/city/test-city/mail?limit=100',
    );
    expect(fetchCalls.some((call) => call.url.startsWith('/api/city/test-city/mail'))).toBe(false);
    expect(screen.queryByText('operator sent only')).toBeNull();
    expect(screen.queryByText('other inbox')).toBeNull();
  });

  it('foregrounds the operator needs-you count, folding the pool-worker firehose (gascity-dashboard-2j8e.5)', async () => {
    renderMailPage();

    await screen.findByText('direct supervisor inbox');
    // Two unread to:human (mayor + a polecat firehose message), but only the
    // mayor escalation needs the operator — the same count the nav badge shows.
    expect(screen.getByText(/1 need you of 2 unread/)).toBeTruthy();
  });

  it('the needs-you chip surfaces operator escalations and hides the firehose (gascity-dashboard-2j8e.5)', async () => {
    renderMailPage();

    await screen.findByText('direct supervisor inbox');
    expect(screen.getByText('worker firehose noise')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'needs you' }));

    expect(screen.getByText('direct supervisor inbox')).toBeTruthy();
    expect(screen.queryByText('worker firehose noise')).toBeNull();
  });

  it('expands mailbox history through the generated supervisor limit query', async () => {
    renderMailPage();

    await screen.findByText('direct supervisor inbox');
    fireEvent.change(screen.getByLabelText('Mail history limit'), {
      target: { value: '1000' },
    });

    expect(await screen.findByText('expanded history item')).toBeTruthy();
    expect(fetchCalls.map((call) => call.url)).toContain(
      '/gc-supervisor/v0/city/test-city/mail?limit=1000',
    );
    expect((screen.getByLabelText('Mail history limit') as HTMLSelectElement).value).toBe('1000');
  });

  it('exposes a clock window filter without changing the generated supervisor history query', async () => {
    renderMailPage();

    await screen.findByText('direct supervisor inbox');
    expect((screen.getByLabelText('Mail time window') as HTMLSelectElement).value).toBe('all');

    fireEvent.change(screen.getByLabelText('Mail time window'), {
      target: { value: '7d' },
    });

    expect((screen.getByLabelText('Mail time window') as HTMLSelectElement).value).toBe('7d');
    expect(fetchCalls.map((call) => call.url)).toContain(
      '/gc-supervisor/v0/city/test-city/mail?limit=100',
    );
    expect(fetchCalls.some((call) => call.url.includes('since='))).toBe(false);
  });

  it('loads thread messages from the supervisor thread endpoint', async () => {
    renderMailPage();

    fireEvent.click(await screen.findByText('direct supervisor inbox'));

    await screen.findByText('oldest in thread');
    expect(screen.getByText('newest in thread')).toBeTruthy();
    expect(fetchCalls.map((call) => call.url)).toContain(
      '/gc-supervisor/v0/city/test-city/mail/thread/thread-direct',
    );
    expect(fetchCalls.some((call) => call.url.startsWith('/api/city/test-city/mail/threads'))).toBe(
      false,
    );
  });

  it('opens a message thread from the message query parameter', async () => {
    renderMailPage('/mail?message=mail-inbox');

    await screen.findByText('oldest in thread');

    expect(screen.getByText('newest in thread')).toBeTruthy();
    expect(fetchCalls.map((call) => call.url)).toContain(
      '/gc-supervisor/v0/city/test-city/mail?limit=1000',
    );
    expect(fetchCalls.map((call) => call.url)).toContain(
      '/gc-supervisor/v0/city/test-city/mail/thread/thread-direct',
    );
  });

  it('sends mail through the supervisor API instead of the dashboard write mirror', async () => {
    renderMailPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Compose' }));
    fireEvent.change(screen.getByLabelText('To (alias)'), { target: { value: 'mayor' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'status' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'all green' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('direct supervisor inbox');
    expect(fetchCalls).toContainEqual({
      method: 'POST',
      url: '/gc-supervisor/v0/city/test-city/mail',
      body: {
        to: 'mayor',
        subject: 'status',
        body: 'all green',
        from: 'human',
      },
      gcRequest: 'dashboard',
    });
    expect(fetchCalls.some((call) => call.url === '/api/city/test-city/mail-send')).toBe(false);
  });

  it('offers an all-traffic mailbox mode without filtering out sent or non-operator mail', async () => {
    renderMailPage();

    fireEvent.click(await screen.findByRole('button', { name: 'All' }));

    await screen.findByText('direct supervisor inbox');
    expect(screen.getByText('operator sent only')).toBeTruthy();
    expect(screen.getByText('other inbox')).toBeTruthy();
  });

  it('marks unread inbox mail read through the supervisor API', async () => {
    renderMailPage();

    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark read' }));

    await waitFor(() => {
      expect(fetchCalls).toContainEqual({
        method: 'POST',
        url: '/gc-supervisor/v0/city/test-city/mail/mail-inbox/read',
        body: undefined,
        gcRequest: 'dashboard',
      });
    });
  });

  it('marks read mail unread through the supervisor API', async () => {
    renderMailPage();

    fireEvent.click(await screen.findByRole('button', { name: 'All' }));
    fireEvent.click(await screen.findByText('operator sent only'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark unread' }));

    await screen.findByRole('button', { name: 'Mark read' });
    await waitFor(() => {
      expect(fetchCalls).toContainEqual({
        method: 'POST',
        url: '/gc-supervisor/v0/city/test-city/mail/mail-sent/mark-unread',
        body: undefined,
        gcRequest: 'dashboard',
      });
    });
  });

  it('archives mail through the supervisor API', async () => {
    renderMailPage();

    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(fetchCalls).toContainEqual({
        method: 'POST',
        url: '/gc-supervisor/v0/city/test-city/mail/mail-inbox/archive',
        body: undefined,
        gcRequest: 'dashboard',
      });
    });
  });

  it('replies to a thread through the supervisor API as the operator', async () => {
    renderMailPage();

    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    fireEvent.change(await screen.findByLabelText('Reply'), {
      target: { value: 'got it' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));

    await waitFor(() => {
      expect(fetchCalls).toContainEqual({
        method: 'POST',
        url: '/gc-supervisor/v0/city/test-city/mail/mail-inbox/reply',
        body: {
          body: 'got it',
          from: 'human',
        },
        gcRequest: 'dashboard',
      });
    });
  });

  it('disables Compose and surfaces a read-only affordance under DASHBOARD_READONLY', async () => {
    renderMailPage('/mail', { readOnly: true });

    await screen.findByText('direct supervisor inbox');

    const compose = screen.getByRole('button', { name: 'Compose' }) as HTMLButtonElement;
    expect(compose.disabled).toBe(true);
    expect(compose.getAttribute('title')).toBe('Read-only mode: mutations are disabled');
    // The affordance carries words, not just a dimmed control (DESIGN.md §States).
    expect(screen.getByText('Read-only')).toBeTruthy();
  });

  it('disables the thread mark/archive/reply actions in read-only mode', async () => {
    renderMailPage('/mail', { readOnly: true });

    fireEvent.click(await screen.findByText('direct supervisor inbox'));

    expect(
      (await screen.findByRole('button', { name: 'Mark read' })) as HTMLButtonElement,
    ).toHaveProperty('disabled', true);
    expect((screen.getByRole('button', { name: 'Archive' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Reply' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('keeps Compose active when the dashboard is writable', async () => {
    renderMailPage();

    await screen.findByText('direct supervisor inbox');

    expect((screen.getByRole('button', { name: 'Compose' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByText('Read-only')).toBeNull();
  });

  it('marks attention mail rows without filtering out non-attention mail', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <NowProvider intervalMs={1_000_000}>
          <AttentionProvider
            contributors={[
              contributor('mail', [
                {
                  id: 'mail:mail-inbox:unread',
                  domain: 'mail',
                  severity: 'attention',
                  title: 'direct supervisor inbox',
                },
              ]),
            ]}
          >
            <MailPage />
          </AttentionProvider>
        </NowProvider>
      </MemoryRouter>,
    );

    const inboxRow = (await screen.findByText('direct supervisor inbox')).closest('tr');
    expect(inboxRow?.getAttribute('data-attention-severity')).toBe('attention');
    expect(screen.queryByText('operator sent only')).toBeNull();
  });

  it('marks attention messages inside an opened thread', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <NowProvider intervalMs={1_000_000}>
          <AttentionProvider
            contributors={[
              contributor('mail', [
                {
                  id: 'mail:thread-old:unread',
                  domain: 'mail',
                  severity: 'attention',
                  title: 'direct supervisor inbox',
                },
              ]),
            ]}
          >
            <MailPage />
          </AttentionProvider>
        </NowProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('direct supervisor inbox'));

    const threadArticle = (await screen.findByText('oldest in thread')).closest('article');
    expect(threadArticle?.getAttribute('data-attention-severity')).toBe('attention');
  });
});

function deferResponse(method: string, path: string) {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  pendingResponses.set(`${method} /gc-supervisor/v0/city/test-city/mail/${path}`, promise);
  return { resolve, reject };
}

function threadResponse(body: string) {
  return jsonResponse({ items: [mail({ id: body, body })], total: 1 });
}

async function switchToFirehose() {
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByText('worker firehose noise'));
  await waitFor(() => {
    expect(fetchCalls.some((call) => call.url.endsWith('/thread/thread-firehose'))).toBe(true);
  });
}

describe('MailPage dialog response ownership', () => {
  it('keeps the newly opened thread messages, title and action target after a stale success', async () => {
    const first = deferResponse('GET', 'thread/thread-direct');
    const second = deferResponse('GET', 'thread/thread-firehose');
    renderMailPage();
    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    await switchToFirehose();
    await act(async () => second.resolve(threadResponse('second thread body')));
    await act(async () => first.resolve(threadResponse('stale first body')));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading', { name: 'worker firehose noise' })).toBeTruthy();
    expect(dialog.getByText('second thread body')).toBeTruthy();
    expect(dialog.queryByText('stale first body')).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Mark read' }));
    await waitFor(() => {
      expect(
        fetchCalls.some(
          (call) => call.method === 'POST' && call.url.endsWith('/mail-firehose/read'),
        ),
      ).toBe(true);
    });
  });

  it.each(['success', 'error'])(
    'keeps the new thread loading when the old request finishes with %s',
    async (outcome) => {
      const first = deferResponse('GET', 'thread/thread-direct');
      const second = deferResponse('GET', 'thread/thread-firehose');
      renderMailPage();
      fireEvent.click(await screen.findByText('direct supervisor inbox'));
      await switchToFirehose();
      await act(async () => {
        if (outcome === 'success') first.resolve(threadResponse('stale first body'));
        else first.reject(new Error('stale first error'));
      });
      expect(within(screen.getByRole('dialog')).getByText('Loading thread.')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      await act(async () => second.resolve(threadResponse('second thread body')));
      expect(await screen.findByText('second thread body')).toBeTruthy();
    },
  );

  it('preserves the new thread error when the old request fails later', async () => {
    const first = deferResponse('GET', 'thread/thread-direct');
    const second = deferResponse('GET', 'thread/thread-firehose');
    renderMailPage();
    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    await switchToFirehose();
    await act(async () => second.reject(new Error('second thread error')));
    await act(async () => first.reject(new Error('stale first error')));
    expect(screen.getByRole('alert').textContent).toBe('second thread error');
  });

  it('invalidates pending requests on close, including when reopening the same message', async () => {
    const first = deferResponse('GET', 'thread/thread-direct');
    renderMailPage();
    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => first.reject(new Error('closed thread error')));
    expect(screen.queryByRole('alert')).toBeNull();
    const reopened = deferResponse('GET', 'thread/thread-direct');
    fireEvent.click(screen.getByText('direct supervisor inbox'));
    await act(async () => reopened.resolve(threadResponse('reopened body')));
    expect(await screen.findByText('reopened body')).toBeTruthy();
  });

  it('distinguishes two openings of the same message', async () => {
    const first = deferResponse('GET', 'thread/thread-direct');
    renderMailPage();
    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    await waitFor(() =>
      expect(fetchCalls.some((call) => call.url.endsWith('/thread/thread-direct'))).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const second = deferResponse('GET', 'thread/thread-direct');
    fireEvent.click(screen.getByText('direct supervisor inbox'));
    await act(async () => second.resolve(threadResponse('reopened body')));
    await act(async () => first.resolve(threadResponse('old opening body')));
    expect(within(screen.getByRole('dialog')).getByText('reopened body')).toBeTruthy();
    expect(screen.queryByText('old opening body')).toBeNull();
  });

  it('clears loading when the next message has no thread', async () => {
    const first = deferResponse('GET', 'thread/thread-direct');
    pendingResponses.set(
      'GET /gc-supervisor/v0/city/test-city/mail?limit=100',
      Promise.resolve(
        jsonResponse({
          items: [
            mail({
              id: 'mail-inbox',
              subject: 'direct supervisor inbox',
              thread_id: 'thread-direct',
            }),
            mail({ id: 'standalone', subject: 'standalone message', body: 'standalone body' }),
          ],
          total: 2,
        }),
      ),
    );
    renderMailPage();
    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByText('standalone message'));
    expect(within(screen.getByRole('dialog')).getByText('standalone body')).toBeTruthy();
    await act(async () => first.resolve(threadResponse('stale first body')));
    expect(within(screen.getByRole('dialog')).getByText('standalone body')).toBeTruthy();
    expect(screen.queryByText('stale first body')).toBeNull();
  });

  it.each(['success', 'error'])(
    'preserves a new action in flight after an old action %s',
    async (outcome) => {
      const firstThread = deferResponse('GET', 'thread/thread-direct');
      const firstAction = deferResponse('POST', 'mail-inbox/read');
      const secondAction = deferResponse('POST', 'mail-firehose/read');
      renderMailPage();
      fireEvent.click(await screen.findByText('direct supervisor inbox'));
      await act(async () => firstThread.resolve(threadResponse('first thread body')));
      fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
      await waitFor(() =>
        expect(fetchCalls.some((call) => call.url.endsWith('/mail-inbox/read'))).toBe(true),
      );
      const secondThread = deferResponse('GET', 'thread/thread-firehose');
      await switchToFirehose();
      await act(async () => secondThread.resolve(threadResponse('second thread body')));
      const button = screen.getByRole('button', { name: 'Mark read' });
      expect(button).toHaveProperty('disabled', false);
      fireEvent.click(button);
      await waitFor(() =>
        expect(fetchCalls.some((call) => call.url.endsWith('/mail-firehose/read'))).toBe(true),
      );
      await act(async () => {
        if (outcome === 'success') firstAction.resolve(jsonResponse({ status: 'ok' }));
        else firstAction.reject(new Error('stale action error'));
      });
      expect(screen.getByRole('button', { name: 'Mark read' })).toHaveProperty('disabled', true);
      if (outcome === 'error')
        expect(screen.getByRole('alert').textContent).toBe('stale action error');
      else expect(screen.queryByRole('alert')).toBeNull();
      await act(async () => secondAction.reject(new Error('current action error')));
      expect(screen.getByRole('alert').textContent).toBe('current action error');
      expect(screen.getByRole('button', { name: 'Mark read' })).toHaveProperty('disabled', false);
    },
  );

  it('ignores a reply thread refresh that finishes after another dialog opens', async () => {
    const firstThread = deferResponse('GET', 'thread/thread-direct');
    renderMailPage();
    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    await act(async () => firstThread.resolve(threadResponse('first thread body')));
    const replyThread = deferResponse('GET', 'thread/thread-direct');
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'first reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() =>
      expect(fetchCalls.filter((call) => call.url.endsWith('/thread/thread-direct'))).toHaveLength(
        2,
      ),
    );
    const secondThread = deferResponse('GET', 'thread/thread-firehose');
    await switchToFirehose();
    await act(async () => secondThread.resolve(threadResponse('second thread body')));
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'second draft' } });
    await act(async () => replyThread.resolve(threadResponse('stale reply thread')));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('second thread body')).toBeTruthy();
    expect(dialog.queryByText('stale reply thread')).toBeNull();
    expect((dialog.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe('second draft');
  });

  it.each(
    ['read', 'unread', 'archive', 'reply'].flatMap((action) =>
      ['success', 'error'].map((outcome) => ({ action, outcome })),
    ),
  )(
    'keeps a new dialog after the old $action action finishes with $outcome',
    async ({ action, outcome }) => {
      const firstThread = deferResponse('GET', 'thread/thread-direct');
      const firstAction = deferResponse(
        'POST',
        `mail-inbox/${action === 'unread' ? 'mark-unread' : action}`,
      );
      renderMailPage();
      fireEvent.click(await screen.findByText('direct supervisor inbox'));
      await act(async () => firstThread.resolve(threadResponse('first thread body')));
      if (action === 'unread') {
        // Change the current read state using the existing route fixture.
        pendingResponses.delete('POST /gc-supervisor/v0/city/test-city/mail/mail-inbox/read');
        fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
        await screen.findByRole('button', { name: 'Mark unread' });
      }
      if (action === 'reply')
        fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'first reply' } });
      const label =
        action === 'read'
          ? 'Mark read'
          : action === 'unread'
            ? 'Mark unread'
            : action === 'archive'
              ? 'Archive'
              : 'Reply';
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() =>
        expect(
          fetchCalls.some((call) =>
            call.url.endsWith(`mail-inbox/${action === 'unread' ? 'mark-unread' : action}`),
          ),
        ).toBe(true),
      );
      const secondThread = deferResponse('GET', 'thread/thread-firehose');
      await switchToFirehose();
      await act(async () => secondThread.resolve(threadResponse('second thread body')));
      fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'second draft' } });
      await act(async () => {
        if (outcome === 'success') firstAction.resolve(jsonResponse({ status: 'ok' }));
        else firstAction.reject(new Error(`${action} write failed`));
      });
      if (outcome === 'error')
        expect(screen.getByRole('alert').textContent).toBe(`${action} write failed`);
      const dialog = within(screen.getByRole('dialog'));
      expect(dialog.getByRole('heading', { name: 'worker firehose noise' })).toBeTruthy();
      expect(dialog.getByText('second thread body')).toBeTruthy();
      expect((dialog.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe('second draft');
      expect(dialog.getByRole('button', { name: 'Mark read' })).toHaveProperty('disabled', false);
    },
  );

  it.each(['read', 'unread', 'archive', 'reply'] as const)(
    'reports a failed %s write after closing the dialog',
    async (action) => {
      const firstThread = deferResponse('GET', 'thread/thread-direct');
      const actionPath = `mail-inbox/${action === 'unread' ? 'mark-unread' : action}`;
      const firstAction = deferResponse('POST', actionPath);
      renderMailPage();
      fireEvent.click(await screen.findByText('direct supervisor inbox'));
      await act(async () => firstThread.resolve(threadResponse('first thread body')));
      if (action === 'unread') {
        fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
        await screen.findByRole('button', { name: 'Mark unread' });
      }
      if (action === 'reply')
        fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'first reply' } });
      const labels = {
        read: 'Mark read',
        unread: 'Mark unread',
        archive: 'Archive',
        reply: 'Reply',
      };
      fireEvent.click(screen.getByRole('button', { name: labels[action] }));
      await waitFor(() =>
        expect(
          fetchCalls.some((call) => call.method === 'POST' && call.url.endsWith(actionPath)),
        ).toBe(true),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      await act(async () => firstAction.reject(new Error(`${action} write failed`)));
      expect(screen.getByRole('alert').textContent).toBe(`${action} write failed`);
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it('reports a mailbox refresh failure after a successful archive closes the dialog', async () => {
    renderMailPage();
    fireEvent.click(await screen.findByText('direct supervisor inbox'));
    await screen.findByText('oldest in thread');
    pendingResponses.set(
      'GET /gc-supervisor/v0/city/test-city/mail?limit=100',
      Promise.resolve(jsonResponse({ error: 'mailbox refresh failed' }, 500)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect((await screen.findByRole('alert')).textContent).toBe('mailbox refresh failed');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('MailPage bulk read-state selection (gascity-dashboard-mp3g)', () => {
  it('select-all selects the whole visible set, and rows toggle independently', async () => {
    renderMailPage();
    await screen.findByText('direct supervisor inbox');

    const selectAll = screen.getByRole('checkbox', { name: 'select all mail' });
    fireEvent.click(selectAll);
    // Both visible inbox rows (mayor escalation + polecat firehose) selected.
    expect(screen.getByText('2 selected')).toBeTruthy();

    fireEvent.click(selectAll);
    expect(screen.queryByText(/selected/)).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /select mail: direct supervisor inbox/ }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    // Toggling a row checkbox must not open the thread modal (no Reply field).
    expect(screen.queryByLabelText('Reply')).toBeNull();
  });

  it('bulk-marks the selected inbox mail read through the supervisor API', async () => {
    renderMailPage();
    await screen.findByText('direct supervisor inbox');

    fireEvent.click(screen.getByRole('checkbox', { name: 'select all mail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));

    await waitFor(() => {
      expect(fetchCalls).toContainEqual({
        method: 'POST',
        url: '/gc-supervisor/v0/city/test-city/mail/mail-inbox/read',
        body: undefined,
        gcRequest: 'dashboard',
      });
    });
    expect(fetchCalls).toContainEqual({
      method: 'POST',
      url: '/gc-supervisor/v0/city/test-city/mail/mail-firehose/read',
      body: undefined,
      gcRequest: 'dashboard',
    });
  });

  it('bulk-marks the selected read mail unread, skipping already-unread rows (no second mark)', async () => {
    renderMailPage();
    fireEvent.click(await screen.findByRole('button', { name: 'All' }));
    await screen.findByText('operator sent only');

    fireEvent.click(screen.getByRole('checkbox', { name: 'select all mail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark unread' }));

    await waitFor(() => {
      expect(fetchCalls).toContainEqual({
        method: 'POST',
        url: '/gc-supervisor/v0/city/test-city/mail/mail-sent/mark-unread',
        body: undefined,
        gcRequest: 'dashboard',
      });
    });
    // mail-inbox / mail-other are already unread — bulk mark-unread must not
    // re-issue redundant writes for them.
    expect(
      fetchCalls.some(
        (c) => c.url === '/gc-supervisor/v0/city/test-city/mail/mail-inbox/mark-unread',
      ),
    ).toBe(false);
    expect(
      fetchCalls.some(
        (c) => c.url === '/gc-supervisor/v0/city/test-city/mail/mail-other/mark-unread',
      ),
    ).toBe(false);
  });

  it('updates the needs-you count after a bulk mark-read (same selector as the nav badge)', async () => {
    renderMailPage();
    await screen.findByText(/1 need you of 2 unread/);

    fireEvent.click(screen.getByRole('checkbox', { name: 'select all mail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));

    // After both inbox rows are marked read, the re-fetched mailbox has no
    // unread — the needs-you synopsis collapses to the all-read line.
    expect(await screen.findByText(/all read/)).toBeTruthy();
  });

  it('offers no bulk selection in the sent box, which has no read-state concept', async () => {
    renderMailPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sent' }));
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: 'select all mail' })).toBeNull();
    });
  });

  it('disables the bulk mark actions in read-only mode', async () => {
    renderMailPage('/mail', { readOnly: true });
    await screen.findByText('direct supervisor inbox');

    fireEvent.click(screen.getByRole('checkbox', { name: 'select all mail' }));
    expect((screen.getByRole('button', { name: 'Mark read' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Mark unread' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

function renderMailPage(initialEntry = '/mail', options: { readOnly?: boolean } = {}) {
  render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <NowProvider intervalMs={1_000_000}>
        <ReadOnlyProvider readOnly={options.readOnly ?? false}>
          <MailPage />
        </ReadOnlyProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

function contributor(
  domain: 'mail',
  items: ReturnType<AttentionContributor['getItems']>,
): AttentionContributor {
  return {
    id: `${domain}:test`,
    domain,
    getItems: () => items,
  };
}
