import { BrowserWindow, app, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
//#region electron/main.js
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
var mainWindow;
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 1024,
		minHeight: 768,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	if (VITE_DEV_SERVER_URL) mainWindow.loadURL(VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
	ipcMain.on("window-minimize", () => {
		mainWindow.minimize();
	});
	ipcMain.on("window-maximize", () => {
		if (mainWindow.isMaximized()) mainWindow.unmaximize();
		else mainWindow.maximize();
	});
	ipcMain.on("window-close", () => {
		mainWindow.close();
	});
	ipcMain.handle("get-system-info", () => {
		return {
			platform: process.platform,
			arch: process.arch
		};
	});
}
app.whenReady().then(() => {
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
//#endregion
