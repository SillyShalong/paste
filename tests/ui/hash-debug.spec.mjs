import { test } from "@playwright/test";
import { MOCK_SCRIPT } from "./mock.mjs";
import { writeFileSync } from "node:fs";

test("dump", async () => {
  writeFileSync("/tmp/generated-mock.js", MOCK_SCRIPT);
  try {
    new Function(MOCK_SCRIPT);
    console.log("SYNTAX: OK");
  } catch (e) {
    console.log("SYNTAX-ERR:", String(e).message.slice(0, 120), "line:", (e.stack?.match(/<anonymous>:(\d+)/) || [])[1]);
  }
});
