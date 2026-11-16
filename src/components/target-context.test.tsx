import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { type TargetInfo, TargetProvider, useTarget } from "./target-context";

const target: TargetInfo = {
  id: "t1",
  name: "Local",
  endpointUrl: "https://e:9297",
  region: "us-east-1",
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TargetProvider target={target}>{children}</TargetProvider>
);

describe("target context", () => {
  test("exposes ids and the target's default region", () => {
    const { result } = renderHook(useTarget, { wrapper });
    expect(result.current).toMatchObject({ tid: "t1", region: "us-east-1", defaultRegion: "us-east-1" });
  });

  test("a chosen region is remembered per target", async () => {
    const first = renderHook(useTarget, { wrapper });
    act(() => first.result.current.setRegion("eu-west-1"));
    expect(first.result.current.region).toBe("eu-west-1");
    expect(first.result.current.defaultRegion).toBe("us-east-1");
    first.unmount();
    const second = renderHook(useTarget, { wrapper });
    await waitFor(() => expect(second.result.current.region).toBe("eu-west-1"));
  });

  test("another target does not inherit the region", () => {
    localStorage.setItem("region:other", "ap-south-1");
    const { result } = renderHook(useTarget, { wrapper });
    expect(result.current.region).toBe("us-east-1");
  });

  test("using it outside a target page is a clear error", () => {
    expect(() => renderHook(useTarget)).toThrow("useTarget must be used inside the target shell");
  });
});
