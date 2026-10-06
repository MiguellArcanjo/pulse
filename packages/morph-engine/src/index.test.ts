import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION } from "@morph/protocol";
import { ENGINE_PROTOCOL_VERSION } from "./index.ts";

test("engine e protocolo falam a mesma versão", () => {
  assert.equal(ENGINE_PROTOCOL_VERSION, PROTOCOL_VERSION);
});
