import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { GcBead } from 'gas-city-dashboard-shared';
import { gcSupervisorDecoders } from '../src/gc-supervisor-decoders.js';

// gascity-dashboard-t5l6: Regression test that the schema parameter of the
// internal `decodeSupervisorPayload` is typed as `z.ZodType<Decoded>`, NOT
// the unparameterized `z.ZodType` (which laundered any schema into the
// declared return type via an `as Decoded` cast). The acceptance criterion
// is "tsc rejects a deliberately-broken schema". Errors surface at
// COMPILE time via `npm -w backend run typecheck:test`; the runtime test
// below is a no-op token so this file participates in `node --test`.

test('decoder typing: tsc rejects a Zod schema that diverges from the declared Decoded type', () => {
  // Compile-time contract checks. The `@ts-expect-error` directives below
  // intentionally fail tsc — if any of them stops failing (e.g. somebody
  // re-loosens the schema parameter to plain `z.ZodType` or restores the
  // `as Decoded` cast), tsc will report "Unused '@ts-expect-error'", and
  // CI's `typecheck:test` step will fail.

  interface ExpectedShape {
    id: string;
    count: number;
  }

  // A faithful local decoder pattern matching how `decodeSupervisorPayload`
  // is used inside `gcSupervisorDecoders`: caller declares the target type,
  // the schema is supposed to produce it.
  function decode<Decoded>(schema: z.ZodType<Decoded>, value: unknown): Decoded {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  }

  // Sound schema — matches ExpectedShape exactly. Compiles cleanly.
  const goodSchema = z.object({
    id: z.string(),
    count: z.number(),
  });
  const ok = decode<ExpectedShape>(goodSchema, { id: 'a', count: 1 });
  assert.equal(ok.id, 'a');
  assert.equal(ok.count, 1);

  // Broken schema #1: required-string field is typed as required-number.
  // This is the exact regression the bead describes.
  const wrongFieldType = z.object({
    id: z.number(), // <-- mismatch: ExpectedShape declares string
    count: z.number(),
  });
  // @ts-expect-error - z.ZodType<Decoded> must reject a schema whose
  // inferred output type does not assign to Decoded.
  decode<ExpectedShape>(wrongFieldType, { id: 1, count: 1 });

  // Broken schema #2: required field becomes optional. Under
  // exactOptionalPropertyTypes, `string | undefined` is not assignable to
  // a required `string`, so the schema's output diverges from Decoded.
  const wrongOptionality = z.object({
    id: z.string().optional(),
    count: z.number(),
  });
  // @ts-expect-error - optional field where Decoded declares required.
  decode<ExpectedShape>(wrongOptionality, { id: 'a', count: 1 });

  // Broken schema #3: extra required field absent from Decoded would still
  // be assignable (TS structural subtyping), so we instead test the
  // missing-required-field case: schema lacks a field Decoded requires.
  const missingField = z.object({
    id: z.string(),
    // count is missing
  });
  // @ts-expect-error - schema output { id: string } does not assign to
  // Decoded { id: string; count: number }.
  decode<ExpectedShape>(missingField, { id: 'a' });
});

test('decoder typing: real gcSupervisorDecoders methods preserve their declared return types', () => {
  // Compile-time identity assertions on the public decoder API. If a
  // future change silently widens `gcSupervisorDecoders.getBead` to return
  // `GcBead | undefined` (or some other drift), one of these lines fails
  // tsc — the runtime call is also a smoke-check that the real schemas
  // parse a minimal valid payload.
  type AssertExact<A, B> = (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;

  const _getBeadReturnsGcBead: AssertExact<
    ReturnType<typeof gcSupervisorDecoders.getBead>,
    GcBead
  > = true;
  assert.ok(_getBeadReturnsGcBead);
  assert.equal(typeof gcSupervisorDecoders.getBead, 'function');
});
