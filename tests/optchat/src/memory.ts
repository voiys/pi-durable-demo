// Test-only shim: upstream's tests construct `new Memory(dir, ...)` over files. Our Memory takes a store instead
// (src/optchat/memory.ts), so this hands it upstream's own FileStore. Everything else is our code, unchanged.
import { Memory as Ours, type Compressor } from "../../../src/optchat/memory.ts";
import { FileStore } from "./store.ts";

export * from "../../../src/optchat/memory.ts";

export class Memory extends Ours {
  constructor(directory: string, compress: Compressor, warn: (s: string) => void = console.error, budget?: number, jobs?: number, retryMs?: number) {
    const store = new FileStore(directory, warn);
    super({ store, saved: store.load() }, compress, warn, budget, jobs, retryMs);
  }
}
