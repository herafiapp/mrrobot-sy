"use strict";

const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 420,
    minHeight: 680,
    title: "الكاشير | Mr. Robot",
    backgroundColor: "#120f2a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, "cashier", "index.html"));
}

app.setName("الكاشير");

app.whenReady().then(function () {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "الكاشير",
      submenu: [
        { role: "about", label: "عن الكاشير" },
        { type: "separator" },
        { role: "hide", label: "إخفاء" },
        { role: "hideOthers", label: "إخفاء الباقي" },
        { role: "unhide", label: "إظهار الكل" },
        { type: "separator" },
        { role: "quit", label: "خروج" }
      ]
    },
    {
      label: "عرض",
      submenu: [
        { role: "reload", label: "تحديث" },
        { role: "resetZoom", label: "الحجم الطبيعي" },
        { role: "zoomIn", label: "تكبير" },
        { role: "zoomOut", label: "تصغير" },
        { type: "separator" },
        { role: "togglefullscreen", label: "ملء الشاشة" }
      ]
    },
    {
      label: "تحرير",
      submenu: [
        { role: "undo", label: "تراجع" },
        { role: "redo", label: "إعادة" },
        { type: "separator" },
        { role: "cut", label: "قص" },
        { role: "copy", label: "نسخ" },
        { role: "paste", label: "لصق" },
        { role: "selectAll", label: "تحديد الكل" }
      ]
    }
  ]));
  createWindow();
});

app.on("window-all-closed", function () {
  app.quit();
});
