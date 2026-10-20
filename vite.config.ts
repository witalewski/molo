import { defineConfig } from "vite";
export default defineConfig({
  server: {
    watch: {
      ignored: [
        "**/models/**",
        "**/.venv/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
  },
});
