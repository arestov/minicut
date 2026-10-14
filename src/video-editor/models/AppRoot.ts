import { appRoot } from "dkt/appRoot.js";
import { MINICUT_APP_PROPS } from "./AppRootDeclaration";
export { MINICUT_APP_MODELS } from "./AppRootDeclaration";

export const MiniCutAppRoot = appRoot(MINICUT_APP_PROPS, MINICUT_APP_PROPS.init);
