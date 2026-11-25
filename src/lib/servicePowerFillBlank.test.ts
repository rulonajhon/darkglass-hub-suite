import { describe, expect, it } from "vitest";
import { planFillBlank, spIsoDate, stillBlankFilter } from "./servicePowerFillBlank";

const sp = {
  model: "C2Y486P2TS1",
  modelVersion: "C2Y486P2TS1",
  serial: "TA904592",
  productType: "RANGE - GAS",
  type: "RANGE - GAS",
  manufacturer: "GE CAFE",
  purchaseDate: "08/11/26",
  accountNo: "GSL00002",
  account: "GE",
  claimCompany: "GE",
  callReceivedDate: "11/18/26",
  problemDescription: "burner stays on high",
  email: "a@b.c",
  phone: "8587742578",
  secondPhone: "",
  address: "315 Legacy Dr",
  address2: "",
  zip: "37340-2700",
  state: "TN",
  city: "GUILD",
  firstName: "Nicholas",
  lastName: "Ong",
  // never filled, whatever SP says
  technician: "SP TECH",
  status: "CSR-Assigned to ASC",
  schedule: "2026-11-30",
} as any;

const cols = (changes: ReturnType<typeof planFillBlank>) => changes.map((c) => `${c.table}.${c.column}`);

describe("planFillBlank", () => {
  it("fills only blank fields, never status / technician / schedule", () => {
    const row = {
      id: "t1",
      model: "",
      model_version: null,
      serial: "EXISTING",
      manufacturer: "GENERAL ELECTRIC",
      purchase_date: null,
      account: "GE",
      technician: "Spencer Granger",
      status: "OP-Ready for Service",
      customer: { id: "c1", first_name: "Nicholas", last_name: "Ong", address: "", zip: null, city: "GUILD", email: "" },
    };
    const got = planFillBlank(row, sp);
    expect(cols(got)).toEqual(
      expect.arrayContaining(["tickets.model", "tickets.model_version", "tickets.purchase_date", "tickets.problem_description", "customers.address", "customers.zip", "customers.email"]),
    );
    expect(cols(got)).not.toEqual(expect.arrayContaining(["tickets.serial"]));
    expect(cols(got)).not.toEqual(expect.arrayContaining(["tickets.manufacturer"]));
    expect(cols(got)).not.toEqual(expect.arrayContaining(["tickets.account"]));
    expect(cols(got)).not.toEqual(expect.arrayContaining(["customers.city"]));
    expect(got.some((c) => ["technician", "status", "schedule_date", "time_slot"].includes(c.column))).toBe(false);
    expect(got.find((c) => c.column === "purchase_date")?.value).toBe("2026-08-11");
    expect(got.find((c) => c.column === "zip")).toMatchObject({ table: "customers", id: "c1", value: "37340-2700" });
  });

  it("respects the edited-by-user flags", () => {
    const row = { id: "t1", model: "", account: "", claim_company: "", product_edited_by_user: true, source_edited_by_user: true, customer: { id: "c1", address: "", phone: "", edited_by_user: false, phone_edited_by_user: true } };
    const got = cols(planFillBlank(row, sp));
    expect(got).not.toEqual(expect.arrayContaining(["tickets.model"]));
    expect(got).not.toEqual(expect.arrayContaining(["tickets.account"]));
    expect(got).not.toEqual(expect.arrayContaining(["customers.phone"]));
    expect(got).toEqual(expect.arrayContaining(["customers.address"]));
    const locked = cols(planFillBlank({ id: "t1", customer: { id: "c1", address: "", edited_by_user: true } }, sp));
    expect(locked.some((c) => c.startsWith("customers."))).toBe(false);
  });

  it("skips what SP doesn't have, and a ticket with no customer", () => {
    const got = cols(planFillBlank({ id: "t1", customer: null }, { model: "" } as any));
    expect(got).toEqual([]);
  });
});

describe("spIsoDate / stillBlankFilter", () => {
  it("turns SP dates into YYYY-MM-DD", () => {
    expect(spIsoDate("07/31/25")).toBe("2025-07-31");
    expect(spIsoDate("7/1/2024")).toBe("2024-07-01");
    expect(spIsoDate("2026-11-23T00:00:00")).toBe("2026-11-23");
    expect(spIsoDate("")).toBe("");
    expect(spIsoDate("n/a")).toBe("");
  });
  it("dates are blank when null; text when null or empty", () => {
    expect(stillBlankFilter("purchase_date")).toBe("purchase_date=is.null");
    expect(stillBlankFilter("model")).toBe("or=(model.is.null,model.eq.)");
  });
});
