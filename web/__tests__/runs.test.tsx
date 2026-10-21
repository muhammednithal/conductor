import { describe, it, expect } from "@jest/globals";

describe("status values", () => {
  it("has correct statuses", () => {
    const statuses = ["PENDING","QUEUED","RUNNING","SUCCEEDED","FAILED","RETRYING","CANCELED"];
    expect(statuses).toHaveLength(7);
  });
});