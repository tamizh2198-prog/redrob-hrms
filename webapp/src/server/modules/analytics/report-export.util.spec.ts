import { toCsv, neutralizeFormula } from "./report-export.util";

describe("report-export.util: formula injection (HRMS-09)", () => {
  it("prefixes a leading quote onto formula-trigger characters", () => {
    expect(neutralizeFormula("=HYPERLINK(\"http://evil\",\"x\")")).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
    expect(neutralizeFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeFormula("-1+1")).toBe("'-1+1");
    expect(neutralizeFormula("@SUM(1,1)")).toBe("'@SUM(1,1)");
    expect(neutralizeFormula("\t=1")).toBe("'\t=1");
  });

  it("leaves ordinary text untouched", () => {
    expect(neutralizeFormula("Jane Doe")).toBe("Jane Doe");
    expect(neutralizeFormula("jane@example.com")).toBe("jane@example.com".replace(/^/, "")); // no leading trigger char
  });

  it("neutralizes a malicious cell value in a real CSV export", () => {
    const csv = toCsv({
      entity: "Candidate",
      total: 1,
      rows: [{ id: "c-1", name: '=HYPERLINK("http://evil","click me")' }],
    });
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/^id,name\nc-1,=HYPERLINK/);
  });

  it("does not mangle a legitimate negative number", () => {
    const csv = toCsv({ entity: "Report", total: 1, rows: [{ id: "r-1", amount: -500 }] });
    expect(csv).toContain("-500");
    expect(csv).not.toContain("'-500");
  });
});
