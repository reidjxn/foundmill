// team module screens (BUILD §6.3). Filled in by the modules build; each screen is registered in registerModule below.
import { registerModule, type ModuleScreen } from "../registry";

export const teamScreens: ModuleScreen[] = [];
registerModule({ key: "team", screens: teamScreens });
