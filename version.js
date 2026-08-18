/* Single source of truth for the app version.
   A classic script on purpose: the page and the service worker both read it,
   and importScripts() in a worker cannot load an ES module. */
self.APP_VERSION = '3.1.1';
