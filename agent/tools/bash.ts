import { disableTool } from "eve/tools";

/** Root orchestration never needs arbitrary shell execution. */
export default disableTool();
