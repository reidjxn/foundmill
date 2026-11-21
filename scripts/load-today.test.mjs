import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, percentile, todayPath } from "./load-today.mjs";

const BIZ = "11111111-1111-4111-8111-111111111111";

test("percentile is nearest-rank on known arrays", () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(ten, 50), 5);
  assert.equal(percentile(ten, 95), 10);
  assert.equal(percentile(ten, 0), 1);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 50), 0);
});

test("--users 25,50,100 parses, with defaults for rounds", () => {
  const o = parseArgs(["--url", "http://localhost:4000/", "--business", BIZ, "--users", "25,50,100"]);
  assert.deepEqual(o, { url: "http://localhost:4000", business: BIZ, users: [25, 50, 100], rounds: 3, json: false });
});

test("a bearer passed as an argument is refused", () => {
  for (const argv of [["--bearer", "x"], ["--token=x"], ["eyJhbGciOi.x.y"], ["Bearer abc"]]) {
    assert.throws(() => parseArgs(["--url", "https://a", "--business", BIZ, ...argv]), /FM_BEARER/);
  }
});

test("bad input is refused", () => {
  assert.throws(() => parseArgs(["--business", BIZ]), /--url/);
  assert.throws(() => parseArgs(["--url", "http://api.example.com", "--business", BIZ]), /https/);
  assert.throws(() => parseArgs(["--url", "https://a", "--business", "nope"]), /--business/);
  assert.throws(() => parseArgs(["--url", "https://a", "--business", BIZ, "--users", "25,x"]), /--users/);
});

test("the request is the Today screen's batch", () => {
  const path = todayPath(BIZ);
  assert.match(path, /^\/trpc\/today\.get,today\.visit\?batch=1&input=/);
  const input = JSON.parse(decodeURIComponent(path.split("input=")[1]));
  assert.deepEqual(input, { 0: { json: { businessId: BIZ } }, 1: { json: { businessId: BIZ } } });
});
