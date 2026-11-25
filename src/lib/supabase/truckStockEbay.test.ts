import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ supabase: {} }));

import { allocateOnEbay, ebayPartFirst, ebayPartKey, ebayStockKey } from "./truckStockEbay";

describe("ebayPartFirst", () => {
  it("takes the part # off the front of a Part # cell", () => {
    expect(ebayPartFirst("5304531011 HEATER")).toBe("5304531011");
    expect(ebayPartFirst("WH16X26911 (2)")).toBe("WH16X26911");
    expect(ebayPartFirst(" wb27x25553 BOARD MACHINE CONTROL")).toBe("WB27X25553");
    expect(ebayPartFirst("BOX 5")).toBe("");
    expect(ebayPartFirst("")).toBe("");
  });
});

describe("ebayPartKey / ebayStockKey", () => {
  it("ignores case and spaces in the part #, and spelling of the branch", () => {
    expect(ebayPartKey(" wb44x39448 ")).toBe("WB44X39448");
    expect(ebayStockKey("Jackson, MS", "WB44X39448 ")).toBe(ebayStockKey("jackson ms", "wb44x39448"));
  });
  it("keeps dashes — DC93-00904D is not DC9300904D", () => {
    expect(ebayPartKey("DC93-00904D")).not.toBe(ebayPartKey("DC9300904D"));
  });
  it("is blank (never matches) without a branch or part #", () => {
    expect(ebayStockKey("", "W123")).toBe("");
    expect(ebayStockKey("Mobile", "  ")).toBe("");
  });
});

describe("allocateOnEbay", () => {
  const row = (id: string, branch: string, partNo: string, quantity: number, status: "in_stock" | "ebay" = "in_stock") => ({ id, branch, partNo, quantity, status });

  it("puts a branch's listed units on its row, never more than it holds", () => {
    const onEbay = new Map([[ebayStockKey("Mobile", "W1"), 1], [ebayStockKey("Mobile", "W2"), 5]]);
    const got = allocateOnEbay([row("a", "Mobile", "W1", 3), row("b", "Mobile", "W2", 2), row("c", "Atlanta", "W1", 4)], onEbay);
    expect(got.get("a")).toBe(1);
    expect(got.get("b")).toBe(2);
    expect(got.has("c")).toBe(false);
  });

  it("with the branch spelled two ways, fills the IN STOCK row with the most units first", () => {
    const onEbay = new Map([[ebayStockKey("Jackson, MS", "W1"), 3]]);
    const got = allocateOnEbay([row("x", "Jackson,MS", "W1", 1), row("y", "Jackson, MS", "w1", 2)], onEbay);
    expect(got.get("y")).toBe(2);
    expect(got.get("x")).toBe(1);
  });

  it("the branch's EBAY row (set aside for eBay) is filled before its IN STOCK rows (0481)", () => {
    const onEbay = new Map([[ebayStockKey("Jackson, MS", "W1"), 3]]);
    const got = allocateOnEbay(
      [row("x", "Jackson,MS", "W1", 1), row("y", "Jackson, MS", "w1", 2), row("z", "Jackson MS", "W1", 5, "ebay")],
      onEbay,
    );
    expect(got.get("z")).toBe(3);
    expect(got.has("x")).toBe(false);
    expect(got.has("y")).toBe(false);
  });

  it("a listing with no row at its branch goes to the part's one EBAY row elsewhere (0480)", () => {
    // 5304531011 listed under Columbus (Qty 2); the unit for eBay is Chattanooga's EBAY row.
    const onEbay = new Map([[ebayStockKey("Columbus", "5304531011"), 2]]);
    const got = allocateOnEbay(
      [row("ch", "Chattanooga", "5304531011", 1, "ebay"), row("ta", "Tallahassee", "5304531011", 1), row("ja", "Jacksonville", "5304531011", 1)],
      onEbay,
    );
    expect(got.get("ch")).toBe(1);
    expect(got.has("ta")).toBe(false);
    expect(got.has("ja")).toBe(false);
  });

  it("never guesses between two EBAY rows, and a same-branch row still wins", () => {
    const twoEbay = allocateOnEbay([row("a", "Jackson, MS", "P", 1, "ebay"), row("b", "Chattanooga", "P", 1, "ebay")], new Map([[ebayStockKey("Columbus", "P"), 1]]));
    expect(twoEbay.size).toBe(0);
    const own = allocateOnEbay([row("c", "Columbus", "P", 2), row("d", "Chattanooga", "P", 1, "ebay")], new Map([[ebayStockKey("Columbus", "P"), 1]]));
    expect(own.get("c")).toBe(1);
    expect(own.has("d")).toBe(false);
  });

  it("matches a part # written with a description at the listing's own branch before any EBAY row elsewhere (0481)", () => {
    // Columbus lists 5304531011 (Qty 2); Columbus's row is "5304531011 HEATER" (2); Chattanooga has an EBAY row.
    const onEbay = new Map([[ebayStockKey("Columbus", "5304531011 "), 2]]);
    const got = allocateOnEbay(
      [row("col", "Columbus", "5304531011 HEATER", 2), row("ch", "Chattanooga", "5304531011", 1, "ebay"), row("atl", "Atlanta", "5304531011 (3)", 1)],
      onEbay,
    );
    expect(got.get("col")).toBe(2);
    expect(got.has("ch")).toBe(false);
    expect(got.has("atl")).toBe(false);
    const mobile = allocateOnEbay([row("m", "Mobile", "WH16X26911 (2)", 1)], new Map([[ebayStockKey("Mobile", "WH16X26911 "), 1]]));
    expect(mobile.get("m")).toBe(1);
  });

  it("a listing with two part #s in it, or a short word, matches nothing by first word", () => {
    expect(allocateOnEbay([row("c", "Columbus", "WH16X26911 ROD/SPRING", 1)], new Map([[ebayStockKey("Columbus", "WH16X26911 and WH16X26910"), 1]])).size).toBe(0);
    expect(allocateOnEbay([row("b", "Mobile", "BOX 5", 3)], new Map([[ebayStockKey("Mobile", "BOX"), 1]])).size).toBe(0);
  });

  it("returns nothing when nothing is listed", () => {
    expect(allocateOnEbay([row("a", "Mobile", "W1", 3)], new Map()).size).toBe(0);
  });
});
