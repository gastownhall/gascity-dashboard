// gascity-dashboard-brx: unit coverage for the shared redaction-test
// wire-error narrowing helper. The helper replaces ~9 ad-hoc
// `res.body.details as { name?: string; ... }` casts across the
// redaction-layer tests (agents-prime, beads-nudge,
// maintainer-sling, git-commits). The casts silenced the type system
// without validating shape — a wire change that flipped `details` from
// object to string would have slipped through as a runtime
// `cannot read properties of string` deep inside an assertion.
//
// The helper has two entry points:
//   - assertWireDetails(v): throws on undefined/null/non-object/array,
//     used by sites that pin "details MUST be present".
//   - isWireDetails(v): boolean guard, used by the one tolerant site
//     in agents-prime.test.ts that asserts "if details is present,
//     it must not carry raw stderr" (404 not-configured wire shape).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWireDetails,
  isWireDetails,
  type WireDetails,
} from './helpers/wire.js';

describe('assertWireDetails', () => {
  test('narrows a plain object with a string `name` so all fields are readable', () => {
    const v: unknown = { name: 'NonZeroExit' };
    assertWireDetails(v);
    // After the assertion, TS knows v is WireDetails. Read fields directly.
    assert.equal(v.name, 'NonZeroExit');
    assert.equal(v.message, undefined);
    assert.equal(v.stderr, undefined);
  });

  test('throws on an object missing the required `name` discriminator (gascity-dashboard-brx.1)', () => {
    // The whole point of the brx.1 tightening: a wire change that drops
    // `details.name` (the Error-class discriminator every redaction site
    // asserts on) must fail loudly at the contract boundary, not deep
    // inside `assert.equal(undefined, 'NonZeroExit')`.
    assert.throws(() => assertWireDetails({}), /wire details/i);
    assert.throws(() => assertWireDetails({ stderr: 'leak' }), /wire details/i);
  });

  test('throws on an object whose `name` is not a string', () => {
    // Soundness: the type predicate says `name: string`, so the runtime
    // guard must reject non-string `name` values too — otherwise the
    // type is a lie.
    assert.throws(() => assertWireDetails({ name: 42 }), /wire details/i);
    assert.throws(() => assertWireDetails({ name: null }), /wire details/i);
  });

  test('throws on undefined', () => {
    assert.throws(() => assertWireDetails(undefined), /wire details/i);
  });

  test('throws on null', () => {
    assert.throws(() => assertWireDetails(null), /wire details/i);
  });

  test('throws on a primitive', () => {
    assert.throws(() => assertWireDetails('NonZeroExit'), /wire details/i);
    assert.throws(() => assertWireDetails(42), /wire details/i);
    assert.throws(() => assertWireDetails(true), /wire details/i);
  });

  test('throws on an array (typeof array === "object" trap)', () => {
    assert.throws(() => assertWireDetails([]), /wire details/i);
    assert.throws(
      () => assertWireDetails([{ name: 'NonZeroExit' }]),
      /wire details/i,
    );
  });
});

describe('isWireDetails', () => {
  test('returns true for a plain object carrying a string `name`', () => {
    const v: unknown = { name: 'NonZeroExit', stderr: 'foo' };
    assert.equal(isWireDetails(v), true);
    if (isWireDetails(v)) {
      const narrowed: WireDetails = v;
      assert.equal(narrowed.name, 'NonZeroExit');
    }
  });

  test('returns false for an object missing the required `name` (gascity-dashboard-brx.1)', () => {
    assert.equal(isWireDetails({}), false);
    assert.equal(isWireDetails({ stderr: 'leak' }), false);
  });

  test('returns false for non-string `name`', () => {
    assert.equal(isWireDetails({ name: 42 }), false);
    assert.equal(isWireDetails({ name: null }), false);
  });

  test('returns false for undefined / null / primitive / array', () => {
    assert.equal(isWireDetails(undefined), false);
    assert.equal(isWireDetails(null), false);
    assert.equal(isWireDetails('x'), false);
    assert.equal(isWireDetails(42), false);
    assert.equal(isWireDetails([]), false);
    assert.equal(isWireDetails([{ name: 'x' }]), false);
  });
});
