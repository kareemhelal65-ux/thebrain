let electron = require("electron");
//#region electron/preload.js
electron.contextBridge.exposeInMainWorld("electronAPI", {
	minimize: () => electron.ipcRenderer.send("window-minimize"),
	maximize: () => electron.ipcRenderer.send("window-maximize"),
	close: () => electron.ipcRenderer.send("window-close"),
	getSystemInfo: () => electron.ipcRenderer.invoke("get-system-info")
});
//#endregion
