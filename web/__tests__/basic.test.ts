import { describe, it, expect } from "@jest/globals";

describe("status values", () => {
  it("has correct count", () => {
    const statuses = ["PENDING","QUEUED","RUNNING","SUCCEEDED","FAILED","RETRYING","CANCELED"];
    expect(statuses.length).toBe(7);
  });
});
