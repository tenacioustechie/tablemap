import {
  activePings,
  addPing,
  createPing,
  isPing,
  isPingActive,
  PING_DURATION_MS,
  PING_MAX,
  pingProgress,
  pingsExpireAt,
  type Ping,
} from "./ping";

const T = 1_700_000_000_000;
const ping = (id: string, at: number, mapId = "m"): Ping => ({ id, mapId, x: 1, y: 2, at });

describe("pings (T011)", () => {
  it("createPing stamps an id and the time; isPing guards the shape", () => {
    const p = createPing({ mapId: "m", x: 3, y: 4, id: "p", now: T });
    expect(p).toEqual({ id: "p", mapId: "m", x: 3, y: 4, at: T });
    const auto = createPing({ mapId: "m", x: 0, y: 0 });
    expect(auto.id.length).toBeGreaterThan(0);
    expect(Math.abs(auto.at - Date.now())).toBeLessThan(1000);
    expect(isPing(p)).toBe(true);
    expect(isPing({ ...p, id: "" })).toBe(false);
    expect(isPing({ ...p, mapId: 1 })).toBe(false);
    expect(isPing({ ...p, x: Infinity })).toBe(false);
    expect(isPing({ id: "p", mapId: "m", x: 0, y: 0 })).toBe(false);
    expect(isPing(null)).toBe(false);
  });

  it("a ping is active from its timestamp until PING_DURATION_MS later, never before", () => {
    const p = ping("p", T);
    expect(isPingActive(p, T - 1)).toBe(false);
    expect(isPingActive(p, T)).toBe(true);
    expect(isPingActive(p, T + PING_DURATION_MS - 1)).toBe(true);
    expect(isPingActive(p, T + PING_DURATION_MS)).toBe(false);
    expect(pingProgress(p, T)).toBe(0);
    expect(pingProgress(p, T + PING_DURATION_MS / 2)).toBe(0.5);
    expect(pingProgress(p, T + PING_DURATION_MS * 3)).toBe(1);
    expect(pingProgress(p, T - 500)).toBe(0);
  });

  it("addPing appends, drops pings already expired at the new one's time, ignores duplicate ids and caps the list", () => {
    let list: readonly Ping[] = [];
    list = addPing(list, ping("a", T));
    list = addPing(list, ping("b", T + 100));
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
    // Copies, not aliases.
    const a = ping("a", T);
    const same = addPing([], a);
    expect(same[0]).toEqual(a);
    expect(same[0]).not.toBe(a);

    const dup = addPing(list, ping("a", T + 200));
    expect(dup).toBe(list);

    list = addPing(list, ping("c", T + PING_DURATION_MS + 50));
    expect(list.map((p) => p.id)).toEqual(["b", "c"]); // a had expired by then, b (sent at T + 100) not yet
    list = addPing(list, ping("d", T + PING_DURATION_MS + 150));
    expect(list.map((p) => p.id)).toEqual(["c", "d"]);

    let many: readonly Ping[] = [];
    for (let i = 0; i < PING_MAX + 5; i++) many = addPing(many, ping(`p${i}`, T + i));
    expect(many).toHaveLength(PING_MAX);
    expect(many[0].id).toBe("p5");
    expect(many[many.length - 1].id).toBe(`p${PING_MAX + 4}`);
  });

  it("activePings filters by time and map; pingsExpireAt is when the last active one ends", () => {
    const list = [ping("a", T), ping("b", T + 500, "other"), ping("c", T - PING_DURATION_MS)];
    expect(activePings(list, T + 100).map((p) => p.id)).toEqual(["a"]);
    expect(activePings(list, T + 600).map((p) => p.id)).toEqual(["a", "b"]);
    expect(activePings(list, T + 600, "other").map((p) => p.id)).toEqual(["b"]);
    expect(activePings(list, T + 600, "m").map((p) => p.id)).toEqual(["a"]);
    expect(activePings(list, T + PING_DURATION_MS + 600)).toEqual([]);
    expect(pingsExpireAt(list, T + 600)).toBe(T + 500 + PING_DURATION_MS);
    expect(pingsExpireAt(list, T + 100)).toBe(T + PING_DURATION_MS);
    expect(pingsExpireAt(list, T + 10_000)).toBe(T + 10_000);
    expect(pingsExpireAt([], T)).toBe(T);
  });
});
