// Renders the brand outro (MP4) or a text patch (transparent PNG) with the premium kit. brandfix.mjs
// calls it as a child process: node outro.mjs '<json>' where json is
//   { "kind": "outro", "out", "width", "height", "seconds", "brand": {name, primary, accent, logo}, "title", "lines", "look" }
//   { "kind": "patch", "out", "width", "height", "text", "fill", "color", "bold", "align", "look" }
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { makeScore } from "./kit/audio/sound.mjs";
import {
  bundleTemplate,
  fail,
  makePublic,
  quality,
  renderVideo,
  tools,
} from "./kit/motion/node.mjs";

const here = import.meta.dirname;
let job;
try {
  job = JSON.parse(process.argv[2] ?? "");
} catch {
  fail("outro.mjs needs one JSON argument.");
}
const T = tools();
const { work, publicDir, cleanup } = makePublic(T.fontsDir);
const props = { ...job };
if (job.kind === "outro" && job.brand?.logo) {
  const name = `logo${NodePath.extname(job.brand.logo).toLowerCase()}`;
  NodeFS.copyFileSync(job.brand.logo, NodePath.join(publicDir, name));
  props.brand = { ...job.brand, logo: name };
}
if (job.kind === "outro") {
  const { wav } = makeScore({
    mood: "none",
    seconds: job.seconds,
    cues: [
      { t: 0, kind: "impact", gain: 0.28 },
      { t: 0.02, kind: "shimmer", gain: 0.45 },
      { t: 36 / 30, kind: "click" },
    ],
    seed: 9,
  });
  NodeFS.writeFileSync(NodePath.join(publicDir, "_zen", "score.wav"), wav);
  props.score = "_zen/score.wav";
}
const serveUrl = await bundleTemplate({
  require: T.require,
  modules: T.modules,
  entryPoint: NodePath.join(here, "outro", "src", "index.jsx"),
  rootDir: here,
  publicDir,
  work,
});
if (job.kind === "outro") {
  await renderVideo({
    require: T.require,
    serveUrl,
    id: "Outro",
    inputProps: props,
    output: job.out,
    q: quality("final"),
    browser: T.browser,
    label: "outro",
  });
} else {
  const { renderStill, selectComposition } = T.require("@remotion/renderer");
  const composition = await selectComposition({
    serveUrl,
    id: "Patch",
    inputProps: props,
    browserExecutable: T.browser,
  });
  await renderStill({
    composition,
    serveUrl,
    output: job.out,
    inputProps: props,
    imageFormat: "png",
    browserExecutable: T.browser,
  });
}
cleanup();
console.log(job.out);
