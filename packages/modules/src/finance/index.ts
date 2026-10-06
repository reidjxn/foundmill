// finance module screens (BUILD §6.3). Filled in by the modules build; each screen is registered in registerModule below.
import { registerModule, type ModuleScreen } from "../registry";

export const financeScreens: ModuleScreen[] = [];
registerModule({ key: "finance", screens: financeScreens });
