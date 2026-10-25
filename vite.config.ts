import { defineConfig } from "vitest/config";

/**
 * GitHub Pages serves project sites from a sub-path, so the deployment
 * workflow injects the repo name here. Everything else defaults to the root.
 */
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // The instrument's rules live in these modules; the rest is DOM and audio
      // glue that is exercised by playing the thing.
      include: ["src/music/**/*.ts", "src/vision/gestures.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
