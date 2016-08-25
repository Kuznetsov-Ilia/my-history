// Backbone.History
// ----------------

// Handles cross-browser history management, based on either
// [pushState](http://diveintohtml5.info/history.html) and real URLs, or
// [onhashchange](https://developer.mozilla.org/en-US/docs/DOM/window.onhashchange)
// and URL fragments. If the browser supports neither (old IE, natch),
// falls back to polling.

import { Eventable } from 'my-event';
import { window, document, body, location } from 'my-global';

var routeStripper = /^[#\/]|\s+$/g; // Cached regex for stripping a leading hash/slash and trailing space.
var rootStripper = /^\/+|\/+$/g; // Cached regex for stripping leading and trailing slashes.
var pathStripper = /#.*$/; // Cached regex for stripping urls of hash.
var isHistoryStarted = false; // Has the history handling already been started?
var atRootReg = /[^\/]$/;
var decodeFragmentReg = /%25/g;
var getSearchReplaceReg = /#.*/;
var getSearchMatchReg = /\?.+/;
var getHashReg = /#(.*)$/;
var _updateHashReg = /(javascript:|#).*$/;

function History() {
  // The default interval to poll for hash changes, if necessary, is
  // twenty times a second.
  this.interval = 50;
  this.checkUrl = this.checkUrl.bind(this);
  this.handlers = [];
  this.rand = Math.random();
  // Ensure that `History` can be used outside of the browser.
  if (typeof window !== 'undefined') {
    this.location = location;
    this.history = window.history;
  }
}

Object.assign(Eventable(History.prototype), {
  // Are we at the app root?
  atRoot() {
      var path = this.location.pathname.replace(atRootReg, '$&/');
      return path === this.root;
    },
    // Does the pathname match the root?
    matchRoot() {
      var path = this.decodeFragment(this.location.pathname);
      var root = path.slice(0, this.root.length - 1) + '/';
      return root === this.root;
    },

    // Unicode characters in `location.pathname` are percent encoded so they're
    // decoded for comparison. `%25` should not be decoded since it may be part
    // of an encoded parameter.
    decodeFragment(fragment) {
      return decodeURI(fragment.replace(decodeFragmentReg, '%2525'));
    },

    // In IE6, the hash fragment and search params are incorrect if the
    // fragment contains `?`.
    getSearch() {
      var match = this.location.href.replace(getSearchReplaceReg, '').match(getSearchMatchReg);
      return match ? match[0] : '';
    },
    // Gets the true hash value. Cannot use location.hash directly due to bug
    // in Firefox where location.hash will always be decoded.
    getHash(_window) {
      var match = (_window || this).location.href.match(getHashReg);
      return match ? match[1] : '';
    },

    // Get the pathname and search params, without the root.
    getPath() {
      var path = this.decodeFragment(
        this.location.pathname + this.getSearch()
      ).slice(this.root.length - 1);
      return path.charAt(0) === '/' ? path.slice(1) : path;
    },

    // Get the cross-browser normalized URL fragment from the path or hash.
    getFragment(fragment) {
      if (fragment === null || fragment === undefined) {
        if (this._hasPushState || !this._wantsHashChange) {
          fragment = this.getPath();
        } else {
          fragment = this.getHash();
        }
      }
      return fragment.replace(routeStripper, '');
    },

    // Start the hash change handling, returning `true` if the current URL matches
    // an existing route, and `false` otherwise.
    start(options) {
      if (isHistoryStarted) {
        throw new Error('Backbone.history has already been started');
      }
      isHistoryStarted = true;

      // Figure out the initial configuration. Do we need an iframe?
      // Is pushState desired ... is it available?
      this.options = Object.assign({root: '/'}, this.options, options);
      this.root = this.options.root;
      this._wantsHashChange = this.options.hashChange !== false;
      this._hasHashChange = 'onhashchange' in window && (document.documentMode === void 0 || document.documentMode > 7);
      this._useHashChange = this._wantsHashChange && this._hasHashChange;
      this._wantsPushState = !!this.options.pushState;
      this._hasPushState = !!(this.history && this.history.pushState);
      this._usePushState = this._wantsPushState && this._hasPushState;
      this.fragment = this.getFragment();

      // Normalize root to always include a leading and trailing slash.
      this.root = ('/' + this.root + '/').replace(rootStripper, '/');

      // Transition from hashChange to pushState or vice versa if both are
      // requested.
      if (this._wantsHashChange && this._wantsPushState) {

        // If we've started off with a route from a `pushState`-enabled
        // browser, but we're currently in a browser that doesn't support it...
        if (!this._hasPushState && !this.atRoot()) {
          var root = this.root.slice(0, -1) || '/';
          this.location.replace(root + '#' + this.getPath());
          // Return immediately as browser will do redirect to new url
          return true;

          // Or if we've started out with a hash-based route, but we're currently
          // in a browser where it could be `pushState`-based instead...
        } else if (this._hasPushState && this.atRoot()) {
          this.navigate(this.getHash(), {replace: true});
        }
      }
      // Proxy an iframe to handle location events if the browser doesn't
      // support the `hashchange` event, HTML5 history, or the user wants
      // `hashChange` but not `pushState`.
      if (!this._hasHashChange && this._wantsHashChange && !this._usePushState) {
        var iframe = document.createElement('iframe');
        iframe.src = 'javascript:0';/*eslint no-script-url: 0*/
        iframe.style.display = 'none';
        iframe.tabIndex = -1;
        // Using `appendChild` will throw on IE < 9 if the document is not ready.
        this.iframe = body.insertBefore(iframe, body.firstChild).contentWindow;
        this.iframe.document.open().close();
        this.iframe.location.hash = '#' + this.fragment;
      }

      // Depending on whether we're using pushState or hashes, and whether
      // 'onhashchange' is supported, determine how we check the URL state.
      if (this._usePushState) {
        window.on('popstate', this.checkUrl);
      } else if (this._useHashChange && !this.iframe) {
        window.on('hashchange', this.checkUrl);
      } else if (this._wantsHashChange) {
        this._checkUrlInterval = setInterval(this.checkUrl, this.interval);
      }

      if (!this.options.silent) {
        return this.loadUrl();
      }
    },

    // Disable Backbone.history, perhaps temporarily. Not useful in a real app,
    // but possibly useful for unit testing Routers.
    stop() {
      // Remove window listeners.
      if (this._usePushState) {
        window.off('popstate', this.checkUrl, false);
      } else if (this._useHashChange && !this.iframe) {
        window.off('hashchange', this.checkUrl, false);
      }

      // Clean up the iframe if necessary.
      if (this.iframe) {
        body.removeChild(this.iframe.frameElement);
        this.iframe = null;
      }
      if (this._checkUrlInterval) {
        clearInterval(this._checkUrlInterval);
      }
      isHistoryStarted = false;
    },

    // Add a route to be tested when the fragment changes. Routes added later
    // may override previous routes.
    route(route, callback) {
      this.handlers.unshift({route, callback});
    },

    // Checks the current URL to see if it has changed, and if it has,
    // calls `loadUrl`, normalizing across the hidden iframe.
    checkUrl( /*e*/ ) {
      var current = this.getFragment();
      // If the user pressed the back button, the iframe's hash will have
      // changed and we should use that for comparison.
      if (current === this.fragment && this.iframe) {
        current = this.getHash(this.iframe.contentWindow);
      }
      if (current === this.fragment) {
        return false;
      }
      if (this.iframe) {
        this.navigate(current);
      }
      this.loadUrl();
    },

    // Attempt to load the current URL fragment. If a route succeeds with a
    // match, returns `true`. If no defined routes matches the fragment,
    // returns `false`.
    loadUrl(fragment) {
      // If the root doesn't match, no routes can match either.
      if (!this.matchRoot()) {
        return false;
      }
      fragment = this.fragment = this.getFragment(fragment);
      return this.handlers.some(handler => {
        if (handler.route.test(fragment)) {
          handler.callback(fragment);
          return true;
        }
      });
    },

    // Save a fragment into the hash history, or replace the URL state if the
    // 'replace' option is passed. You are responsible for properly URL-encoding
    // the fragment in advance.
    //
    // The options object can contain `trigger: true` if you wish to have the
    // route callback be fired (not usually desirable), or `replace: true`, if
    // you wish to modify the current URL without adding an entry to the history.
    navigate(fragment, options) {
      if (!isHistoryStarted) {
        return false;
      }
      if (!options || options === true) {
        options = {
          trigger: !!options
        };
      }

      // Normalize the fragment.
      fragment = this.getFragment(fragment || '');

      // Don't include a trailing slash on the root.
      var root = this.root;
      if (fragment === '' || fragment.charAt(0) === '?') {
        root = root.slice(0, -1) || '/';
      }
      var url = root + fragment;

      // Strip the hash and decode for matching.
      fragment = this.decodeFragment(fragment.replace(pathStripper, ''));

      if (this.fragment === fragment) {
        return false;
      }
      this.fragment = fragment;

      // If pushState is available, we use it to set the fragment as a real URL.
      if (this._usePushState) {
        this.history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);

        // If hash changes haven't been explicitly disabled, update the hash
        // fragment to store history.
      } else if (this._wantsHashChange) {
        this._updateHash(this.location, fragment, options.replace);
        if (this.iframe && (fragment !== this.getHash(this.iframe.contentWindow))) {
          // Opening and closing the iframe tricks IE7 and earlier to push a
          // history entry on hash-tag change.  When replace is true, we don't
          // want this.
          var iWindow = this.iframe.contentWindow;
          if (!options.replace) {
            iWindow.document.open().close();
          }
          this._updateHash(iWindow.location, fragment, options.replace);
        }

        // If you've told us that you explicitly don't want fallback hashchange-
        // based history, then `navigate` becomes a page refresh.
      } else {
        return this.location.assign(url);
      }
      if (options.trigger) {
        return this.loadUrl(fragment);
      }
    },

    // Update the hash location, either replacing the current entry, or adding
    // a new one to the browser history.
    _updateHash(_location, fragment, replace) {
      if (replace) {
        var href = _location.href.replace(_updateHashReg, '');
        _location.replace(href + '#' + fragment);
      } else {
        // Some browsers require that `hash` contains a leading #.
        _location.hash = '#' + fragment;
      }
    }
});

export default new History();
