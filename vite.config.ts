// https://vitejs.dev/config/
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "build",
  },
  worker: {
    format: "es",
  },
  server: {
    // File change notifications are unreliable on WSL, so poll for changes instead
    watch: { usePolling: true, interval: 300 },
  },
});
