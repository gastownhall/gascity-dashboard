import { describe, expect, it } from 'vitest';
import { SupervisorApiError, unwrapSupervisorResult, type SupervisorResult } from './errors';

function okResponse(headers: Record<string, string> = {}, statusText = 'OK'): Response {
  return new Response(null, { status: 200, statusText, headers });
}

describe('unwrapSupervisorResult', () => {
  it('resolves with data when response.ok, no error, and data is present', async () => {
    const result: SupervisorResult<string> = {
      data: 'the payload',
      response: okResponse(),
    };

    await expect(unwrapSupervisorResult(Promise.resolve(result), 'empty')).resolves.toBe(
      'the payload',
    );
  });

  it('throws with emptyMessage when response.ok but data is undefined, with no request-id header', async () => {
    const result: SupervisorResult<string> = {
      response: okResponse(),
    };

    await expect(unwrapSupervisorResult(Promise.resolve(result), 'no data')).rejects.toMatchObject({
      name: 'SupervisorApiError',
      status: 200,
      message: 'no data',
      requestId: undefined,
    });
  });

  it('throws using messageFromUnknown(result.error) when response is undefined', async () => {
    const result: SupervisorResult<string> = {
      error: 'no response object',
    };

    await expect(unwrapSupervisorResult(Promise.resolve(result), 'empty')).rejects.toMatchObject({
      name: 'SupervisorApiError',
      status: undefined,
      message: 'no response object',
      requestId: undefined,
    });
  });

  it('throws when response.ok but result.error is set (ok-but-error-field branch)', async () => {
    const result: SupervisorResult<string> = {
      data: 'ignored',
      error: 'validation failed',
      response: okResponse({ 'x-gc-request-id': 'req-1' }),
    };

    await expect(unwrapSupervisorResult(Promise.resolve(result), 'empty')).rejects.toMatchObject({
      name: 'SupervisorApiError',
      status: 200,
      message: 'validation failed',
      requestId: 'req-1',
    });
  });

  it('re-throws an existing SupervisorApiError from a rejected promise unchanged', async () => {
    const original = new SupervisorApiError(418, 'teapot', 'req-teapot');

    await expect(unwrapSupervisorResult(Promise.reject(original), 'empty')).rejects.toBe(original);
  });

  it('wraps a generic thrown Error into a SupervisorApiError with no status/requestId', async () => {
    const thrown = new Error('network exploded');

    await expect(unwrapSupervisorResult(Promise.reject(thrown), 'empty')).rejects.toMatchObject({
      name: 'SupervisorApiError',
      status: undefined,
      message: 'network exploded',
      requestId: undefined,
    });
  });

  it('wraps a thrown non-Error value via messageFromUnknown default fallback', async () => {
    await expect(unwrapSupervisorResult(Promise.reject(42), 'empty')).rejects.toMatchObject({
      name: 'SupervisorApiError',
      message: 'gc supervisor request failed',
    });
  });

  describe('messageFromUnknown priority order (via the error-field branch)', () => {
    it.each<[string, unknown, string, string]>([
      [
        'prefers a non-empty string error over anything else',
        '  raw string message  ',
        'OK',
        'raw string message',
      ],
      [
        'falls through an empty/whitespace string to the response.statusText default',
        '   ',
        'Fallback Status',
        'Fallback Status',
      ],
      [
        'prefers an Error message over a record with error/message/detail fields',
        new Error('boom from Error object'),
        'OK',
        'boom from Error object',
      ],
      [
        'prefers record.error over record.message and record.detail',
        { error: 'from error key', message: 'from message key', detail: 'from detail key' },
        'OK',
        'from error key',
      ],
      [
        'falls back to record.message when record.error is absent',
        { message: 'from message key', detail: 'from detail key' },
        'OK',
        'from message key',
      ],
      [
        'falls back to record.detail when error and message are absent',
        { detail: 'from detail key' },
        'OK',
        'from detail key',
      ],
      [
        'falls back to the response statusText when no known field matches',
        { unrelated: 'nope' },
        'No Known Field',
        'No Known Field',
      ],
      [
        'treats an array as a non-record and falls back to the response statusText',
        ['not', 'a', 'record'],
        'Array Is Not A Record',
        'Array Is Not A Record',
      ],
    ])('%s', async (_name, error, statusText, expectedMessage) => {
      const result: SupervisorResult<string> = { error, response: okResponse({}, statusText) };

      await expect(unwrapSupervisorResult(Promise.resolve(result), 'empty')).rejects.toMatchObject({
        message: expectedMessage,
      });
    });
  });
});
