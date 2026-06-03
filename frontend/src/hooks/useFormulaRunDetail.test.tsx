import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { invalidate } from "../api/cache";
import { reportClientError } from "../lib/clientErrorReporting";
import { supervisorApi } from "../supervisor/client";
import { useFormulaRunDetail } from "./useFormulaRunDetail";

vi.mock("../api/cityBase", () => ({
  getActiveCity: () => "test-city",
}));

vi.mock("../lib/clientErrorReporting", () => ({
  reportClientError: vi.fn(() => Promise.resolve({ status: "reported" })),
}));

vi.mock("../supervisor/client", () => ({
  supervisorApi: vi.fn(),
}));

const mockReportClientError = reportClientError as Mock;
const mockSupervisorApi = supervisorApi as Mock;
const supervisor = {
  workflowRun: vi.fn(),
  listSessions: vi.fn(),
  formulaDetail: vi.fn(),
};

afterEach(() => {
  cleanup();
  invalidate("");
  vi.clearAllMocks();
  supervisor.workflowRun.mockReset();
  supervisor.listSessions.mockReset();
  supervisor.formulaDetail.mockReset();
  mockSupervisorApi.mockReturnValue(supervisor);
});

describe("useFormulaRunDetail", () => {
  beforeEach(() => {
    mockSupervisorApi.mockReturnValue(supervisor);
    supervisor.workflowRun.mockResolvedValue(workflowSnapshot());
    supervisor.listSessions.mockResolvedValue({ items: [], total: 0 });
    supervisor.formulaDetail.mockResolvedValue(formulaDetail());
  });

  it("does not fetch or report when no run id is available", async () => {
    const { result } = renderHook(() => useFormulaRunDetail(undefined));

    await waitFor(() => expect(result.current.kind).toBe("idle"));

    expect(supervisor.workflowRun).not.toHaveBeenCalled();
    expect(mockReportClientError).not.toHaveBeenCalled();
  });

  it("reports run detail load failures to the centralized client log", async () => {
    supervisor.workflowRun.mockRejectedValue(new Error("detail unavailable"));

    const { result } = renderHook(() => useFormulaRunDetail("wf-1"));

    await waitFor(() =>
      expect(result.current).toMatchObject({
        kind: "failed",
        error: "detail unavailable",
      }),
    );

    expect(mockReportClientError).toHaveBeenCalledWith({
      component: "formula-run-detail",
      operation: "load detail",
      message: "wf-1: detail unavailable",
    });
    expect(supervisor.formulaDetail).not.toHaveBeenCalled();
  });

  it("loads formula run detail from the direct supervisor workflow endpoint", async () => {
    const { result } = renderHook(() =>
      useFormulaRunDetail("wf-1", "city", "test-city"),
    );

    await waitFor(() => expect(result.current.kind).toBe("ready"));

    if (result.current.kind !== "ready")
      throw new Error("run detail did not load");
    expect(result.current.detail.runId).toBe("wf-1");
    expect(result.current.detail.title).toBe("Direct supervisor run");
    expect(result.current.detail.formulaDetail).toEqual({
      kind: "available",
      name: "mol-test",
      target: "test-city/codex",
    });
    expect(result.current.refreshState).toEqual({ kind: "idle" });
    expect("diff" in result.current).toBe(false);
    expect(supervisor.workflowRun).toHaveBeenCalledWith("test-city", "wf-1", {
      scope_kind: "city",
      scope_ref: "test-city",
    });
    expect(supervisor.formulaDetail).toHaveBeenCalledWith("test-city", "mol-test", {
      target: "test-city/codex",
      scope_kind: "city",
      scope_ref: "test-city",
    });
    expect(mockReportClientError).not.toHaveBeenCalled();
  });

  it("does not stay loading for completed runs that lack formula metadata", async () => {
    supervisor.workflowRun.mockResolvedValue(workflowSnapshot({
      status: "completed",
      metadata: {
        "gc.kind": "workflow",
        "gc.formula_contract": "graph.v2",
        "gc.run_target": "test-city/codex",
      },
    }));

    const { result } = renderHook(() =>
      useFormulaRunDetail("wf-1", "city", "test-city"),
    );

    await waitFor(() => expect(result.current.kind).toBe("ready"));

    if (result.current.kind !== "ready")
      throw new Error("run detail did not load");
    expect(result.current.detail.formula).toEqual({
      kind: "unavailable",
      reason: "missing_formula_metadata",
    });
    expect(result.current.detail.formulaDetail).toEqual({
      kind: "unavailable",
      reason: "missing_formula_metadata",
    });
    expect(supervisor.formulaDetail).not.toHaveBeenCalled();
    expect(mockReportClientError).not.toHaveBeenCalled();
  });
});

function workflowSnapshot(overrides: {
  status?: string;
  metadata?: Record<string, string>;
} = {}) {
  return {
    workflow_id: "wf-1",
    root_bead_id: "wf-1",
    root_store_ref: "city:test-city",
    resolved_root_store: "city:test-city",
    scope_kind: "city",
    scope_ref: "test-city",
    snapshot_version: 1,
    snapshot_event_seq: 1,
    partial: false,
    stores_scanned: ["city:test-city"],
    beads: [
      {
        id: "wf-1",
        title: "Direct supervisor run",
        status: overrides.status ?? "in_progress",
        kind: "workflow",
        metadata: overrides.metadata ?? {
          "gc.kind": "workflow",
          "gc.formula_contract": "graph.v2",
          "gc.formula": "mol-test",
          "gc.run_target": "test-city/codex",
        },
      },
    ],
    deps: [],
    logical_nodes: [],
    logical_edges: [],
    scope_groups: [],
  };
}

function formulaDetail() {
  return {
    name: "mol-test",
    description: "formula detail",
    version: "v1",
    preview: {
      nodes: [{ id: "wf-1", title: "Direct supervisor run", kind: "workflow" }],
      edges: [],
    },
    steps: [],
    deps: [],
    var_defs: [],
  };
}
