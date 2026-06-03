// gascity-dashboard-brx: shared narrowing for redaction-layer wire-error
// tests. The redaction tests across agents-prime, beads-nudge,
// maintainer-sling, and git-commits all repeat the same ad-hoc cast:
//
//   const details = res.body.details as { name?: string; message?: string };
//
// That cast silences the type system without validating shape — a wire
// change that flipped `details` from object to string would slip through
// as a runtime `cannot read properties of string` deep inside an
// assertion, far from the actual contract violation. Centralising
// here means:
//   - the shape (`WireDetails`) lives in one place and lines up 1:1
//     with sanitise-error.ts's `toWireInternal500` body.details +
//     the agents.ts NonZeroExit `details` arm,
//   - the runtime guard rejects every non-object input (undefined,
//     null, primitives, arrays — typeof [] === 'object' is the trap),
//   - call sites get clean property access without re-casting.
//
// Two entry points, deliberately:
//   - `assertWireDetails`: throws. Use where the wire contract pins
//     details as PRESENT (the redacted-but-discriminator-bearing
//     500/502 responses).
//   - `isWireDetails`: boolean guard. Use where the contract is
//     "if present, must not carry forbidden fields" (the 404
//     not-configured arm in agents-prime tolerates `details ===
//     undefined`).

/**
 * The fields the redaction-layer tests read off `res.body.details`.
 * `name` is the Error-class discriminator `toWireInternal500` always
 * sets and every redaction site asserts on — it is REQUIRED, so a
 * wire change that drops it is a compile-time error at the consumer
 * rather than a runtime `assert.equal(undefined, 'NonZeroExit')`.
 * `message` and `stderr` are the fields the tests assert MUST be
 * absent (forbidden raw err.message / raw subprocess stderr).
 * Keeping the shape a superset lets a single helper serve every site
 * without per-call generics.
 */
export interface WireDetails {
  name: string;
  message?: string;
  stderr?: string;
}

/**
 * Object-shape + discriminator check. Rejects null, arrays, and
 * primitives (`typeof [] === 'object'` so the Array.isArray guard is
 * load-bearing); also rejects objects missing a string `name` so the
 * `value is WireDetails` predicate is sound at runtime — a type
 * predicate that doesn't enforce its claims is a lie.
 */
export function isWireDetails(value: unknown): value is WireDetails {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string';
}

/**
 * Assertion variant: throws AssertionError with a descriptive message
 * naming what was actually received, so a regression that flips
 * `details` to a string, drops it entirely, or drops the `name`
 * discriminator fails at the contract boundary instead of at the
 * next property read.
 */
export function assertWireDetails(
  value: unknown,
): asserts value is WireDetails {
  if (!isWireDetails(value)) {
    const kind =
      value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : typeof value === 'object'
            ? `object missing string \`name\` (got ${typeof (value as { name?: unknown }).name})`
            : typeof value;
    throw new Error(
      `expected wire details to be a plain object with a string \`name\`, got ${kind}`,
    );
  }
}
