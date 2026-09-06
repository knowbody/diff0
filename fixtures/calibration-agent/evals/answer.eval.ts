import { defineEval } from "eve/evals";
export default defineEval({
  async test(t) {
    await t.send("What is the calibration value?");
    t.succeeded();
    t.messageIncludes("VALUE=42");
  },
});
