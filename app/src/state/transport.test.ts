import {
  createBroadcastTransport,
  createMemoryHub,
  createNullTransport,
} from "./transport";

describe("memory hub transport", () => {
  it("fans out to other endpoints but never echoes to the sender", () => {
    const hub = createMemoryHub();
    const a = hub.connect();
    const b = hub.connect();
    const c = hub.connect();
    const gotA = vi.fn();
    const gotB = vi.fn();
    const gotC = vi.fn();
    a.onMessage(gotA);
    b.onMessage(gotB);
    c.onMessage(gotC);

    a.post("from-a");
    expect(gotA).not.toHaveBeenCalled();
    expect(gotB).toHaveBeenCalledWith("from-a");
    expect(gotC).toHaveBeenCalledWith("from-a");
    expect(hub.log).toEqual([{ from: 0, raw: "from-a" }]);
  });

  it("unsubscribe and close stop delivery", () => {
    const hub = createMemoryHub();
    const a = hub.connect();
    const b = hub.connect();
    const gotB = vi.fn();
    const off = b.onMessage(gotB);
    off();
    a.post("1");
    expect(gotB).not.toHaveBeenCalled();

    b.onMessage(gotB);
    b.close();
    a.post("2");
    expect(gotB).not.toHaveBeenCalled();

    const gotA = vi.fn();
    a.onMessage(gotA);
    b.post("after-close");
    expect(gotA).not.toHaveBeenCalled();
  });
});

describe("broadcast transport", () => {
  it("delivers strings between channels of the same name and drops non-strings", async () => {
    if (typeof BroadcastChannel === "undefined") return; // jsdom without BC
    const name = `test-${Math.random()}`;
    const a = createBroadcastTransport(name);
    const b = createBroadcastTransport(name);
    const other = createBroadcastTransport(`${name}-other`);
    const gotB = vi.fn();
    const gotOther = vi.fn();
    b.onMessage(gotB);
    other.onMessage(gotOther);

    a.post("hi");
    new BroadcastChannel(name).postMessage({ not: "a string" });
    await vi.waitFor(() => expect(gotB).toHaveBeenCalledWith("hi"));
    await new Promise((r) => setTimeout(r, 10));
    expect(gotB).toHaveBeenCalledTimes(1);
    expect(gotOther).not.toHaveBeenCalled();

    a.close();
    b.close();
    other.close();
    expect(() => a.post("after-close")).not.toThrow();
  });
});

describe("null transport", () => {
  it("accepts posts and subscriptions without delivering anything", () => {
    const t = createNullTransport();
    const got = vi.fn();
    const off = t.onMessage(got);
    t.post("x");
    off();
    t.close();
    expect(got).not.toHaveBeenCalled();
  });
});
