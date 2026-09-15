// Some dependencies use Node's global Buffer; this runs before them in the browser bundle.
import { Buffer } from "buffer";

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
