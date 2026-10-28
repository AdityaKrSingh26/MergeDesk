import { describe, expect, it } from "vitest";
import { beatsFromUserFlow } from "@/app/r/[id]/userFlowBeats";
import type { UserFlow } from "@/server/shared";

const sugarizerFlow: UserFlow = {
  nodes: [
    { id: "host", label: "Host", kind: "actor" },
    { id: "guest", label: "Guest", kind: "actor" },
    { id: "system", label: "System", kind: "action" },
    { id: "user", label: "User", kind: "actor" },
  ],
  edges: [
    { from: "guest", to: "system", label: "attempt model change" },
    { from: "system", to: "user", label: "show image saved confirmation" },
  ],
};

describe("beatsFromUserFlow", () => {
  it("keeps disconnected actors in roles and turns each edge into a slip", () => {
    const slip = beatsFromUserFlow(sugarizerFlow);
    expect(slip.roles.map((r) => r.label)).toEqual(["Host"]);
    expect(slip.beats).toHaveLength(2);
    expect(slip.beats[0]).toMatchObject({
      fromLabel: "Guest",
      toLabel: "System",
      label: "attempt model change",
    });
    expect(slip.beats[1]).toMatchObject({
      fromLabel: "System",
      toLabel: "User",
      label: "show image saved confirmation",
    });
  });

  it("drops edges whose endpoints are missing and uses then when the verb is blank", () => {
    const slip = beatsFromUserFlow({
      nodes: [{ id: "a", label: "App", kind: "actor" }],
      edges: [
        { from: "a", to: "missing", label: "call" },
        { from: "a", to: "a", label: "  " },
      ],
    });
    expect(slip.beats).toEqual([
      {
        fromId: "a",
        fromLabel: "App",
        fromKind: "actor",
        toId: "a",
        toLabel: "App",
        toKind: "actor",
        label: "then",
      },
    ]);
  });

  it("returns roles only when the graph has no edges", () => {
    const slip = beatsFromUserFlow({
      nodes: [{ id: "dev", label: "Developer", kind: "actor" }],
      edges: [],
    });
    expect(slip.roles).toEqual([{ id: "dev", label: "Developer" }]);
    expect(slip.beats).toEqual([]);
  });
});
