import { config } from 'zod'

// VS Code 1.144 remote extension hosts install a throwing `navigator` getter
// (`PendingMigrationError: navigator is now a global in nodejs`). zod's
// `allowsEval()` reads `navigator.userAgent` while MCP SDK schemas are created
// at module load, which aborts extension activation. `jitless` makes
// `allowsEval()` return false before it touches `navigator`; it must run before
// any module that imports zod builds a schema.
config({ jitless: true })
