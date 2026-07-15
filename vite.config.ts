import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ["echarts"],
          vendor: ["react", "react-dom", "react-router-dom", "framer-motion", "zustand"],
          parsing: ["papaparse", "xlsx", "jszip", "fast-xml-parser"],
          exporting: ["jspdf", "pptxgenjs"],
          maplibre: ["maplibre-gl"],
          deck: ["@deck.gl/core", "@deck.gl/layers", "@deck.gl/aggregation-layers", "@deck.gl/mapbox"],
        },
      },
    },
  },
});
