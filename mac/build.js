"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const stage = path.join(__dirname, ".stage");
const out = path.join(__dirname, "dist");

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function setPlistString(xml, key, value) {
  const re = new RegExp("(<key>" + key + "</key>\\s*<string>)[^<]*(</string>)");
  if (re.test(xml)) return xml.replace(re, "$1" + value + "$2");
  return xml.replace(
    "</dict>\n</plist>",
    "  <key>" + key + "</key>\n  <string>" + value + "</string>\n</dict>\n</plist>"
  );
}

async function main() {
  resetDir(stage);
  copyFile(path.join(__dirname, "package.json"), path.join(stage, "package.json"));
  copyFile(path.join(__dirname, "main.js"), path.join(stage, "main.js"));
  ["index.html", "app.js", "core.js", "sw.js"].forEach(function (name) {
    copyFile(path.join(root, "cashier", name), path.join(stage, "cashier", name));
  });
  ["logo.jpg", "logo.webp", "favicon-32.png", "apple-touch-icon.png"].forEach(function (name) {
    copyFile(path.join(root, "assets", name), path.join(stage, "assets", name));
  });
  copyFile(path.join(root, "favicon.ico"), path.join(stage, "favicon.ico"));

  const sharp = require("sharp");
  const png2icons = require("png2icons");
  const png = await sharp(path.join(root, "assets", "logo.jpg"))
    .resize(1024, 1024)
    .png()
    .toBuffer();
  const icns = png2icons.createICNS(png, png2icons.BILINEAR, 0);
  if (!icns) throw new Error("Could not build the Mac icon");
  const iconPath = path.join(stage, "icon.icns");
  fs.writeFileSync(iconPath, icns);

  const packager = require("@electron/packager").packager;
  const apps = await packager({
    dir: stage,
    name: "MrRobotCashier",
    platform: "darwin",
    arch: ["arm64", "x64"],
    out: out,
    overwrite: true,
    asar: true,
    icon: iconPath,
    appBundleId: "space.dynamicorbit.mrrobot.cashier",
    appCategoryType: "public.app-category.business",
    darwinDarkModeSupport: true,
    executableName: "MrRobotCashier"
  });

  apps.forEach(function (appDir) {
    const plist = path.join(appDir, "MrRobotCashier.app", "Contents", "Info.plist");
    let xml = fs.readFileSync(plist, "utf8");
    xml = setPlistString(xml, "CFBundleDisplayName", "كاشير مستر روبوت");
    xml = setPlistString(xml, "CFBundleName", "كاشير مستر روبوت");
    fs.writeFileSync(plist, xml);
    const arch = appDir.endsWith("-arm64") ? "arm64" : "x64";
    const zipPath = path.join(out, "MrRobotCashier-mac-" + arch + ".zip");
    fs.rmSync(zipPath, { force: true });
    execFileSync("zip", ["-r", "-y", zipPath, "MrRobotCashier.app"], { cwd: appDir, stdio: "inherit" });
    console.log("built", zipPath);
  });
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
