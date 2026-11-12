// https://vitejs.dev/config/
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "build",
    rollupOptions: {
      output: {
        // Libraries rarely change, so keep them in their own chunk that stays cached between deploys
        manualChunks: {
          vendor: [
            "react",
            "react-dom",
            "@mui/material",
            "@mui/system",
            "@emotion/react",
            "@emotion/styled",
          ],
        },
      },
    },
  },
  worker: {
    format: "es",
  },
  server: {
    // File change notifications are unreliable on WSL, so poll for changes instead
    watch: { usePolling: true, interval: 300 },
  },
});
