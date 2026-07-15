import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: "public",
    rollupOptions: {
      input: {
        admin: "src/admin/main.jsx",
      },
      output: {
        entryFileNames: "dist/[name].js",
        chunkFileNames: "dist/[name].js",
        assetFileNames: "dist/[name][extname]",
      },
    },
  },
});
