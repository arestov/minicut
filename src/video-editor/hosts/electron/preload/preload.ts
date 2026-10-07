import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("minicutDesktop", {});
