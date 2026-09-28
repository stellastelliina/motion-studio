/**
 * Config for the Remotion CLI and Studio. The Node.js APIs ignore this file.
 * All options: https://remotion.dev/docs/config
 */

import path from "path";
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
// Three.js, @remotion/effects and HtmlInCanvas shaders need a real GL backend in headless renders.
Config.setChromiumOpenGlRenderer("angle");
// Port reserved with portsage for this project.
Config.setStudioPort(4450);
// `@/` points to `src/`, mirrored in tsconfig.json `paths`.
Config.overrideBundlerConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias ?? {}),
      "@": path.join(process.cwd(), "src"),
    },
  },
}));
