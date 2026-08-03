import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The `@/` path alias (tsconfig paths) isn't picked up by Vitest on its own,
// so mirror it here. React plugin enables JSX/TSX in component tests; those
// files opt into a DOM via a `// @vitest-environment happy-dom` docblock.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
  },
});
