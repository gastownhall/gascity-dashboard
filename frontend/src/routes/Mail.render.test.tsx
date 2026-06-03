import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor } from '../attention/compose';
import { NowProvider } from '../contexts/NowContext';
import { MailPage } from './Mail';

interface FetchCall {
  method: string;
  url: string;
  body: unknown;
  gcRequest: string | null;
}

const fetchCalls: FetchCall[] = [];

vi.mock('../contexts/ViewingAsContext', () => ({
  OPERATOR_ALIAS: 'stephanie',
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

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    fetchCalls.push({
      method,
      url,
      body: await requestBody(input, init),
      gcRequest: requestHeader(input, init, 'X-GC-Request'),
    });
    if (url === '/api/city/test-city/mail-send') {
      return jsonResponse(
        { error: 'old dashboard mail send mirror should not be called' },
        500,
      );
    }
    if (url.startsWith('/api/city/test-city/mail')) {
      return jsonResponse(
        { error: 'old dashboard mail read mirror should not be called' },
        500,
      );
    }
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
        ],
        total: 3,
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
      return jsonResponse({
        id: 'mail-new',
        from: 'human',
        to: 'mayor',
        subject: 'status',
        body: 'all green',
        created_at: '2026-06-01T10:03:00Z',
        read: false,
        thread_id: 'thread-new',
      }, 201);
    }
    if (url === '/gc-supervisor/v0/city/test-city/mail/mail-inbox/read' && method === 'POST') {
      return jsonResponse({ status: 'ok' });
    }
    if (url === '/gc-supervisor/v0/city/test-city/mail/mail-sent/mark-unread' && method === 'POST') {
      return jsonResponse({ status: 'ok' });
    }
    if (url === '/gc-supervisor/v0/city/test-city/mail/mail-inbox/archive' && method === 'POST') {
      return jsonResponse({ status: 'ok' });
    }
    if (url === '/gc-supervisor/v0/city/test-city/mail/mail-inbox/reply' && method === 'POST') {
      return jsonResponse({
        id: 'mail-reply',
        from: 'human',
        to: 'mayor',
        subject: 'direct supervisor inbox',
        body: 'got it',
        created_at: '2026-06-01T10:04:00Z',
        read: false,
        thread_id: 'thread-direct',
      }, 201);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }));
}

function requestUrl(input: RequestInfo | URL): string {
  const url = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.toString()
      : String(input);
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

async function requestBody(input: RequestInfo | URL, init: RequestInit | undefined): Promise<unknown> {
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

    expect(fetchCalls.map((call) => call.url)).toContain('/gc-supervisor/v0/city/test-city/mail?limit=100');
    expect(fetchCalls.some((call) => call.url.startsWith('/api/city/test-city/mail'))).toBe(false);
    expect(screen.queryByText('operator sent only')).toBeNull();
    expect(screen.queryByText('other inbox')).toBeNull();
  });

  it('expands mailbox history through the generated supervisor limit query', async () => {
    renderMailPage();

    await screen.findByText('direct supervisor inbox');
    fireEvent.change(screen.getByLabelText('Mail history limit'), {
      target: { value: '1000' },
    });

    expect(await screen.findByText('expanded history item')).toBeTruthy();
    expect(fetchCalls.map((call) => call.url)).toContain('/gc-supervisor/v0/city/test-city/mail?limit=1000');
    expect((screen.getByLabelText('Mail history limit') as HTMLSelectElement).value).toBe('1000');
  });

  it('loads thread messages from the supervisor thread endpoint', async () => {
    renderMailPage();

    fireEvent.click(await screen.findByText('direct supervisor inbox'));

    await screen.findByText('oldest in thread');
    expect(screen.getByText('newest in thread')).toBeTruthy();
    expect(fetchCalls.map((call) => call.url)).toContain('/gc-supervisor/v0/city/test-city/mail/thread/thread-direct');
    expect(fetchCalls.some((call) => call.url.startsWith('/api/city/test-city/mail/threads'))).toBe(false);
  });

  it('opens a message thread from the message query parameter', async () => {
    renderMailPage('/mail?message=mail-inbox');

    await screen.findByText('oldest in thread');

    expect(screen.getByText('newest in thread')).toBeTruthy();
    expect(fetchCalls.map((call) => call.url)).toContain('/gc-supervisor/v0/city/test-city/mail?limit=1000');
    expect(fetchCalls.map((call) => call.url)).toContain('/gc-supervisor/v0/city/test-city/mail/thread/thread-direct');
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

  it('marks attention mail rows without filtering out non-attention mail', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <NowProvider intervalMs={1_000_000}>
          <AttentionProvider contributors={[
            contributor('mail', [{
              id: 'mail:mail-inbox:unread',
              domain: 'mail',
              severity: 'attention',
              title: 'direct supervisor inbox',
            }]),
          ]}>
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
          <AttentionProvider contributors={[
            contributor('mail', [{
              id: 'mail:thread-old:unread',
              domain: 'mail',
              severity: 'attention',
              title: 'direct supervisor inbox',
            }]),
          ]}>
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

function renderMailPage(initialEntry = '/mail') {
  render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <NowProvider intervalMs={1_000_000}>
        <MailPage />
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
