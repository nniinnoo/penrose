import * as nearley from "nearley";
import grammar from "./SubstanceParser";
import * as path from "path";
import * as fs from "fs";
import { result } from "lodash";

const outputDir = "/tmp/asts";
const saveASTs = true;

let parser: nearley.Parser;
const sameASTs = (results: any[]) => {
  for (const p of results) expect(results[0]).toEqual(p);
  expect(results.length).toEqual(1);
};

// USAGE:
// printAST(results[0])
const printAST = (ast: any) => {
  console.log(JSON.stringify(ast));
};

const subPaths = [];

beforeEach(() => {
  // NOTE: Neither `feed` nor `finish` will reset the parser state. Therefore recompiling before each unit test
  parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
});

describe("Common", () => {
  test("empty program", () => {
    const { results } = parser.feed("");
    sameASTs(results);
  });
  test("comments", () => {
    const prog = `
-- Top-level comments
Set A, B, C, D, E, F, G -- inline comments

/*
IsSubset(B, A)
IsSubset(C, A)
IsSubset(D, B)
IsSubset(E, B)
IsSubset(F, C)
IsSubset(G, C)
*/

-- Not(Intersecting(E, D))
Set C
-- Not(Intersecting(B, C))
AutoLabel All

/* Other comments */

    `;
    const { results } = parser.feed(prog);
    sameASTs(results);
  });
});

describe("statements", () => {
  test("decl and decl list", () => {
    const prog = `
Set A
Map f, g, h
List(Set) l
List(Map) l1
    `;
    const { results } = parser.feed(prog);
    sameASTs(results);
    expect(results[0].statements.map((s: any) => s.name.value)).toEqual([
      "A",
      "f",
      "g",
      "h",
      "l",
      "l1",
    ]);
  });
  test("label decl", () => {
    const prog = `
Set A, B, C
Label A $\\vec{A}$
Label B $B_1$
    `;
    const { results } = parser.feed(prog);
    sameASTs(results);
    expect(results[0].statements[3].label.contents).toEqual("\\vec{A}");
    expect(results[0].statements[4].label.contents).toEqual("B_1");
  });
  test("no label decl", () => {
    const prog = `
Set A, B, C
NoLabel A
NoLabel B, C
    `;
    const { results } = parser.feed(prog);
    sameASTs(results);
    expect(results[0].statements[3].args[0].value).toEqual("A");
    expect(results[0].statements[4].args.map((a: any) => a.value)).toEqual([
      "B",
      "C",
    ]);
  });
  test("auto label decl", () => {
    const prog = `
Set A, B, C
AutoLabel All
AutoLabel B, C
NoLabel B, C
    `;
    const { results } = parser.feed(prog);
    sameASTs(results);
    expect(results[0].statements[3].option.tag).toEqual("DefaultLabels");
    expect(
      results[0].statements[4].option.variables.map((a: any) => a.value)
    ).toEqual(["B", "C"]);
  });
  test("bind and exprs", () => {
    const prog = `
Set A, B, C
Point p1, p2
C := Intersection(A, B)
p1 := ValueOf(A.value)
p2 := ValueOf(Translate(p), "10, 20")
    `;
    const { results } = parser.feed(prog);
    sameASTs(results);
  });
  test("predicates", () => {
    const prog = `
Set A, B, C
IsSubset(A, B)
Not(IsSubset(A, B))
    `;
    const { results } = parser.feed(prog);
    sameASTs(results);
  });
  test("predicates", () => {
    const prog = `
Set A, B, C
IsSubset(Not(A), B) <-> IsSubset(B, C)
CreateSubset(A, B) = CreateSubset(B, C)
    `;
    const { results } = parser.feed(prog);
    sameASTs(results);
    printAST(results[0]);
  });
});
