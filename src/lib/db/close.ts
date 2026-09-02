import { closeJsDatabaseHandle } from "./connection";
import { flushWriteBuffer } from "./measurementStore";
import { flushRawWriteBuffer } from "./rawStore";

export async function closeJsDatabase(): Promise<void> {
  await flushWriteBuffer();
  await flushRawWriteBuffer();
  await closeJsDatabaseHandle();
}
