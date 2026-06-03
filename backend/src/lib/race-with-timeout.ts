// Race a Promise against a TimeoutError-named rejection so the caller can
// surface a 504 (via GcClient.isTimeoutError) when the underlying call would
// otherwise sit on a generous default timeout.
//
// Hoisted into shared lib/ during PR-B1 so the maintainer module is
// self-contained (specs/architecture/maintainer-coupling-audit.md C3) and no
// route needs to export a generic timer utility.
//
// The underlying Promise is NOT cancelled (gc-client's awaitWithSignal would
// convert a caller-supplied AbortSignal into AbortError, which the 504 path
// doesn't recognise); it's left to settle on its own timer. Node releases
// the socket on completion, and single-flight coalescing means concurrent
// callers (e.g. the snapshot collector) still benefit from the same fetch.

/**
 * Race a Promise against a TimeoutError-named rejection after `ms` ms.
 *
 * `operation` is woven into the error message so the 504 surfaced to the
 * operator names which call timed out; it defaults to a generic label for
 * callers that don't need the distinction.
 */
export function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation = 'operation',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${operation} timed out after ${ms}ms`);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
    // Match the rest of the backend (worker.ts, dolt.ts, server.ts): an
    // unref'd timer doesn't block graceful shutdown on SIGTERM.
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
