import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { searchJobId } from "../search";
import { AtlasProvider } from "../store";
import { SAMPLE_DATA } from "../model";
import { JobsView } from "./Jobs";

describe("JobsView", () => {
  it("focuses the exact job selected from global search", () => {
    const job = SAMPLE_DATA.jobs[0];
    render(
      <AtlasProvider isPreview>
        <JobsView
          focus={{
            requestId: "job-focus",
            itemId: job.itemFabricId,
            jobId: searchJobId(job.itemFabricId, job.jobType, job.startedAt),
            query: `${job.jobType}: ${job.itemName}`,
          }}
        />
      </AtlasProvider>,
    );

    expect(screen.getByText(`1 of ${SAMPLE_DATA.jobs.length} recorded runs`)).toBeInTheDocument();
    expect(screen.getByText(job.jobType)).toBeInTheDocument();
  });
});
