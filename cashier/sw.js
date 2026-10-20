"use strict";

const CACHE = "mrrobot-cashier-v3";
const FILES = ["./index.html", "./app.js", "./core.js"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(FILES);
  }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return key !== CACHE;
    }).map(function (key) {
      return caches.delete(key);
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!/\/cashier\/(index\.html|app\.js|core\.js)$/.test(url.pathname) && !/\/cashier\/?$/.test(url.pathname)) {
    return;
  }
  event.respondWith(fetch(request).then(function (response) {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(function (cache) {
        cache.put(request, copy);
      }).catch(function () {});
    }
    return response;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      if (cached) return cached;
      if (request.mode === "navigate") return caches.match("./index.html");
      return new Response("", { status: 504, statusText: "Offline" });
    });
  }));
});
