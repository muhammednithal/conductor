import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RunsListPage } from "../src/runs/RunsListPage";
import { RunDetailPage } from "../src/runs/RunDetailPage";
import * as client from "../src/api/client";

jest.mock("../src/api/client", () => ({
  api: { listRuns: jest.fn(), getRun: jest.fn() },
  getToken: jest.fn(() => "tok"),
}));

jest.mock("../src/hooks/useRunStream", () => ({
  useRunStream: jest.fn(),
}));

const RUN_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const mockRuns = [
  { id: RUN_ID, workflow_id: "wf1", status: "SUCCEEDED", started_at: new Date().toISOString(), completed_at: null },
  { id: "bbbbbbbb-0000-0000-0000-000000000002", workflow_id: "wf1", status: "RUNNING", started_at: new Date().toISOString(), completed_at: null },
];

describe("RunsListPage", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.api.listRuns as any).mockResolvedValue(mockRuns);
  });

  it("renders runs table with status badges", async () => {
    render(<MemoryRouter><RunsListPage /></MemoryRouter>);
    expect(await screen.findByText("SUCCEEDED")).toBeTruthy();
    expect(screen.getByText("RUNNING")).toBeTruthy();
  });
});

describe("RunDetailPage", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.api.getRun as any).mockResolvedValue({
      ...mockRuns[0],
      step_executions: [
        { id: "se1", step_name: "step-a", step_type: "delay", status: "SUCCEEDED", attempt_count: 1, error_msg: null },
      ],
    });
  });

  it("renders step execution table with correct step name", async () => {
    render(
      <MemoryRouter initialEntries={[`/runs/${RUN_ID}`]}>
        <Routes><Route path="/runs/:id" element={<RunDetailPage />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("step-a")).toBeTruthy();
  });
});