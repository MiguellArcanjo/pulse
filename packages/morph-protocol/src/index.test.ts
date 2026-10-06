import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION } from "./index.ts";

test("versão do protocolo é um inteiro positivo", () => {
  assert.ok(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION > 0);
});
