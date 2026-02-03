(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/events/events.js
  var require_events = __commonJS({
    "node_modules/events/events.js"(exports, module) {
      "use strict";
      var R = typeof Reflect === "object" ? Reflect : null;
      var ReflectApply = R && typeof R.apply === "function" ? R.apply : function ReflectApply2(target, receiver, args) {
        return Function.prototype.apply.call(target, receiver, args);
      };
      var ReflectOwnKeys;
      if (R && typeof R.ownKeys === "function") {
        ReflectOwnKeys = R.ownKeys;
      } else if (Object.getOwnPropertySymbols) {
        ReflectOwnKeys = function ReflectOwnKeys2(target) {
          return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
        };
      } else {
        ReflectOwnKeys = function ReflectOwnKeys2(target) {
          return Object.getOwnPropertyNames(target);
        };
      }
      function ProcessEmitWarning(warning) {
        if (console && console.warn) console.warn(warning);
      }
      var NumberIsNaN = Number.isNaN || function NumberIsNaN2(value) {
        return value !== value;
      };
      function EventEmitter12() {
        EventEmitter12.init.call(this);
      }
      module.exports = EventEmitter12;
      module.exports.once = once;
      EventEmitter12.EventEmitter = EventEmitter12;
      EventEmitter12.prototype._events = void 0;
      EventEmitter12.prototype._eventsCount = 0;
      EventEmitter12.prototype._maxListeners = void 0;
      var defaultMaxListeners = 10;
      function checkListener(listener) {
        if (typeof listener !== "function") {
          throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
        }
      }
      Object.defineProperty(EventEmitter12, "defaultMaxListeners", {
        enumerable: true,
        get: function() {
          return defaultMaxListeners;
        },
        set: function(arg) {
          if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) {
            throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
          }
          defaultMaxListeners = arg;
        }
      });
      EventEmitter12.init = function() {
        if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        }
        this._maxListeners = this._maxListeners || void 0;
      };
      EventEmitter12.prototype.setMaxListeners = function setMaxListeners(n) {
        if (typeof n !== "number" || n < 0 || NumberIsNaN(n)) {
          throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + ".");
        }
        this._maxListeners = n;
        return this;
      };
      function _getMaxListeners(that) {
        if (that._maxListeners === void 0)
          return EventEmitter12.defaultMaxListeners;
        return that._maxListeners;
      }
      EventEmitter12.prototype.getMaxListeners = function getMaxListeners() {
        return _getMaxListeners(this);
      };
      EventEmitter12.prototype.emit = function emit(type) {
        var args = [];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        var doError = type === "error";
        var events = this._events;
        if (events !== void 0)
          doError = doError && events.error === void 0;
        else if (!doError)
          return false;
        if (doError) {
          var er;
          if (args.length > 0)
            er = args[0];
          if (er instanceof Error) {
            throw er;
          }
          var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
          err.context = er;
          throw err;
        }
        var handler = events[type];
        if (handler === void 0)
          return false;
        if (typeof handler === "function") {
          ReflectApply(handler, this, args);
        } else {
          var len = handler.length;
          var listeners = arrayClone(handler, len);
          for (var i = 0; i < len; ++i)
            ReflectApply(listeners[i], this, args);
        }
        return true;
      };
      function _addListener(target, type, listener, prepend) {
        var m;
        var events;
        var existing;
        checkListener(listener);
        events = target._events;
        if (events === void 0) {
          events = target._events = /* @__PURE__ */ Object.create(null);
          target._eventsCount = 0;
        } else {
          if (events.newListener !== void 0) {
            target.emit(
              "newListener",
              type,
              listener.listener ? listener.listener : listener
            );
            events = target._events;
          }
          existing = events[type];
        }
        if (existing === void 0) {
          existing = events[type] = listener;
          ++target._eventsCount;
        } else {
          if (typeof existing === "function") {
            existing = events[type] = prepend ? [listener, existing] : [existing, listener];
          } else if (prepend) {
            existing.unshift(listener);
          } else {
            existing.push(listener);
          }
          m = _getMaxListeners(target);
          if (m > 0 && existing.length > m && !existing.warned) {
            existing.warned = true;
            var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
            w.name = "MaxListenersExceededWarning";
            w.emitter = target;
            w.type = type;
            w.count = existing.length;
            ProcessEmitWarning(w);
          }
        }
        return target;
      }
      EventEmitter12.prototype.addListener = function addListener(type, listener) {
        return _addListener(this, type, listener, false);
      };
      EventEmitter12.prototype.on = EventEmitter12.prototype.addListener;
      EventEmitter12.prototype.prependListener = function prependListener(type, listener) {
        return _addListener(this, type, listener, true);
      };
      function onceWrapper() {
        if (!this.fired) {
          this.target.removeListener(this.type, this.wrapFn);
          this.fired = true;
          if (arguments.length === 0)
            return this.listener.call(this.target);
          return this.listener.apply(this.target, arguments);
        }
      }
      function _onceWrap(target, type, listener) {
        var state = { fired: false, wrapFn: void 0, target, type, listener };
        var wrapped = onceWrapper.bind(state);
        wrapped.listener = listener;
        state.wrapFn = wrapped;
        return wrapped;
      }
      EventEmitter12.prototype.once = function once2(type, listener) {
        checkListener(listener);
        this.on(type, _onceWrap(this, type, listener));
        return this;
      };
      EventEmitter12.prototype.prependOnceListener = function prependOnceListener(type, listener) {
        checkListener(listener);
        this.prependListener(type, _onceWrap(this, type, listener));
        return this;
      };
      EventEmitter12.prototype.removeListener = function removeListener(type, listener) {
        var list, events, position, i, originalListener;
        checkListener(listener);
        events = this._events;
        if (events === void 0)
          return this;
        list = events[type];
        if (list === void 0)
          return this;
        if (list === listener || list.listener === listener) {
          if (--this._eventsCount === 0)
            this._events = /* @__PURE__ */ Object.create(null);
          else {
            delete events[type];
            if (events.removeListener)
              this.emit("removeListener", type, list.listener || listener);
          }
        } else if (typeof list !== "function") {
          position = -1;
          for (i = list.length - 1; i >= 0; i--) {
            if (list[i] === listener || list[i].listener === listener) {
              originalListener = list[i].listener;
              position = i;
              break;
            }
          }
          if (position < 0)
            return this;
          if (position === 0)
            list.shift();
          else {
            spliceOne(list, position);
          }
          if (list.length === 1)
            events[type] = list[0];
          if (events.removeListener !== void 0)
            this.emit("removeListener", type, originalListener || listener);
        }
        return this;
      };
      EventEmitter12.prototype.off = EventEmitter12.prototype.removeListener;
      EventEmitter12.prototype.removeAllListeners = function removeAllListeners(type) {
        var listeners, events, i;
        events = this._events;
        if (events === void 0)
          return this;
        if (events.removeListener === void 0) {
          if (arguments.length === 0) {
            this._events = /* @__PURE__ */ Object.create(null);
            this._eventsCount = 0;
          } else if (events[type] !== void 0) {
            if (--this._eventsCount === 0)
              this._events = /* @__PURE__ */ Object.create(null);
            else
              delete events[type];
          }
          return this;
        }
        if (arguments.length === 0) {
          var keys = Object.keys(events);
          var key;
          for (i = 0; i < keys.length; ++i) {
            key = keys[i];
            if (key === "removeListener") continue;
            this.removeAllListeners(key);
          }
          this.removeAllListeners("removeListener");
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
          return this;
        }
        listeners = events[type];
        if (typeof listeners === "function") {
          this.removeListener(type, listeners);
        } else if (listeners !== void 0) {
          for (i = listeners.length - 1; i >= 0; i--) {
            this.removeListener(type, listeners[i]);
          }
        }
        return this;
      };
      function _listeners(target, type, unwrap) {
        var events = target._events;
        if (events === void 0)
          return [];
        var evlistener = events[type];
        if (evlistener === void 0)
          return [];
        if (typeof evlistener === "function")
          return unwrap ? [evlistener.listener || evlistener] : [evlistener];
        return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
      }
      EventEmitter12.prototype.listeners = function listeners(type) {
        return _listeners(this, type, true);
      };
      EventEmitter12.prototype.rawListeners = function rawListeners(type) {
        return _listeners(this, type, false);
      };
      EventEmitter12.listenerCount = function(emitter, type) {
        if (typeof emitter.listenerCount === "function") {
          return emitter.listenerCount(type);
        } else {
          return listenerCount.call(emitter, type);
        }
      };
      EventEmitter12.prototype.listenerCount = listenerCount;
      function listenerCount(type) {
        var events = this._events;
        if (events !== void 0) {
          var evlistener = events[type];
          if (typeof evlistener === "function") {
            return 1;
          } else if (evlistener !== void 0) {
            return evlistener.length;
          }
        }
        return 0;
      }
      EventEmitter12.prototype.eventNames = function eventNames() {
        return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
      };
      function arrayClone(arr, n) {
        var copy = new Array(n);
        for (var i = 0; i < n; ++i)
          copy[i] = arr[i];
        return copy;
      }
      function spliceOne(list, index) {
        for (; index + 1 < list.length; index++)
          list[index] = list[index + 1];
        list.pop();
      }
      function unwrapListeners(arr) {
        var ret = new Array(arr.length);
        for (var i = 0; i < ret.length; ++i) {
          ret[i] = arr[i].listener || arr[i];
        }
        return ret;
      }
      function once(emitter, name) {
        return new Promise(function(resolve, reject) {
          function errorListener(err) {
            emitter.removeListener(name, resolver);
            reject(err);
          }
          function resolver() {
            if (typeof emitter.removeListener === "function") {
              emitter.removeListener("error", errorListener);
            }
            resolve([].slice.call(arguments));
          }
          ;
          eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
          if (name !== "error") {
            addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
          }
        });
      }
      function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
        if (typeof emitter.on === "function") {
          eventTargetAgnosticAddListener(emitter, "error", handler, flags);
        }
      }
      function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
        if (typeof emitter.on === "function") {
          if (flags.once) {
            emitter.once(name, listener);
          } else {
            emitter.on(name, listener);
          }
        } else if (typeof emitter.addEventListener === "function") {
          emitter.addEventListener(name, function wrapListener(arg) {
            if (flags.once) {
              emitter.removeEventListener(name, wrapListener);
            }
            listener(arg);
          });
        } else {
          throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
        }
      }
    }
  });

  // node_modules/loglevel/lib/loglevel.js
  var require_loglevel = __commonJS({
    "node_modules/loglevel/lib/loglevel.js"(exports, module) {
      (function(root, definition) {
        "use strict";
        if (typeof define === "function" && define.amd) {
          define(definition);
        } else if (typeof module === "object" && module.exports) {
          module.exports = definition();
        } else {
          root.log = definition();
        }
      })(exports, function() {
        "use strict";
        var noop = function() {
        };
        var undefinedType = "undefined";
        var isIE = typeof window !== undefinedType && typeof window.navigator !== undefinedType && /Trident\/|MSIE /.test(window.navigator.userAgent);
        var logMethods = [
          "trace",
          "debug",
          "info",
          "warn",
          "error"
        ];
        var _loggersByName = {};
        var defaultLogger = null;
        function bindMethod(obj, methodName) {
          var method = obj[methodName];
          if (typeof method.bind === "function") {
            return method.bind(obj);
          } else {
            try {
              return Function.prototype.bind.call(method, obj);
            } catch (e) {
              return function() {
                return Function.prototype.apply.apply(method, [obj, arguments]);
              };
            }
          }
        }
        function traceForIE() {
          if (console.log) {
            if (console.log.apply) {
              console.log.apply(console, arguments);
            } else {
              Function.prototype.apply.apply(console.log, [console, arguments]);
            }
          }
          if (console.trace) console.trace();
        }
        function realMethod(methodName) {
          if (methodName === "debug") {
            methodName = "log";
          }
          if (typeof console === undefinedType) {
            return false;
          } else if (methodName === "trace" && isIE) {
            return traceForIE;
          } else if (console[methodName] !== void 0) {
            return bindMethod(console, methodName);
          } else if (console.log !== void 0) {
            return bindMethod(console, "log");
          } else {
            return noop;
          }
        }
        function replaceLoggingMethods() {
          var level = this.getLevel();
          for (var i = 0; i < logMethods.length; i++) {
            var methodName = logMethods[i];
            this[methodName] = i < level ? noop : this.methodFactory(methodName, level, this.name);
          }
          this.log = this.debug;
          if (typeof console === undefinedType && level < this.levels.SILENT) {
            return "No console available for logging";
          }
        }
        function enableLoggingWhenConsoleArrives(methodName) {
          return function() {
            if (typeof console !== undefinedType) {
              replaceLoggingMethods.call(this);
              this[methodName].apply(this, arguments);
            }
          };
        }
        function defaultMethodFactory(methodName, _level, _loggerName) {
          return realMethod(methodName) || enableLoggingWhenConsoleArrives.apply(this, arguments);
        }
        function Logger2(name, factory) {
          var self = this;
          var inheritedLevel;
          var defaultLevel;
          var userLevel;
          var storageKey = "loglevel";
          if (typeof name === "string") {
            storageKey += ":" + name;
          } else if (typeof name === "symbol") {
            storageKey = void 0;
          }
          function persistLevelIfPossible(levelNum) {
            var levelName = (logMethods[levelNum] || "silent").toUpperCase();
            if (typeof window === undefinedType || !storageKey) return;
            try {
              window.localStorage[storageKey] = levelName;
              return;
            } catch (ignore) {
            }
            try {
              window.document.cookie = encodeURIComponent(storageKey) + "=" + levelName + ";";
            } catch (ignore) {
            }
          }
          function getPersistedLevel() {
            var storedLevel;
            if (typeof window === undefinedType || !storageKey) return;
            try {
              storedLevel = window.localStorage[storageKey];
            } catch (ignore) {
            }
            if (typeof storedLevel === undefinedType) {
              try {
                var cookie = window.document.cookie;
                var cookieName = encodeURIComponent(storageKey);
                var location = cookie.indexOf(cookieName + "=");
                if (location !== -1) {
                  storedLevel = /^([^;]+)/.exec(
                    cookie.slice(location + cookieName.length + 1)
                  )[1];
                }
              } catch (ignore) {
              }
            }
            if (self.levels[storedLevel] === void 0) {
              storedLevel = void 0;
            }
            return storedLevel;
          }
          function clearPersistedLevel() {
            if (typeof window === undefinedType || !storageKey) return;
            try {
              window.localStorage.removeItem(storageKey);
            } catch (ignore) {
            }
            try {
              window.document.cookie = encodeURIComponent(storageKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC";
            } catch (ignore) {
            }
          }
          function normalizeLevel(input) {
            var level = input;
            if (typeof level === "string" && self.levels[level.toUpperCase()] !== void 0) {
              level = self.levels[level.toUpperCase()];
            }
            if (typeof level === "number" && level >= 0 && level <= self.levels.SILENT) {
              return level;
            } else {
              throw new TypeError("log.setLevel() called with invalid level: " + input);
            }
          }
          self.name = name;
          self.levels = {
            "TRACE": 0,
            "DEBUG": 1,
            "INFO": 2,
            "WARN": 3,
            "ERROR": 4,
            "SILENT": 5
          };
          self.methodFactory = factory || defaultMethodFactory;
          self.getLevel = function() {
            if (userLevel != null) {
              return userLevel;
            } else if (defaultLevel != null) {
              return defaultLevel;
            } else {
              return inheritedLevel;
            }
          };
          self.setLevel = function(level, persist) {
            userLevel = normalizeLevel(level);
            if (persist !== false) {
              persistLevelIfPossible(userLevel);
            }
            return replaceLoggingMethods.call(self);
          };
          self.setDefaultLevel = function(level) {
            defaultLevel = normalizeLevel(level);
            if (!getPersistedLevel()) {
              self.setLevel(level, false);
            }
          };
          self.resetLevel = function() {
            userLevel = null;
            clearPersistedLevel();
            replaceLoggingMethods.call(self);
          };
          self.enableAll = function(persist) {
            self.setLevel(self.levels.TRACE, persist);
          };
          self.disableAll = function(persist) {
            self.setLevel(self.levels.SILENT, persist);
          };
          self.rebuild = function() {
            if (defaultLogger !== self) {
              inheritedLevel = normalizeLevel(defaultLogger.getLevel());
            }
            replaceLoggingMethods.call(self);
            if (defaultLogger === self) {
              for (var childName in _loggersByName) {
                _loggersByName[childName].rebuild();
              }
            }
          };
          inheritedLevel = normalizeLevel(
            defaultLogger ? defaultLogger.getLevel() : "WARN"
          );
          var initialLevel = getPersistedLevel();
          if (initialLevel != null) {
            userLevel = normalizeLevel(initialLevel);
          }
          replaceLoggingMethods.call(self);
        }
        defaultLogger = new Logger2();
        defaultLogger.getLogger = function getLogger(name) {
          if (typeof name !== "symbol" && typeof name !== "string" || name === "") {
            throw new TypeError("You must supply a name when creating a logger.");
          }
          var logger = _loggersByName[name];
          if (!logger) {
            logger = _loggersByName[name] = new Logger2(
              name,
              defaultLogger.methodFactory
            );
          }
          return logger;
        };
        var _log = typeof window !== undefinedType ? window.log : void 0;
        defaultLogger.noConflict = function() {
          if (typeof window !== undefinedType && window.log === defaultLogger) {
            window.log = _log;
          }
          return defaultLogger;
        };
        defaultLogger.getLoggers = function getLoggers() {
          return _loggersByName;
        };
        defaultLogger["default"] = defaultLogger;
        return defaultLogger;
      });
    }
  });

  // node_modules/@twilio/voice-sdk/esm/twilio/call.js
  var import_events11 = __toESM(require_events());

  // node_modules/@twilio/voice-sdk/esm/twilio/backoff.js
  var import_events = __toESM(require_events());
  var Backoff = class extends import_events.EventEmitter {
    /**
     * Construct a {@link Backoff}.
     * @param {object} options
     * @property {number} min - Initial timeout in milliseconds [100]
     * @property {number} max - Max timeout [10000]
     * @property {number} jitter - Apply jitter [0]
     * @property {number} factor - Multiplication factor for Backoff operation [2]
     * @property {boolean} useInitialValue - Whether to use the initial value on the first backoff call [false]
     */
    constructor(options) {
      super();
      Object.defineProperties(this, {
        _attempts: {
          value: 0,
          writable: true
        },
        _duration: {
          enumerable: false,
          get() {
            if (this._useInitialValue && this._attempts === 0) {
              return this._min;
            }
            let ms = this._min * Math.pow(this._factor, this._attempts);
            if (this._jitter) {
              const rand = Math.random();
              const deviation = Math.floor(rand * this._jitter * ms);
              ms = (Math.floor(rand * 10) & 1) === 0 ? ms - deviation : ms + deviation;
            }
            return Math.min(ms, this._max) | 0;
          }
        },
        _factor: { value: options.factor || 2 },
        _jitter: { value: options.jitter > 0 && options.jitter <= 1 ? options.jitter : 0 },
        _max: { value: options.max || 1e4 },
        _min: { value: options.min || 100 },
        _timeoutID: {
          value: null,
          writable: true
        },
        _useInitialValue: {
          value: options.useInitialValue || false
        }
      });
    }
    backoff() {
      const duration = this._duration;
      if (this._timeoutID) {
        clearTimeout(this._timeoutID);
        this._timeoutID = null;
      }
      this.emit("backoff", this._attempts, duration);
      this._timeoutID = setTimeout(() => {
        this.emit("ready", this._attempts, duration);
        this._attempts++;
      }, duration);
    }
    reset() {
      this._attempts = 0;
      if (this._timeoutID) {
        clearTimeout(this._timeoutID);
        this._timeoutID = null;
      }
    }
  };

  // node_modules/tslib/tslib.es6.mjs
  function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/device.js
  var import_events9 = __toESM(require_events());
  var loglevel2 = __toESM(require_loglevel());

  // node_modules/@twilio/voice-sdk/esm/twilio/audiohelper.js
  var import_events2 = __toESM(require_events());

  // node_modules/@twilio/voice-sdk/esm/twilio/errors/twilioError.js
  var TwilioError = class _TwilioError extends Error {
    /**
     * @internal
     */
    constructor(messageOrError, error2) {
      super();
      Object.setPrototypeOf(this, _TwilioError.prototype);
      const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
      const originalError = typeof messageOrError === "object" ? messageOrError : error2;
      this.message = `${this.name} (${this.code}): ${message}`;
      this.originalError = originalError;
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/errors/generated.js
  var AuthorizationErrors;
  (function(AuthorizationErrors2) {
    class AccessTokenInvalid extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 20101;
        this.description = "Invalid access token";
        this.explanation = "Twilio was unable to validate your Access Token";
        this.name = "AccessTokenInvalid";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.AccessTokenInvalid.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.AccessTokenInvalid = AccessTokenInvalid;
    class AccessTokenExpired extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 20104;
        this.description = "Access token expired or expiration date invalid";
        this.explanation = "The Access Token provided to the Twilio API has expired, the expiration time specified in the token was invalid, or the expiration time specified was too far in the future";
        this.name = "AccessTokenExpired";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.AccessTokenExpired.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.AccessTokenExpired = AccessTokenExpired;
    class AuthenticationFailed extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 20151;
        this.description = "Authentication Failed";
        this.explanation = "The Authentication with the provided JWT failed";
        this.name = "AuthenticationFailed";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.AuthenticationFailed.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.AuthenticationFailed = AuthenticationFailed;
  })(AuthorizationErrors || (AuthorizationErrors = {}));
  var SignatureValidationErrors;
  (function(SignatureValidationErrors2) {
    class AccessTokenSignatureValidationFailed extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The access token has an invalid Account SID, API Key, or API Key Secret."
        ];
        this.code = 31202;
        this.description = "Signature validation failed.";
        this.explanation = "The provided access token failed signature validation.";
        this.name = "AccessTokenSignatureValidationFailed";
        this.solutions = [
          "Ensure the Account SID, API Key, and API Key Secret are valid when generating your access token."
        ];
        Object.setPrototypeOf(this, SignatureValidationErrors2.AccessTokenSignatureValidationFailed.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    SignatureValidationErrors2.AccessTokenSignatureValidationFailed = AccessTokenSignatureValidationFailed;
  })(SignatureValidationErrors || (SignatureValidationErrors = {}));
  var ClientErrors;
  (function(ClientErrors2) {
    class BadRequest extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31400;
        this.description = "Bad Request (HTTP/SIP)";
        this.explanation = "The request could not be understood due to malformed syntax.";
        this.name = "BadRequest";
        this.solutions = [];
        Object.setPrototypeOf(this, ClientErrors2.BadRequest.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    ClientErrors2.BadRequest = BadRequest;
    class NotFound extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The outbound call was made to an invalid phone number.",
          "The TwiML application sid is missing a Voice URL."
        ];
        this.code = 31404;
        this.description = "Not Found (HTTP/SIP)";
        this.explanation = "The server has not found anything matching the request.";
        this.name = "NotFound";
        this.solutions = [
          "Ensure the phone number dialed is valid.",
          "Ensure the TwiML application is configured correctly with a Voice URL link."
        ];
        Object.setPrototypeOf(this, ClientErrors2.NotFound.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    ClientErrors2.NotFound = NotFound;
    class TemporarilyUnavailable extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31480;
        this.description = "Temporarily Unavailable (SIP)";
        this.explanation = "The callee is currently unavailable.";
        this.name = "TemporarilyUnavailable";
        this.solutions = [];
        Object.setPrototypeOf(this, ClientErrors2.TemporarilyUnavailable.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    ClientErrors2.TemporarilyUnavailable = TemporarilyUnavailable;
    class BusyHere extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31486;
        this.description = "Busy Here (SIP)";
        this.explanation = "The callee is busy.";
        this.name = "BusyHere";
        this.solutions = [];
        Object.setPrototypeOf(this, ClientErrors2.BusyHere.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    ClientErrors2.BusyHere = BusyHere;
  })(ClientErrors || (ClientErrors = {}));
  var SIPServerErrors;
  (function(SIPServerErrors2) {
    class Decline extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31603;
        this.description = "Decline (SIP)";
        this.explanation = "The callee does not wish to participate in the call.";
        this.name = "Decline";
        this.solutions = [];
        Object.setPrototypeOf(this, SIPServerErrors2.Decline.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    SIPServerErrors2.Decline = Decline;
  })(SIPServerErrors || (SIPServerErrors = {}));
  var GeneralErrors;
  (function(GeneralErrors2) {
    class UnknownError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31e3;
        this.description = "Unknown Error";
        this.explanation = "An unknown error has occurred. See error details for more information.";
        this.name = "UnknownError";
        this.solutions = [];
        Object.setPrototypeOf(this, GeneralErrors2.UnknownError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    GeneralErrors2.UnknownError = UnknownError;
    class ApplicationNotFoundError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31001;
        this.description = "Application Not Found";
        this.explanation = "";
        this.name = "ApplicationNotFoundError";
        this.solutions = [];
        Object.setPrototypeOf(this, GeneralErrors2.ApplicationNotFoundError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    GeneralErrors2.ApplicationNotFoundError = ApplicationNotFoundError;
    class ConnectionDeclinedError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31002;
        this.description = "Connection Declined";
        this.explanation = "";
        this.name = "ConnectionDeclinedError";
        this.solutions = [];
        Object.setPrototypeOf(this, GeneralErrors2.ConnectionDeclinedError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    GeneralErrors2.ConnectionDeclinedError = ConnectionDeclinedError;
    class ConnectionTimeoutError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31003;
        this.description = "Connection Timeout";
        this.explanation = "The server could not produce a response within a suitable amount of time.";
        this.name = "ConnectionTimeoutError";
        this.solutions = [];
        Object.setPrototypeOf(this, GeneralErrors2.ConnectionTimeoutError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    GeneralErrors2.ConnectionTimeoutError = ConnectionTimeoutError;
    class ConnectionError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31005;
        this.description = "Connection error";
        this.explanation = "A connection error occurred during the call";
        this.name = "ConnectionError";
        this.solutions = [];
        Object.setPrototypeOf(this, GeneralErrors2.ConnectionError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    GeneralErrors2.ConnectionError = ConnectionError;
    class CallCancelledError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The incoming call was cancelled because it was not answered in time or it was accepted/rejected by another application instance registered with the same identity."
        ];
        this.code = 31008;
        this.description = "Call cancelled";
        this.explanation = "Unable to answer because the call has ended";
        this.name = "CallCancelledError";
        this.solutions = [];
        Object.setPrototypeOf(this, GeneralErrors2.CallCancelledError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    GeneralErrors2.CallCancelledError = CallCancelledError;
    class TransportError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31009;
        this.description = "Transport error";
        this.explanation = "No transport available to send or receive messages";
        this.name = "TransportError";
        this.solutions = [];
        Object.setPrototypeOf(this, GeneralErrors2.TransportError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    GeneralErrors2.TransportError = TransportError;
  })(GeneralErrors || (GeneralErrors = {}));
  var MalformedRequestErrors;
  (function(MalformedRequestErrors2) {
    class MalformedRequestError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "Invalid content or MessageType passed to sendMessage method."
        ];
        this.code = 31100;
        this.description = "The request had malformed syntax.";
        this.explanation = "The request could not be understood due to malformed syntax.";
        this.name = "MalformedRequestError";
        this.solutions = [
          "Ensure content and MessageType passed to sendMessage method are valid."
        ];
        Object.setPrototypeOf(this, MalformedRequestErrors2.MalformedRequestError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MalformedRequestErrors2.MalformedRequestError = MalformedRequestError;
    class MissingParameterArrayError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31101;
        this.description = "Missing parameter array in request";
        this.explanation = "";
        this.name = "MissingParameterArrayError";
        this.solutions = [];
        Object.setPrototypeOf(this, MalformedRequestErrors2.MissingParameterArrayError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MalformedRequestErrors2.MissingParameterArrayError = MissingParameterArrayError;
    class AuthorizationTokenMissingError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31102;
        this.description = "Authorization token missing in request.";
        this.explanation = "";
        this.name = "AuthorizationTokenMissingError";
        this.solutions = [];
        Object.setPrototypeOf(this, MalformedRequestErrors2.AuthorizationTokenMissingError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MalformedRequestErrors2.AuthorizationTokenMissingError = AuthorizationTokenMissingError;
    class MaxParameterLengthExceededError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31103;
        this.description = "Maximum parameter length has been exceeded.";
        this.explanation = "Length of parameters cannot exceed MAX_PARAM_LENGTH.";
        this.name = "MaxParameterLengthExceededError";
        this.solutions = [];
        Object.setPrototypeOf(this, MalformedRequestErrors2.MaxParameterLengthExceededError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MalformedRequestErrors2.MaxParameterLengthExceededError = MaxParameterLengthExceededError;
    class InvalidBridgeTokenError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31104;
        this.description = "Invalid bridge token";
        this.explanation = "";
        this.name = "InvalidBridgeTokenError";
        this.solutions = [];
        Object.setPrototypeOf(this, MalformedRequestErrors2.InvalidBridgeTokenError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MalformedRequestErrors2.InvalidBridgeTokenError = InvalidBridgeTokenError;
    class InvalidClientNameError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "Client name contains invalid characters."
        ];
        this.code = 31105;
        this.description = "Invalid client name";
        this.explanation = "Client name should not contain control, space, delims, or unwise characters.";
        this.name = "InvalidClientNameError";
        this.solutions = [
          "Make sure that client name does not contain any of the invalid characters."
        ];
        Object.setPrototypeOf(this, MalformedRequestErrors2.InvalidClientNameError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MalformedRequestErrors2.InvalidClientNameError = InvalidClientNameError;
    class ReconnectParameterInvalidError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31107;
        this.description = "The reconnect parameter is invalid";
        this.explanation = "";
        this.name = "ReconnectParameterInvalidError";
        this.solutions = [];
        Object.setPrototypeOf(this, MalformedRequestErrors2.ReconnectParameterInvalidError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MalformedRequestErrors2.ReconnectParameterInvalidError = ReconnectParameterInvalidError;
  })(MalformedRequestErrors || (MalformedRequestErrors = {}));
  (function(AuthorizationErrors2) {
    class AuthorizationError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31201;
        this.description = "Authorization error";
        this.explanation = "The request requires user authentication. The server understood the request, but is refusing to fulfill it.";
        this.name = "AuthorizationError";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.AuthorizationError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.AuthorizationError = AuthorizationError;
    class NoValidAccountError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31203;
        this.description = "No valid account";
        this.explanation = "";
        this.name = "NoValidAccountError";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.NoValidAccountError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.NoValidAccountError = NoValidAccountError;
    class InvalidJWTTokenError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31204;
        this.description = "Invalid JWT token";
        this.explanation = "";
        this.name = "InvalidJWTTokenError";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.InvalidJWTTokenError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.InvalidJWTTokenError = InvalidJWTTokenError;
    class JWTTokenExpiredError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31205;
        this.description = "JWT token expired";
        this.explanation = "";
        this.name = "JWTTokenExpiredError";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.JWTTokenExpiredError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.JWTTokenExpiredError = JWTTokenExpiredError;
    class RateExceededError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "Rate limit exceeded."
        ];
        this.code = 31206;
        this.description = "Rate exceeded authorized limit.";
        this.explanation = "The request performed exceeds the authorized limit.";
        this.name = "RateExceededError";
        this.solutions = [
          "Ensure message send rate does not exceed authorized limits."
        ];
        Object.setPrototypeOf(this, AuthorizationErrors2.RateExceededError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.RateExceededError = RateExceededError;
    class JWTTokenExpirationTooLongError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31207;
        this.description = "JWT token expiration too long";
        this.explanation = "";
        this.name = "JWTTokenExpirationTooLongError";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.JWTTokenExpirationTooLongError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.JWTTokenExpirationTooLongError = JWTTokenExpirationTooLongError;
    class ReconnectAttemptError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 31209;
        this.description = "Reconnect attempt is not authorized.";
        this.explanation = "";
        this.name = "ReconnectAttemptError";
        this.solutions = [];
        Object.setPrototypeOf(this, AuthorizationErrors2.ReconnectAttemptError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.ReconnectAttemptError = ReconnectAttemptError;
    class CallMessageEventTypeInvalidError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The Call Message Event Type is invalid and is not understood by Twilio Voice."
        ];
        this.code = 31210;
        this.description = "Call Message Event Type is invalid.";
        this.explanation = "The Call Message Event Type is invalid and is not understood by Twilio Voice.";
        this.name = "CallMessageEventTypeInvalidError";
        this.solutions = [
          "Ensure the Call Message Event Type is Valid and understood by Twilio Voice and try again."
        ];
        Object.setPrototypeOf(this, AuthorizationErrors2.CallMessageEventTypeInvalidError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.CallMessageEventTypeInvalidError = CallMessageEventTypeInvalidError;
    class PayloadSizeExceededError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The payload size of Call Message Event exceeds the authorized limit."
        ];
        this.code = 31212;
        this.description = "Call Message Event Payload size exceeded authorized limit.";
        this.explanation = "The request performed to send a Call Message Event exceeds the payload size authorized limit";
        this.name = "PayloadSizeExceededError";
        this.solutions = [
          "Reduce payload size of Call Message Event to be within the authorized limit and try again."
        ];
        Object.setPrototypeOf(this, AuthorizationErrors2.PayloadSizeExceededError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    AuthorizationErrors2.PayloadSizeExceededError = PayloadSizeExceededError;
  })(AuthorizationErrors || (AuthorizationErrors = {}));
  var UserMediaErrors;
  (function(UserMediaErrors2) {
    class PermissionDeniedError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The user denied the getUserMedia request.",
          "The browser denied the getUserMedia request."
        ];
        this.code = 31401;
        this.description = "UserMedia Permission Denied Error";
        this.explanation = "The browser or end-user denied permissions to user media. Therefore we were unable to acquire input audio.";
        this.name = "PermissionDeniedError";
        this.solutions = [
          "The user should accept the request next time prompted. If the browser saved the deny, the user should change that permission in their browser.",
          "The user should to verify that the browser has permission to access the microphone at this address."
        ];
        Object.setPrototypeOf(this, UserMediaErrors2.PermissionDeniedError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    UserMediaErrors2.PermissionDeniedError = PermissionDeniedError;
    class AcquisitionFailedError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "NotFoundError - The deviceID specified was not found.",
          "The getUserMedia constraints were overconstrained and no devices matched."
        ];
        this.code = 31402;
        this.description = "UserMedia Acquisition Failed Error";
        this.explanation = "The browser and end-user allowed permissions, however getting the media failed. Usually this is due to bad constraints, but can sometimes fail due to browser, OS or hardware issues.";
        this.name = "AcquisitionFailedError";
        this.solutions = [
          "Ensure the deviceID being specified exists.",
          "Try acquiring media with fewer constraints."
        ];
        Object.setPrototypeOf(this, UserMediaErrors2.AcquisitionFailedError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    UserMediaErrors2.AcquisitionFailedError = AcquisitionFailedError;
  })(UserMediaErrors || (UserMediaErrors = {}));
  var SignalingErrors;
  (function(SignalingErrors2) {
    class ConnectionError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [];
        this.code = 53e3;
        this.description = "Signaling connection error";
        this.explanation = "Raised whenever a signaling connection error occurs that is not covered by a more specific error code.";
        this.name = "ConnectionError";
        this.solutions = [];
        Object.setPrototypeOf(this, SignalingErrors2.ConnectionError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    SignalingErrors2.ConnectionError = ConnectionError;
    class ConnectionDisconnected extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The device running your application lost its Internet connection."
        ];
        this.code = 53001;
        this.description = "Signaling connection disconnected";
        this.explanation = "Raised whenever the signaling connection is unexpectedly disconnected.";
        this.name = "ConnectionDisconnected";
        this.solutions = [
          "Ensure the device running your application has access to a stable Internet connection."
        ];
        Object.setPrototypeOf(this, SignalingErrors2.ConnectionDisconnected.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    SignalingErrors2.ConnectionDisconnected = ConnectionDisconnected;
  })(SignalingErrors || (SignalingErrors = {}));
  var MediaErrors;
  (function(MediaErrors2) {
    class ClientLocalDescFailed extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The Client may not be using a supported WebRTC implementation.",
          "The Client may not have the necessary resources to create or apply a new media description."
        ];
        this.code = 53400;
        this.description = "Client is unable to create or apply a local media description";
        this.explanation = "Raised whenever a Client is unable to create or apply a local media description.";
        this.name = "ClientLocalDescFailed";
        this.solutions = [
          "If you are experiencing this error using the JavaScript SDK, ensure you are running it with a supported WebRTC implementation."
        ];
        Object.setPrototypeOf(this, MediaErrors2.ClientLocalDescFailed.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MediaErrors2.ClientLocalDescFailed = ClientLocalDescFailed;
    class ClientRemoteDescFailed extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The Client may not be using a supported WebRTC implementation.",
          "The Client may be connecting peer-to-peer with another Participant that is not using a supported WebRTC implementation.",
          "The Client may not have the necessary resources to apply a new media description."
        ];
        this.code = 53402;
        this.description = "Client is unable to apply a remote media description";
        this.explanation = "Raised whenever the Client receives a remote media description but is unable to apply it.";
        this.name = "ClientRemoteDescFailed";
        this.solutions = [
          "If you are experiencing this error using the JavaScript SDK, ensure you are running it with a supported WebRTC implementation."
        ];
        Object.setPrototypeOf(this, MediaErrors2.ClientRemoteDescFailed.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MediaErrors2.ClientRemoteDescFailed = ClientRemoteDescFailed;
    class ConnectionError extends TwilioError {
      /**
       * @internal
       */
      constructor(messageOrError, error2) {
        super(messageOrError, error2);
        this.causes = [
          "The Client was unable to establish a media connection.",
          "A media connection which was active failed liveliness checks."
        ];
        this.code = 53405;
        this.description = "Media connection failed";
        this.explanation = "Raised by the Client or Server whenever a media connection fails.";
        this.name = "ConnectionError";
        this.solutions = [
          "If the problem persists, try connecting to another region.",
          "Check your Client's network connectivity.",
          "If you've provided custom ICE Servers then ensure that the URLs and credentials are valid."
        ];
        Object.setPrototypeOf(this, MediaErrors2.ConnectionError.prototype);
        const message = typeof messageOrError === "string" ? messageOrError : this.explanation;
        const originalError = typeof messageOrError === "object" ? messageOrError : error2;
        this.message = `${this.name} (${this.code}): ${message}`;
        this.originalError = originalError;
      }
    }
    MediaErrors2.ConnectionError = ConnectionError;
  })(MediaErrors || (MediaErrors = {}));
  var errorsByCode = /* @__PURE__ */ new Map([
    [20101, AuthorizationErrors.AccessTokenInvalid],
    [20104, AuthorizationErrors.AccessTokenExpired],
    [20151, AuthorizationErrors.AuthenticationFailed],
    [31202, SignatureValidationErrors.AccessTokenSignatureValidationFailed],
    [31400, ClientErrors.BadRequest],
    [31404, ClientErrors.NotFound],
    [31480, ClientErrors.TemporarilyUnavailable],
    [31486, ClientErrors.BusyHere],
    [31603, SIPServerErrors.Decline],
    [31e3, GeneralErrors.UnknownError],
    [31001, GeneralErrors.ApplicationNotFoundError],
    [31002, GeneralErrors.ConnectionDeclinedError],
    [31003, GeneralErrors.ConnectionTimeoutError],
    [31005, GeneralErrors.ConnectionError],
    [31008, GeneralErrors.CallCancelledError],
    [31009, GeneralErrors.TransportError],
    [31100, MalformedRequestErrors.MalformedRequestError],
    [31101, MalformedRequestErrors.MissingParameterArrayError],
    [31102, MalformedRequestErrors.AuthorizationTokenMissingError],
    [31103, MalformedRequestErrors.MaxParameterLengthExceededError],
    [31104, MalformedRequestErrors.InvalidBridgeTokenError],
    [31105, MalformedRequestErrors.InvalidClientNameError],
    [31107, MalformedRequestErrors.ReconnectParameterInvalidError],
    [31201, AuthorizationErrors.AuthorizationError],
    [31203, AuthorizationErrors.NoValidAccountError],
    [31204, AuthorizationErrors.InvalidJWTTokenError],
    [31205, AuthorizationErrors.JWTTokenExpiredError],
    [31206, AuthorizationErrors.RateExceededError],
    [31207, AuthorizationErrors.JWTTokenExpirationTooLongError],
    [31209, AuthorizationErrors.ReconnectAttemptError],
    [31210, AuthorizationErrors.CallMessageEventTypeInvalidError],
    [31212, AuthorizationErrors.PayloadSizeExceededError],
    [31401, UserMediaErrors.PermissionDeniedError],
    [31402, UserMediaErrors.AcquisitionFailedError],
    [53e3, SignalingErrors.ConnectionError],
    [53001, SignalingErrors.ConnectionDisconnected],
    [53400, MediaErrors.ClientLocalDescFailed],
    [53402, MediaErrors.ClientRemoteDescFailed],
    [53405, MediaErrors.ConnectionError]
  ]);
  Object.freeze(errorsByCode);

  // node_modules/@twilio/voice-sdk/esm/twilio/errors/index.js
  var PRECISE_SIGNALING_ERROR_CODES = /* @__PURE__ */ new Set([
    /**
     * 310XX Errors
     */
    31001,
    31002,
    31003,
    /**
     * 311XX Errors
     */
    31101,
    31102,
    31103,
    31104,
    31105,
    31107,
    /**
     * 312XX Errors
     */
    31201,
    31202,
    31203,
    31204,
    31205,
    31207,
    /**
     * 314XX Errors
     */
    31404,
    31480,
    31486,
    /**
     * 316XX Errors
     */
    31603
  ]);
  function getPreciseSignalingErrorByCode(enableImprovedSignalingErrorPrecision, errorCode) {
    if (typeof errorCode !== "number") {
      return;
    }
    if (!hasErrorByCode(errorCode)) {
      return;
    }
    const shouldTransform = enableImprovedSignalingErrorPrecision ? true : !PRECISE_SIGNALING_ERROR_CODES.has(errorCode);
    if (!shouldTransform) {
      return;
    }
    return getErrorByCode(errorCode);
  }
  var InvalidArgumentError = class extends Error {
    /**
     * @internal
     */
    constructor(message) {
      super(message);
      this.name = "InvalidArgumentError";
    }
  };
  var InvalidStateError = class extends Error {
    /**
     * @internal
     */
    constructor(message) {
      super(message);
      this.name = "InvalidStateError";
    }
  };
  var NotSupportedError = class extends Error {
    /**
     * @internal
     */
    constructor(message) {
      super(message);
      this.name = "NotSupportedError";
    }
  };
  function getErrorByCode(code) {
    const error2 = errorsByCode.get(code);
    if (!error2) {
      throw new InvalidArgumentError(`Error code ${code} not found`);
    }
    return error2;
  }
  function hasErrorByCode(code) {
    return errorsByCode.has(code);
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/log.js
  var loglevel = __toESM(require_loglevel());

  // node_modules/@twilio/voice-sdk/esm/twilio/constants.js
  var PACKAGE_NAME = "@twilio/voice-sdk";
  var RELEASE_VERSION = "2.18.0";
  var SOUNDS_BASE_URL = "https://sdk.twilio.com/js/client/sounds/releases/1.0.0";
  var COWBELL_AUDIO_URL = `${SOUNDS_BASE_URL}/cowbell.mp3?cache=${RELEASE_VERSION}`;
  var ECHO_TEST_DURATION = 2e4;

  // node_modules/@twilio/voice-sdk/esm/twilio/log.js
  var Log = class _Log {
    /**
     * Return the `loglevel` instance maintained internally.
     * @param [options] - Optional settings
     * @returns The `loglevel` instance.
     */
    static getLogLevelInstance(options) {
      if (!_Log.loglevelInstance) {
        try {
          _Log.loglevelInstance = (options && options.LogLevelModule ? options.LogLevelModule : loglevel).getLogger(PACKAGE_NAME);
        } catch (_a) {
          console.warn("Cannot create custom logger");
          _Log.loglevelInstance = console;
        }
      }
      return _Log.loglevelInstance;
    }
    /**
     * @constructor
     * @param [tag] - tag name for the logs
     * @param [options] - Optional settings
     */
    constructor(tag, options) {
      this._log = _Log.getLogLevelInstance(options);
      this._prefix = `[TwilioVoice][${tag}]`;
    }
    /**
     * Log a debug message
     * @param args - Any number of arguments to be passed to loglevel.debug
     */
    debug(...args) {
      this._log.debug(this._prefix, ...args);
    }
    /**
     * Log an error message
     * @param args - Any number of arguments to be passed to loglevel.error
     */
    error(...args) {
      this._log.error(this._prefix, ...args);
    }
    /**
     * Log an info message
     * @param args - Any number of arguments to be passed to loglevel.info
     */
    info(...args) {
      this._log.info(this._prefix, ...args);
    }
    /**
     * Set a default log level to disable all logging below the given level
     */
    setDefaultLevel(level) {
      if (this._log.setDefaultLevel) {
        this._log.setDefaultLevel(level);
      } else {
        console.warn("Logger cannot setDefaultLevel");
      }
    }
    /**
     * Log a warning message
     * @param args - Any number of arguments to be passed to loglevel.warn
     */
    warn(...args) {
      this._log.warn(this._prefix, ...args);
    }
  };
  Log.levels = loglevel.levels;
  var Logger = Log.getLogLevelInstance();

  // node_modules/@twilio/voice-sdk/esm/twilio/outputdevicecollection.js
  var DEFAULT_TEST_SOUND_URL = `${SOUNDS_BASE_URL}/outgoing.mp3`;
  var OutputDeviceCollection = class {
    /**
     * @internal
     */
    constructor(_name, _availableDevices, _beforeChange, _isSupported) {
      this._name = _name;
      this._availableDevices = _availableDevices;
      this._beforeChange = _beforeChange;
      this._isSupported = _isSupported;
      this._activeDevices = /* @__PURE__ */ new Set();
      this._log = new Log("OutputDeviceCollection");
    }
    /**
     * Delete a device from the collection. If no devices remain, the 'default'
     * device will be added as the sole device. If no `default` device exists,
     * the first available device will be used.
     * @param device - The device to delete from the collection
     * @returns whether the device was present before it was deleted
     */
    delete(device2) {
      this._log.debug(".delete", device2);
      const wasDeleted = !!this._activeDevices.delete(device2);
      const defaultDevice = this._availableDevices.get("default") || Array.from(this._availableDevices.values())[0];
      if (!this._activeDevices.size && defaultDevice) {
        this._activeDevices.add(defaultDevice);
      }
      const deviceIds = Array.from(this._activeDevices.values()).map((deviceInfo) => deviceInfo.deviceId);
      this._beforeChange(this._name, deviceIds);
      return !!wasDeleted;
    }
    /**
     * Get the current set of devices.
     */
    get() {
      return this._activeDevices;
    }
    /**
     * Replace the current set of devices with a new set of devices.
     * @param deviceIdOrIds - An ID or array of IDs of devices to replace the existing devices with.
     * @returns Rejects if this feature is not supported, any of the supplied IDs are not found,
     * or no IDs are passed.
     */
    set(deviceIdOrIds) {
      this._log.debug(".set", deviceIdOrIds);
      if (!this._isSupported) {
        return Promise.reject(new NotSupportedError("This browser does not support audio output selection"));
      }
      const deviceIds = Array.isArray(deviceIdOrIds) ? deviceIdOrIds : [deviceIdOrIds];
      if (!deviceIds.length) {
        return Promise.reject(new InvalidArgumentError("Must specify at least one device to set"));
      }
      const missingIds = [];
      const devices = deviceIds.map((id) => {
        const device2 = this._availableDevices.get(id);
        if (!device2) {
          missingIds.push(id);
        }
        return device2;
      });
      if (missingIds.length) {
        return Promise.reject(new InvalidArgumentError(`Devices not found: ${missingIds.join(", ")}`));
      }
      return new Promise((resolve) => {
        resolve(this._beforeChange(this._name, deviceIds));
      }).then(() => {
        this._activeDevices.clear();
        devices.forEach(this._activeDevices.add, this._activeDevices);
      });
    }
    /**
     * Test the devices by playing audio through them.
     * @param [soundUrl] - An optional URL. If none is specified, we will
     *   play a default test tone.
     * @returns Resolves with the result of the underlying HTMLAudioElements' play() calls.
     */
    test(soundUrl = DEFAULT_TEST_SOUND_URL) {
      if (!this._isSupported) {
        return Promise.reject(new NotSupportedError("This browser does not support audio output selection"));
      }
      if (!this._activeDevices.size) {
        return Promise.reject(new InvalidStateError("No active output devices to test"));
      }
      return Promise.all(Array.from(this._activeDevices).map((device2) => {
        let el;
        return new Promise((resolve) => {
          el = new Audio(soundUrl);
          el.oncanplay = resolve;
        }).then(() => el.setSinkId(device2.deviceId).then(() => el.play()));
      }));
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/shims/mediadeviceinfo.js
  var MediaDeviceInfoShim = class {
    constructor(options) {
      Object.defineProperties(this, {
        deviceId: { get() {
          return options.deviceId;
        } },
        groupId: { get() {
          return options.groupId;
        } },
        kind: { get() {
          return options.kind;
        } },
        label: { get() {
          return options.label;
        } }
      });
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/util.js
  var util_exports = {};
  __export(util_exports, {
    Exception: () => Exception,
    average: () => average,
    difference: () => difference,
    flatMap: () => flatMap,
    isChrome: () => isChrome,
    isElectron: () => isElectron,
    isFirefox: () => isFirefox,
    isLegacyEdge: () => isLegacyEdge,
    isSafari: () => isSafari,
    promisifyEvents: () => promisifyEvents,
    queryToJson: () => queryToJson,
    sortByMimeTypes: () => sortByMimeTypes
  });
  function TwilioException(message) {
    if (!(this instanceof TwilioException)) {
      return new TwilioException(message);
    }
    this.message = message;
  }
  TwilioException.prototype.toString = function() {
    return `Twilio.Exception: ${this.message}`;
  };
  function average(values) {
    return values && values.length ? values.reduce((t, v) => t + v) / values.length : 0;
  }
  function difference(lefts, rights, getKey) {
    getKey = getKey || ((a) => a);
    const rightKeys = new Set(rights.map(getKey));
    return lefts.filter((left) => !rightKeys.has(getKey(left)));
  }
  function isElectron(navigator2) {
    return !!navigator2.userAgent.match("Electron");
  }
  function isChrome(window2, navigator2) {
    const isCriOS = !!navigator2.userAgent.match("CriOS");
    const isHeadlessChrome = !!navigator2.userAgent.match("HeadlessChrome");
    const isGoogle = typeof window2.chrome !== "undefined" && navigator2.vendor === "Google Inc." && navigator2.userAgent.indexOf("OPR") === -1 && navigator2.userAgent.indexOf("Edge") === -1;
    return isCriOS || isElectron(navigator2) || isGoogle || isHeadlessChrome;
  }
  function isFirefox(navigator2) {
    navigator2 = navigator2 || (typeof window === "undefined" ? global.navigator : window.navigator);
    return !!navigator2 && typeof navigator2.userAgent === "string" && /firefox|fxios/i.test(navigator2.userAgent);
  }
  function isLegacyEdge(navigator2) {
    navigator2 = navigator2 || (typeof window === "undefined" ? global.navigator : window.navigator);
    return !!navigator2 && typeof navigator2.userAgent === "string" && /edge\/\d+/i.test(navigator2.userAgent);
  }
  function isSafari(navigator2) {
    return !!navigator2.vendor && navigator2.vendor.indexOf("Apple") !== -1 && navigator2.userAgent && navigator2.userAgent.indexOf("CriOS") === -1 && navigator2.userAgent.indexOf("FxiOS") === -1;
  }
  function queryToJson(params) {
    if (!params) {
      return "";
    }
    return params.split("&").reduce((output, pair) => {
      const parts = pair.split("=");
      const key = parts[0];
      const value = decodeURIComponent((parts[1] || "").replace(/\+/g, "%20"));
      if (key) {
        output[key] = value;
      }
      return output;
    }, {});
  }
  function flatMap(list, mapFn) {
    const listArray = list instanceof Map || list instanceof Set ? Array.from(list.values()) : list;
    mapFn = mapFn || ((item) => item);
    return listArray.reduce((flattened, item) => {
      const mapped = mapFn(item);
      return flattened.concat(mapped);
    }, []);
  }
  function promisifyEvents(emitter, resolveEventName, rejectEventName) {
    return new Promise((resolve, reject) => {
      function resolveHandler() {
        emitter.removeListener(rejectEventName, rejectHandler);
        resolve();
      }
      function rejectHandler() {
        emitter.removeListener(resolveEventName, resolveHandler);
        reject();
      }
      emitter.once(resolveEventName, resolveHandler);
      emitter.once(rejectEventName, rejectHandler);
    });
  }
  function sortByMimeTypes(codecs, preferredOrder) {
    const preferredCodecs = preferredOrder.map((codec) => "audio/" + codec.toLowerCase());
    return codecs.sort((a, b) => {
      const indexA = preferredCodecs.indexOf(a.mimeType.toLowerCase());
      const indexB = preferredCodecs.indexOf(b.mimeType.toLowerCase());
      const orderA = indexA >= 0 ? indexA : Number.MAX_VALUE;
      const orderB = indexB >= 0 ? indexB : Number.MAX_VALUE;
      return orderA - orderB;
    });
  }
  var Exception = TwilioException;

  // node_modules/@twilio/voice-sdk/esm/twilio/audiohelper.js
  var kindAliases = {
    audioinput: "Audio Input",
    audiooutput: "Audio Output"
  };
  var AudioHelper = class extends import_events2.EventEmitter {
    /**
     * The currently set audio constraints set by setAudioConstraints(). Starts as null.
     */
    get audioConstraints() {
      return this._audioConstraints;
    }
    /**
     * The active input device. Having no inputDevice specified by `setInputDevice()`
     * will disable input selection related functionality.
     */
    get inputDevice() {
      return this._inputDevice;
    }
    /**
     * The current input stream coming from the microphone device or
     * the processed audio stream if there is an {@link AudioProcessor}.
     */
    get inputStream() {
      return this._localProcessedStream || this._selectedInputDeviceStream;
    }
    /**
     * The processed stream if a local {@link AudioProcessor} was previously added.
     * @deprecated Use {@link AudioHelper#localProcessedStream} instead.
     */
    get processedStream() {
      this._log.warn("AudioHelper#processedStream is deprecated. Please use AudioHelper#localProcessedStream instead.");
      return this._localProcessedStream;
    }
    /**
     * The processed stream if a local {@link AudioProcessor} was previously added.
     */
    get localProcessedStream() {
      return this._localProcessedStream;
    }
    /**
     * The processed stream if a remote {@link AudioProcessor} was previously added.
     */
    get remoteProcessedStream() {
      return this._remoteProcessedStream;
    }
    /**
     * @internal
     * @param onActiveOutputsChanged - A callback to be called when the user changes the active output devices.
     * @param onActiveInputChanged - A callback to be called when the user changes the active input device.
     * @param [options]
     */
    constructor(onActiveOutputsChanged, onActiveInputChanged, options) {
      super();
      this.availableInputDevices = /* @__PURE__ */ new Map();
      this.availableOutputDevices = /* @__PURE__ */ new Map();
      this._audioConstraints = null;
      this._defaultInputDeviceStream = null;
      this._enabledSounds = {
        [Device.SoundName.Disconnect]: true,
        [Device.SoundName.Incoming]: true,
        [Device.SoundName.Outgoing]: true
      };
      this._inputDevice = null;
      this._inputDevicePromise = null;
      this._isPollingInputVolume = false;
      this._log = new Log("AudioHelper");
      this._localProcessedStream = null;
      this._remoteProcessedStream = null;
      this._selectedInputDeviceStream = null;
      this._unknownDeviceIndexes = {
        audioinput: {},
        audiooutput: {}
      };
      this._updateAvailableDevices = () => {
        if (!this._mediaDevices || !this._enumerateDevices) {
          return Promise.reject("Enumeration not supported");
        }
        return this._enumerateDevices().then((devices) => {
          this._updateDevices(devices.filter((d) => d.kind === "audiooutput"), this.availableOutputDevices, this._removeLostOutput);
          this._updateDevices(devices.filter((d) => d.kind === "audioinput"), this.availableInputDevices, this._removeLostInput);
          const defaultDevice = this.availableOutputDevices.get("default") || Array.from(this.availableOutputDevices.values())[0];
          [this.speakerDevices, this.ringtoneDevices].forEach((outputDevices) => {
            if (!outputDevices.get().size && this.availableOutputDevices.size && this.isOutputSelectionSupported) {
              outputDevices.set(defaultDevice.deviceId).catch((reason) => {
                this._log.warn(`Unable to set audio output devices. ${reason}`);
              });
            }
          });
        });
      };
      this._removeLostInput = (lostDevice) => {
        if (!this.inputDevice || this.inputDevice.deviceId !== lostDevice.deviceId) {
          return false;
        }
        this._destroyLocalProcessedStream();
        this._replaceStream(null);
        this._inputDevice = null;
        this._maybeStopPollingVolume();
        const defaultDevice = this.availableInputDevices.get("default") || Array.from(this.availableInputDevices.values())[0];
        if (defaultDevice) {
          this.setInputDevice(defaultDevice.deviceId);
        }
        return true;
      };
      this._removeLostOutput = (lostDevice) => {
        const wasSpeakerLost = this.speakerDevices.delete(lostDevice);
        const wasRingtoneLost = this.ringtoneDevices.delete(lostDevice);
        return wasSpeakerLost || wasRingtoneLost;
      };
      options = Object.assign({
        AudioContext: typeof AudioContext !== "undefined" && AudioContext,
        setSinkId: typeof HTMLAudioElement !== "undefined" && HTMLAudioElement.prototype.setSinkId
      }, options);
      this._beforeSetInputDevice = options.beforeSetInputDevice || (() => Promise.resolve());
      this._updateUserOptions(options);
      this._audioProcessorEventObserver = options.audioProcessorEventObserver;
      this._mediaDevices = options.mediaDevices || navigator.mediaDevices;
      this._onActiveInputChanged = onActiveInputChanged;
      this._enumerateDevices = typeof options.enumerateDevices === "function" ? options.enumerateDevices : this._mediaDevices && this._mediaDevices.enumerateDevices.bind(this._mediaDevices);
      const isAudioContextSupported = !!(options.AudioContext || options.audioContext);
      const isEnumerationSupported = !!this._enumerateDevices;
      if (options.enabledSounds) {
        this._enabledSounds = options.enabledSounds;
      }
      const isSetSinkSupported = typeof options.setSinkId === "function";
      this.isOutputSelectionSupported = isEnumerationSupported && isSetSinkSupported;
      this.isVolumeSupported = isAudioContextSupported;
      if (this.isVolumeSupported) {
        this._audioContext = options.audioContext || options.AudioContext && new options.AudioContext();
        if (this._audioContext) {
          this._inputVolumeAnalyser = this._audioContext.createAnalyser();
          this._inputVolumeAnalyser.fftSize = 32;
          this._inputVolumeAnalyser.smoothingTimeConstant = 0.3;
        }
      }
      this.ringtoneDevices = new OutputDeviceCollection("ringtone", this.availableOutputDevices, onActiveOutputsChanged, this.isOutputSelectionSupported);
      this.speakerDevices = new OutputDeviceCollection("speaker", this.availableOutputDevices, onActiveOutputsChanged, this.isOutputSelectionSupported);
      this.addListener("newListener", (eventName) => {
        if (eventName === "inputVolume") {
          this._maybeStartPollingVolume();
        }
      });
      this.addListener("removeListener", (eventName) => {
        if (eventName === "inputVolume") {
          this._maybeStopPollingVolume();
        }
      });
      this.once("newListener", () => {
        if (!this.isOutputSelectionSupported) {
          this._log.warn("Warning: This browser does not support audio output selection.");
        }
        if (!this.isVolumeSupported) {
          this._log.warn(`Warning: This browser does not support Twilio's volume indicator feature.`);
        }
      });
      if (isEnumerationSupported) {
        this._initializeEnumeration();
      }
      if (navigator && navigator.permissions && typeof navigator.permissions.query === "function") {
        navigator.permissions.query({ name: "microphone" }).then((microphonePermissionStatus) => {
          if (microphonePermissionStatus.state !== "granted") {
            const handleStateChange = () => {
              this._updateAvailableDevices();
              this._stopMicrophonePermissionListener();
            };
            microphonePermissionStatus.addEventListener("change", handleStateChange);
            this._microphonePermissionStatus = microphonePermissionStatus;
            this._onMicrophonePermissionStatusChanged = handleStateChange;
          }
        }).catch((reason) => this._log.warn(`Warning: unable to listen for microphone permission changes. ${reason}`));
      } else {
        this._log.warn("Warning: current browser does not support permissions API.");
      }
    }
    /**
     * Destroy this AudioHelper instance
     * @internal
     */
    _destroy() {
      this._stopDefaultInputDeviceStream();
      this._stopSelectedInputDeviceStream();
      this._destroyLocalProcessedStream();
      this._destroyRemoteProcessedStream();
      this._maybeStopPollingVolume();
      this.removeAllListeners();
      this._stopMicrophonePermissionListener();
      this._unbind();
    }
    /**
     * Destroys the remote processed stream and updates references.
     * @internal
     */
    _destroyRemoteProcessedStream() {
      if (this._remoteProcessor && this._remoteProcessedStream) {
        this._log.info("destroying remote processed stream");
        const remoteProcessedStream = this._remoteProcessedStream;
        this._remoteProcessedStream.getTracks().forEach((track) => track.stop());
        this._remoteProcessedStream = null;
        this._remoteProcessor.destroyProcessedStream(remoteProcessedStream);
        this._audioProcessorEventObserver.emit("destroy", true);
      }
    }
    /**
     * Promise to wait for the input device, if setInputDevice is called outside of the SDK.
     * @internal
     */
    _getInputDevicePromise() {
      return this._inputDevicePromise;
    }
    /**
     * The current AudioProcessorEventObserver instance.
     * @internal
     */
    _getAudioProcessorEventObserver() {
      return this._audioProcessorEventObserver;
    }
    /**
     * Route remote stream to the processor if it exists.
     * @internal
     */
    _maybeCreateRemoteProcessedStream(stream) {
      if (this._remoteProcessor) {
        this._log.info("Creating remote processed stream");
        return this._remoteProcessor.createProcessedStream(stream).then((processedStream) => {
          this._remoteProcessedStream = processedStream;
          this._audioProcessorEventObserver.emit("create", true);
          return this._remoteProcessedStream;
        });
      }
      return Promise.resolve(stream);
    }
    /**
     * Start polling volume if it's supported and there's an input stream to poll.
     * @internal
     */
    _maybeStartPollingVolume() {
      if (!this.isVolumeSupported || !this.inputStream) {
        return;
      }
      this._updateVolumeSource();
      if (this._isPollingInputVolume || !this._inputVolumeAnalyser) {
        return;
      }
      const bufferLength = this._inputVolumeAnalyser.frequencyBinCount;
      const buffer = new Uint8Array(bufferLength);
      this._isPollingInputVolume = true;
      const emitVolume = () => {
        if (!this._isPollingInputVolume) {
          return;
        }
        if (this._inputVolumeAnalyser) {
          this._inputVolumeAnalyser.getByteFrequencyData(buffer);
          const inputVolume = average(buffer);
          this.emit("inputVolume", inputVolume / 255);
        }
        requestAnimationFrame(emitVolume);
      };
      requestAnimationFrame(emitVolume);
    }
    /**
     * Stop polling volume if it's currently polling and there are no listeners.
     * @internal
     */
    _maybeStopPollingVolume() {
      if (!this.isVolumeSupported) {
        return;
      }
      if (!this._isPollingInputVolume || this.inputStream && this.listenerCount("inputVolume")) {
        return;
      }
      if (this._inputVolumeSource) {
        this._inputVolumeSource.disconnect();
        delete this._inputVolumeSource;
      }
      this._isPollingInputVolume = false;
    }
    /**
     * Call getUserMedia with specified constraints
     * @internal
     */
    _openDefaultDeviceWithConstraints(constraints) {
      this._log.info("Opening default device with constraints", constraints);
      return this._getUserMedia(constraints).then((stream) => {
        this._log.info("Opened default device. Updating available devices.");
        this._updateAvailableDevices().catch((error2) => {
          this._log.warn("Unable to updateAvailableDevices after gUM call", error2);
        });
        this._defaultInputDeviceStream = stream;
        return this._maybeCreateLocalProcessedStream(stream);
      });
    }
    /**
     * Stop the default audio stream
     * @internal
     */
    _stopDefaultInputDeviceStream() {
      if (this._defaultInputDeviceStream) {
        this._log.info("stopping default device stream");
        this._defaultInputDeviceStream.getTracks().forEach((track) => track.stop());
        this._defaultInputDeviceStream = null;
        this._destroyLocalProcessedStream();
      }
    }
    /**
     * Unbind the listeners from mediaDevices.
     * @internal
     */
    _unbind() {
      var _a;
      if ((_a = this._mediaDevices) === null || _a === void 0 ? void 0 : _a.removeEventListener) {
        this._mediaDevices.removeEventListener("devicechange", this._updateAvailableDevices);
      }
    }
    /**
     * Update AudioHelper options that can be changed by the user
     * @internal
     */
    _updateUserOptions(options) {
      if (typeof options.enumerateDevices === "function") {
        this._enumerateDevices = options.enumerateDevices;
      }
      if (typeof options.getUserMedia === "function") {
        this._getUserMedia = options.getUserMedia;
      }
    }
    /**
     * Adds an {@link AudioProcessor} object and returns a Promise representing the result.
     * To add a remote AudioProcessor, pass `true`. To add a local AudioProcessor, pass `false`.
     * The default value is `false`.
     *
     * If `isRemote` is `false`, the AudioHelper routes the input audio stream through the
     * processor before sending the audio stream to Twilio. If `isRemote` is `true`, the AudioHelper
     * routes the output audio stream through the processor before playing it on the speaker.
     *
     * See the {@link AudioProcessor} interface for an example.
     *
     * @param processor The AudioProcessor to add.
     * @param isRemote If set to true, the processor will be applied to the remote
     * audio track. Default value is false.
     * @returns
     */
    addProcessor(processor, isRemote = false) {
      this._log.debug(".addProcessor");
      if (this._localProcessor && !isRemote) {
        throw new NotSupportedError("Can only have one Local AudioProcessor at a time.");
      }
      if (this._remoteProcessor && isRemote) {
        throw new NotSupportedError("Can only have one Remote AudioProcessor at a time.");
      }
      if (typeof processor !== "object" || processor === null) {
        throw new InvalidArgumentError("Missing AudioProcessor argument.");
      }
      if (typeof processor.createProcessedStream !== "function") {
        throw new InvalidArgumentError("Missing createProcessedStream() method.");
      }
      if (typeof processor.destroyProcessedStream !== "function") {
        throw new InvalidArgumentError("Missing destroyProcessedStream() method.");
      }
      if (isRemote) {
        this._remoteProcessor = processor;
        this._audioProcessorEventObserver.emit("add", true);
        return Promise.resolve();
      } else {
        this._localProcessor = processor;
        this._audioProcessorEventObserver.emit("add", false);
        return this._restartInputStreams();
      }
    }
    /**
     * Enable or disable the disconnect sound.
     * @param doEnable Passing `true` will enable the sound and `false` will disable the sound.
     * Not passing this parameter will not alter the enable-status of the sound.
     * @returns The enable-status of the sound.
     */
    disconnect(doEnable) {
      this._log.debug(".disconnect", doEnable);
      return this._maybeEnableSound(Device.SoundName.Disconnect, doEnable);
    }
    /**
     * Enable or disable the incoming sound.
     * @param doEnable Passing `true` will enable the sound and `false` will disable the sound.
     * Not passing this parameter will not alter the enable-status of the sound.
     * @returns The enable-status of the sound.
     */
    incoming(doEnable) {
      this._log.debug(".incoming", doEnable);
      return this._maybeEnableSound(Device.SoundName.Incoming, doEnable);
    }
    /**
     * Enable or disable the outgoing sound.
     * @param doEnable Passing `true` will enable the sound and `false` will disable the sound.
     * Not passing this parameter will not alter the enable-status of the sound.
     * @returns The enable-status of the sound.
     */
    outgoing(doEnable) {
      this._log.debug(".outgoing", doEnable);
      return this._maybeEnableSound(Device.SoundName.Outgoing, doEnable);
    }
    /**
     * Removes an {@link AudioProcessor} and returns a Promise representing the result.
     * To remove a remote AudioProcessor, pass `true`. To remove a local AudioProcessor,
     * pass `false`. The default value is `false`.
     *
     * If `isRemote` is `false`, the AudioHelper uses the audio stream from the selected
     * input device for existing or future calls. If `isRemote` is `true`, the AudioHelper
     * uses the audio stream from the selected output device for existing or future calls.
     *
     * @param processor The AudioProcessor to remove.
     * @param isRemote If set to true, the processor will be removed from the remote
     * audio track. Default value is false.
     * @returns
     */
    removeProcessor(processor, isRemote = false) {
      this._log.debug(".removeProcessor");
      if (typeof processor !== "object" || processor === null) {
        throw new InvalidArgumentError("Missing AudioProcessor argument.");
      }
      if (this._localProcessor !== processor && !isRemote) {
        throw new InvalidArgumentError("Cannot remove a Local AudioProcessor that has not been previously added.");
      }
      if (this._remoteProcessor !== processor && isRemote) {
        throw new InvalidArgumentError("Cannot remove a Remote AudioProcessor that has not been previously added.");
      }
      if (isRemote) {
        this._destroyRemoteProcessedStream();
        this._remoteProcessor = null;
        this._audioProcessorEventObserver.emit("remove", true);
        return Promise.resolve();
      } else {
        this._destroyLocalProcessedStream();
        this._localProcessor = null;
        this._audioProcessorEventObserver.emit("remove", false);
        return this._restartInputStreams();
      }
    }
    /**
     * Set the MediaTrackConstraints to be applied on every getUserMedia call for new input
     * device audio. Any deviceId specified here will be ignored. Instead, device IDs should
     * be specified using {@link AudioHelper#setInputDevice}. The returned Promise resolves
     * when the media is successfully reacquired, or immediately if no input device is set.
     * @param audioConstraints - The MediaTrackConstraints to apply.
     */
    setAudioConstraints(audioConstraints) {
      this._log.debug(".setAudioConstraints", audioConstraints);
      this._audioConstraints = Object.assign({}, audioConstraints);
      delete this._audioConstraints.deviceId;
      return this.inputDevice ? this._setInputDevice(this.inputDevice.deviceId, true) : Promise.resolve();
    }
    /**
     * Replace the current input device with a new device by ID.
     *
     * Calling `setInputDevice` sets the stream for current and future calls and
     * will not release it automatically.
     *
     * While this behavior is not an issue, it will result in the application
     * holding onto the input device, and the application may show a red
     * "recording" symbol in the browser tab.
     *
     * To remove the red "recording" symbol, the device must be released. To
     * release it, call `unsetInputDevice` after the call disconnects. Note that
     * after calling `unsetInputDevice` future calls will then use the default
     * input device.
     *
     * Consider application logic that keeps track of the user-selected device
     * and call `setInputDevice` before calling `device.connect()` for outgoing
     * calls and `call.accept()` for incoming calls. Furthermore, consider
     * calling `unsetInputDevice` once a call is disconnected. Below is an
     * example:
     *
     * ```ts
     * import { Device } from '@twilio/voice-sdk';
     * let inputDeviceId = ...;
     * const device = new Device(...);
     *
     * async function makeOutgoingCall() {
     *   await device.audio.setInputDevice(inputDeviceId);
     *   const call = await device.connect(...);
     *
     *   call.on('disconnect', async () => {
     *     inputDeviceId = ... // save the current input device id
     *     await device.audio.unsetInputDevice();
     *   });
     * }
     *
     * async function acceptIncomingCall(incomingCall) {
     *   await device.audio.setInputDevice(inputDeviceId);
     *   await incomingCall.accept();
     *
     *   incomingCall.on('disconnect', async () => {
     *     inputDeviceId = ... // save the current input device id
     *     await device.audio.unsetInputDevice();
     *   });
     * }
     * ```
     *
     * @param deviceId - An ID of a device to replace the existing
     *   input device with.
     */
    setInputDevice(deviceId) {
      this._log.debug(".setInputDevice", deviceId);
      return this._setInputDevice(deviceId, false);
    }
    /**
     * Unset the MediaTrackConstraints to be applied on every getUserMedia call for new input
     * device audio. The returned Promise resolves when the media is successfully reacquired,
     * or immediately if no input device is set.
     */
    unsetAudioConstraints() {
      this._log.debug(".unsetAudioConstraints");
      this._audioConstraints = null;
      return this.inputDevice ? this._setInputDevice(this.inputDevice.deviceId, true) : Promise.resolve();
    }
    /**
     * Unset the input device, stopping the tracks. This should only be called when not in a connection, and
     *   will not allow removal of the input device during a live call.
     */
    unsetInputDevice() {
      this._log.debug(".unsetInputDevice", this.inputDevice);
      if (!this.inputDevice) {
        return Promise.resolve();
      }
      this._destroyLocalProcessedStream();
      return this._onActiveInputChanged(null).then(() => {
        this._replaceStream(null);
        this._inputDevice = null;
        this._maybeStopPollingVolume();
      });
    }
    /**
     * Destroys the local processed stream and updates references.
     */
    _destroyLocalProcessedStream() {
      if (this._localProcessor && this._localProcessedStream) {
        this._log.info("destroying local processed stream");
        const localProcessedStream = this._localProcessedStream;
        this._localProcessedStream.getTracks().forEach((track) => track.stop());
        this._localProcessedStream = null;
        this._localProcessor.destroyProcessedStream(localProcessedStream);
        this._audioProcessorEventObserver.emit("destroy", false);
      }
    }
    /**
     * Get the index of an un-labeled Device.
     * @param mediaDeviceInfo
     * @returns The index of the passed MediaDeviceInfo
     */
    _getUnknownDeviceIndex(mediaDeviceInfo) {
      const id = mediaDeviceInfo.deviceId;
      const kind = mediaDeviceInfo.kind;
      let index = this._unknownDeviceIndexes[kind][id];
      if (!index) {
        index = Object.keys(this._unknownDeviceIndexes[kind]).length + 1;
        this._unknownDeviceIndexes[kind][id] = index;
      }
      return index;
    }
    /**
     * Initialize output device enumeration.
     */
    _initializeEnumeration() {
      if (!this._mediaDevices || !this._enumerateDevices) {
        throw new NotSupportedError("Enumeration is not supported");
      }
      if (this._mediaDevices.addEventListener) {
        this._mediaDevices.addEventListener("devicechange", this._updateAvailableDevices);
      }
      this._updateAvailableDevices().then(() => {
        if (!this.isOutputSelectionSupported) {
          return;
        }
        Promise.all([
          this.speakerDevices.set("default"),
          this.ringtoneDevices.set("default")
        ]).catch((reason) => {
          this._log.warn(`Warning: Unable to set audio output devices. ${reason}`);
        });
      });
    }
    /**
     * Route local stream to the processor if it exists.
     */
    _maybeCreateLocalProcessedStream(stream) {
      if (this._localProcessor) {
        this._log.info("Creating local processed stream");
        return this._localProcessor.createProcessedStream(stream).then((processedStream) => {
          this._localProcessedStream = processedStream;
          this._audioProcessorEventObserver.emit("create", false);
          return this._localProcessedStream;
        });
      }
      return Promise.resolve(stream);
    }
    /**
     * Set whether the sound is enabled or not
     * @param soundName
     * @param doEnable
     * @returns Whether the sound is enabled or not
     */
    _maybeEnableSound(soundName, doEnable) {
      if (typeof doEnable !== "undefined") {
        this._enabledSounds[soundName] = doEnable;
      }
      return this._enabledSounds[soundName];
    }
    /**
     * Stop the tracks on the current input stream before replacing it with the passed stream.
     * @param stream - The new stream
     */
    _replaceStream(stream) {
      this._log.info("Replacing with new stream.");
      if (this._selectedInputDeviceStream) {
        this._log.info("Old stream detected. Stopping tracks.");
        this._stopSelectedInputDeviceStream();
      }
      this._selectedInputDeviceStream = stream;
    }
    /**
     * Restart the active input streams
     */
    _restartInputStreams() {
      if (this.inputDevice && this._selectedInputDeviceStream) {
        this._log.info("Restarting selected input device");
        return this._setInputDevice(this.inputDevice.deviceId, true);
      }
      if (this._defaultInputDeviceStream) {
        const defaultDevice = this.availableInputDevices.get("default") || Array.from(this.availableInputDevices.values())[0];
        this._log.info("Restarting default input device, now becoming selected.");
        return this._setInputDevice(defaultDevice.deviceId, true);
      }
      return Promise.resolve();
    }
    /**
     * Replace the current input device with a new device by ID.
     * @param deviceId - An ID of a device to replace the existing
     *   input device with.
     * @param forceGetUserMedia - If true, getUserMedia will be called even if
     *   the specified device is already active.
     */
    _setInputDevice(deviceId, forceGetUserMedia) {
      return __awaiter(this, void 0, void 0, function* () {
        const setInputDevice = () => __awaiter(this, void 0, void 0, function* () {
          yield this._beforeSetInputDevice();
          if (typeof deviceId !== "string") {
            return Promise.reject(new InvalidArgumentError("Must specify the device to set"));
          }
          const device2 = this.availableInputDevices.get(deviceId);
          if (!device2) {
            return Promise.reject(new InvalidArgumentError(`Device not found: ${deviceId}`));
          }
          this._log.info("Setting input device. ID: " + deviceId);
          if (this._inputDevice && this._inputDevice.deviceId === deviceId && this._selectedInputDeviceStream) {
            if (!forceGetUserMedia) {
              return Promise.resolve();
            }
            this._log.info("Same track detected on setInputDevice, stopping old tracks.");
            this._stopSelectedInputDeviceStream();
          }
          this._stopDefaultInputDeviceStream();
          const constraints = { audio: Object.assign({ deviceId: { exact: deviceId } }, this.audioConstraints) };
          this._log.info("setInputDevice: getting new tracks.");
          return this._getUserMedia(constraints).then((originalStream) => {
            this._destroyLocalProcessedStream();
            return this._maybeCreateLocalProcessedStream(originalStream).then((newStream) => {
              this._log.info("setInputDevice: invoking _onActiveInputChanged.");
              return this._onActiveInputChanged(newStream).then(() => {
                this._replaceStream(originalStream);
                this._inputDevice = device2;
                this._maybeStartPollingVolume();
              });
            });
          });
        });
        return this._inputDevicePromise = setInputDevice().finally(() => {
          this._inputDevicePromise = null;
        });
      });
    }
    /**
     * Remove event listener for microphone permissions
     */
    _stopMicrophonePermissionListener() {
      var _a;
      if ((_a = this._microphonePermissionStatus) === null || _a === void 0 ? void 0 : _a.removeEventListener) {
        this._microphonePermissionStatus.removeEventListener("change", this._onMicrophonePermissionStatusChanged);
      }
    }
    /**
     * Stop the selected audio stream
     */
    _stopSelectedInputDeviceStream() {
      if (this._selectedInputDeviceStream) {
        this._log.info("Stopping selected device stream");
        this._selectedInputDeviceStream.getTracks().forEach((track) => track.stop());
      }
    }
    /**
     * Update a set of devices.
     * @param updatedDevices - An updated list of available Devices
     * @param availableDevices - The previous list of available Devices
     * @param removeLostDevice - The method to call if a previously available Device is
     *   no longer available.
     */
    _updateDevices(updatedDevices, availableDevices, removeLostDevice) {
      const updatedDeviceIds = updatedDevices.map((d) => d.deviceId);
      const knownDeviceIds = Array.from(availableDevices.values()).map((d) => d.deviceId);
      const lostActiveDevices = [];
      const lostDeviceIds = difference(knownDeviceIds, updatedDeviceIds);
      lostDeviceIds.forEach((lostDeviceId) => {
        const lostDevice = availableDevices.get(lostDeviceId);
        if (lostDevice) {
          availableDevices.delete(lostDeviceId);
          if (removeLostDevice(lostDevice)) {
            lostActiveDevices.push(lostDevice);
          }
        }
      });
      let deviceChanged = false;
      updatedDevices.forEach((newDevice) => {
        const existingDevice = availableDevices.get(newDevice.deviceId);
        const newMediaDeviceInfo = this._wrapMediaDeviceInfo(newDevice);
        if (!existingDevice || existingDevice.label !== newMediaDeviceInfo.label) {
          availableDevices.set(newDevice.deviceId, newMediaDeviceInfo);
          deviceChanged = true;
        }
      });
      if (deviceChanged || lostDeviceIds.length) {
        const defaultId = "default";
        const isInputDeviceSet = this.inputDevice && this.inputDevice.deviceId === defaultId;
        const isDefaultDeviceSet = this._defaultInputDeviceStream && this.availableInputDevices.get(defaultId);
        if (isInputDeviceSet || isDefaultDeviceSet) {
          this._log.warn(`Calling getUserMedia after device change to ensure that the           tracks of the active device (default) have not gone stale.`);
          setTimeout(() => {
            this._setInputDevice(defaultId, true);
          }, 0);
        }
        this._log.debug("#deviceChange", lostActiveDevices);
        this.emit("deviceChange", lostActiveDevices);
      }
    }
    /**
     * Disconnect the old input volume source, and create and connect a new one with the current
     * input stream.
     */
    _updateVolumeSource() {
      if (!this.inputStream || !this._audioContext || !this._inputVolumeAnalyser) {
        return;
      }
      if (this._inputVolumeSource) {
        this._inputVolumeSource.disconnect();
      }
      try {
        this._inputVolumeSource = this._audioContext.createMediaStreamSource(this.inputStream);
        this._inputVolumeSource.connect(this._inputVolumeAnalyser);
      } catch (ex) {
        this._log.warn("Unable to update volume source", ex);
        delete this._inputVolumeSource;
      }
    }
    /**
     * Convert a MediaDeviceInfo to a IMediaDeviceInfoShim.
     * @param mediaDeviceInfo - The info to convert
     * @returns The converted shim
     */
    _wrapMediaDeviceInfo(mediaDeviceInfo) {
      const options = {
        deviceId: mediaDeviceInfo.deviceId,
        groupId: mediaDeviceInfo.groupId,
        kind: mediaDeviceInfo.kind,
        label: mediaDeviceInfo.label
      };
      if (!options.label) {
        if (options.deviceId === "default") {
          options.label = "Default";
        } else {
          const index = this._getUnknownDeviceIndex(mediaDeviceInfo);
          options.label = `Unknown ${kindAliases[options.kind]} Device ${index}`;
        }
      }
      return new MediaDeviceInfoShim(options);
    }
  };
  /* @__PURE__ */ (function(AudioHelper2) {
  })(AudioHelper || (AudioHelper = {}));
  var AudioHelper$1 = AudioHelper;

  // node_modules/@twilio/voice-sdk/esm/twilio/audioprocessoreventobserver.js
  var import_events3 = __toESM(require_events());
  var AudioProcessorEventObserver = class extends import_events3.EventEmitter {
    constructor() {
      super();
      this._log = new Log("AudioProcessorEventObserver");
      this._log.info("Creating AudioProcessorEventObserver instance");
      this.on("enabled", (isRemote) => this._reEmitEvent("enabled", isRemote));
      this.on("add", (isRemote) => this._reEmitEvent("add", isRemote));
      this.on("remove", (isRemote) => this._reEmitEvent("remove", isRemote));
      this.on("create", (isRemote) => this._reEmitEvent("create-processed-stream", isRemote));
      this.on("destroy", (isRemote) => this._reEmitEvent("destroy-processed-stream", isRemote));
    }
    destroy() {
      this.removeAllListeners();
    }
    _reEmitEvent(name, isRemote) {
      this._log.info(`${isRemote ? "Remote" : "Local"} AudioProcessor:${name}`);
      this.emit("event", { name, group: "audio-processor", isRemote });
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/dialtonePlayer.js
  var bandFrequencies = {
    dtmf0: [1360, 960],
    dtmf1: [1230, 720],
    dtmf2: [1360, 720],
    dtmf3: [1480, 720],
    dtmf4: [1230, 790],
    dtmf5: [1360, 790],
    dtmf6: [1480, 790],
    dtmf7: [1230, 870],
    dtmf8: [1360, 870],
    dtmf9: [1480, 870],
    dtmfh: [1480, 960],
    dtmfs: [1230, 960]
  };
  var DialtonePlayer = class {
    constructor(_context) {
      this._context = _context;
      this._gainNodes = [];
      this._gainNodes = [
        this._context.createGain(),
        this._context.createGain()
      ];
      this._gainNodes.forEach((gainNode) => {
        gainNode.connect(this._context.destination);
        gainNode.gain.value = 0.1;
        this._gainNodes.push(gainNode);
      });
    }
    cleanup() {
      this._gainNodes.forEach((gainNode) => {
        gainNode.disconnect();
      });
    }
    /**
     * Play the dual frequency tone for the passed DTMF name.
     * @param sound
     */
    play(sound) {
      const frequencies = bandFrequencies[sound];
      if (!frequencies) {
        throw new InvalidArgumentError("Invalid DTMF sound name");
      }
      const oscillators = [
        this._context.createOscillator(),
        this._context.createOscillator()
      ];
      oscillators.forEach((oscillator, i) => {
        oscillator.type = "sine";
        oscillator.frequency.value = frequencies[i];
        oscillator.connect(this._gainNodes[i]);
        oscillator.start();
        oscillator.stop(this._context.currentTime + 0.1);
        oscillator.addEventListener("ended", () => oscillator.disconnect());
      });
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/eventpublisher.js
  var import_events4 = __toESM(require_events());

  // node_modules/@twilio/voice-sdk/esm/twilio/request.js
  function request(method, params, callback) {
    const body = JSON.stringify(params.body || {});
    const headers = new Headers();
    params.headers = params.headers || [];
    Object.entries(params.headers).forEach(([headerName, headerBody]) => headers.append(headerName, headerBody));
    fetch(params.url, { body, headers, method }).then((response) => response.text(), callback).then((responseText) => callback(null, responseText), callback);
  }
  var Request = request;
  Request.get = function get(params, callback) {
    return new this("GET", params, callback);
  };
  Request.post = function post(params, callback) {
    return new this("POST", params, callback);
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/eventpublisher.js
  var EventPublisher = class _EventPublisher extends import_events4.EventEmitter {
    constructor(productName, token, options) {
      super();
      if (!(this instanceof _EventPublisher)) {
        return new _EventPublisher(productName, token, options);
      }
      options = Object.assign({ defaultPayload() {
        return {};
      } }, options);
      let defaultPayload = options.defaultPayload;
      if (typeof defaultPayload !== "function") {
        defaultPayload = () => Object.assign({}, options.defaultPayload);
      }
      let isEnabled = true;
      const metadata = Object.assign({ app_name: void 0, app_version: void 0 }, options.metadata);
      Object.defineProperties(this, {
        _defaultPayload: { value: defaultPayload },
        _host: { value: options.host, writable: true },
        _isEnabled: {
          get() {
            return isEnabled;
          },
          set(_isEnabled) {
            isEnabled = _isEnabled;
          }
        },
        _log: { value: new Log("EventPublisher") },
        _request: { value: options.request || Request, writable: true },
        _token: { value: token, writable: true },
        isEnabled: {
          enumerable: true,
          get() {
            return isEnabled;
          }
        },
        metadata: {
          enumerable: true,
          get() {
            return metadata;
          }
        },
        productName: { enumerable: true, value: productName },
        token: {
          enumerable: true,
          get() {
            return this._token;
          }
        }
      });
    }
  };
  EventPublisher.prototype._post = function _post(endpointName, level, group, name, payload, connection, force) {
    if (!this.isEnabled && !force || !this._host) {
      this._log.debug("Publishing cancelled", JSON.stringify({ isEnabled: this.isEnabled, force, host: this._host }));
      return Promise.resolve();
    }
    if (!connection || (!connection.parameters || !connection.parameters.CallSid) && !connection.outboundConnectionId) {
      if (!connection) {
        this._log.debug("Publishing cancelled. Missing connection object");
      } else {
        this._log.debug("Publishing cancelled. Missing connection info", JSON.stringify({
          outboundConnectionId: connection.outboundConnectionId,
          parameters: connection.parameters
        }));
      }
      return Promise.resolve();
    }
    const event = {
      group,
      level: level.toUpperCase(),
      name,
      payload: payload && payload.forEach ? payload.slice(0) : Object.assign(this._defaultPayload(connection), payload),
      payload_type: "application/json",
      private: false,
      publisher: this.productName,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (this.metadata) {
      event.publisher_metadata = this.metadata;
    }
    if (endpointName === "EndpointEvents") {
      this._log.debug("Publishing insights", JSON.stringify({ endpointName, event, force, host: this._host }));
    }
    const requestParams = {
      body: event,
      headers: {
        "Content-Type": "application/json",
        "X-Twilio-Token": this.token
      },
      url: `https://${this._host}/v4/${endpointName}`
    };
    return new Promise((resolve, reject) => {
      this._request.post(requestParams, (err) => {
        if (err) {
          this.emit("error", err);
          reject(err);
        } else {
          resolve();
        }
      });
    }).catch((e) => {
      this._log.error(`Unable to post ${group} ${name} event to Insights. Received error: ${e}`);
    });
  };
  EventPublisher.prototype.post = function post2(level, group, name, payload, connection, force) {
    return this._post("EndpointEvents", level, group, name, payload, connection, force);
  };
  EventPublisher.prototype.debug = function debug(group, name, payload, connection) {
    return this.post("debug", group, name, payload, connection);
  };
  EventPublisher.prototype.info = function info(group, name, payload, connection) {
    return this.post("info", group, name, payload, connection);
  };
  EventPublisher.prototype.warn = function warn(group, name, payload, connection) {
    return this.post("warning", group, name, payload, connection);
  };
  EventPublisher.prototype.error = function error(group, name, payload, connection) {
    return this.post("error", group, name, payload, connection);
  };
  EventPublisher.prototype.postMetrics = function postMetrics(group, name, metrics, customFields, connection) {
    return new Promise((resolve) => {
      const samples = metrics.map(formatMetric).map((sample) => Object.assign(sample, customFields));
      resolve(this._post("EndpointMetrics", "info", group, name, samples, connection));
    });
  };
  EventPublisher.prototype.setHost = function setHost(host) {
    this._host = host;
  };
  EventPublisher.prototype.setToken = function setToken(token) {
    this._token = token;
  };
  EventPublisher.prototype.enable = function enable() {
    this._isEnabled = true;
  };
  EventPublisher.prototype.disable = function disable() {
    this._isEnabled = false;
  };
  function formatMetric(sample) {
    return {
      audio_codec: sample.codecName,
      audio_level_in: sample.audioInputLevel,
      audio_level_out: sample.audioOutputLevel,
      bytes_received: sample.bytesReceived,
      bytes_sent: sample.bytesSent,
      call_volume_input: sample.inputVolume,
      call_volume_output: sample.outputVolume,
      jitter: sample.jitter,
      mos: sample.mos && Math.round(sample.mos * 100) / 100,
      packets_lost: sample.packetsLost,
      packets_lost_fraction: sample.packetsLostFraction && Math.round(sample.packetsLostFraction * 100) / 100,
      packets_received: sample.packetsReceived,
      rtt: sample.rtt,
      timestamp: new Date(sample.timestamp).toISOString(),
      total_bytes_received: sample.totals.bytesReceived,
      total_bytes_sent: sample.totals.bytesSent,
      total_packets_lost: sample.totals.packetsLost,
      total_packets_received: sample.totals.packetsReceived,
      total_packets_sent: sample.totals.packetsSent
    };
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/preflight/preflight.js
  var import_events5 = __toESM(require_events());

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/mockrtcstatsreport.js
  var OLD_MAX_VOLUME = 32767;
  var NativeRTCStatsReport = typeof window !== "undefined" ? window.RTCStatsReport : void 0;
  function MockRTCStatsReport(statsMap) {
    if (!(this instanceof MockRTCStatsReport)) {
      return new MockRTCStatsReport(statsMap);
    }
    const self = this;
    Object.defineProperties(this, {
      _map: { value: statsMap },
      size: {
        enumerable: true,
        get() {
          return self._map.size;
        }
      }
    });
    this[Symbol.iterator] = statsMap[Symbol.iterator];
  }
  if (NativeRTCStatsReport) {
    MockRTCStatsReport.prototype = Object.create(NativeRTCStatsReport.prototype);
    MockRTCStatsReport.prototype.constructor = MockRTCStatsReport;
  }
  ["entries", "forEach", "get", "has", "keys", "values"].forEach((key) => {
    MockRTCStatsReport.prototype[key] = function(...args) {
      return this._map[key](...args);
    };
  });
  MockRTCStatsReport.fromArray = function fromArray(array) {
    return new MockRTCStatsReport(array.reduce((map, rtcStats) => {
      map.set(rtcStats.id, rtcStats);
      return map;
    }, /* @__PURE__ */ new Map()));
  };
  MockRTCStatsReport.fromRTCStatsResponse = function fromRTCStatsResponse(statsResponse) {
    let activeCandidatePairId;
    const transportIds = /* @__PURE__ */ new Map();
    const statsMap = statsResponse.result().reduce((map, report) => {
      const id = report.id;
      switch (report.type) {
        case "googCertificate":
          map.set(id, createRTCCertificateStats(report));
          break;
        case "datachannel":
          map.set(id, createRTCDataChannelStats(report));
          break;
        case "googCandidatePair":
          if (getBoolean(report, "googActiveConnection")) {
            activeCandidatePairId = id;
          }
          map.set(id, createRTCIceCandidatePairStats(report));
          break;
        case "localcandidate":
          map.set(id, createRTCIceCandidateStats(report, false));
          break;
        case "remotecandidate":
          map.set(id, createRTCIceCandidateStats(report, true));
          break;
        case "ssrc":
          if (isPresent(report, "packetsReceived")) {
            map.set(`rtp-${id}`, createRTCInboundRTPStreamStats(report));
          } else {
            map.set(`rtp-${id}`, createRTCOutboundRTPStreamStats(report));
          }
          map.set(`track-${id}`, createRTCMediaStreamTrackStats(report));
          map.set(`codec-${id}`, createRTCCodecStats(report));
          break;
        case "googComponent":
          const transportReport = createRTCTransportStats(report);
          transportIds.set(transportReport.selectedCandidatePairId, id);
          map.set(id, createRTCTransportStats(report));
          break;
      }
      return map;
    }, /* @__PURE__ */ new Map());
    if (activeCandidatePairId) {
      const activeTransportId = transportIds.get(activeCandidatePairId);
      if (activeTransportId) {
        statsMap.get(activeTransportId).dtlsState = "connected";
      }
    }
    return new MockRTCStatsReport(statsMap);
  };
  function createRTCTransportStats(report) {
    return {
      bytesReceived: void 0,
      bytesSent: void 0,
      dtlsState: void 0,
      id: report.id,
      localCertificateId: report.stat("localCertificateId"),
      remoteCertificateId: report.stat("remoteCertificateId"),
      rtcpTransportStatsId: void 0,
      selectedCandidatePairId: report.stat("selectedCandidatePairId"),
      timestamp: Date.parse(report.timestamp),
      type: "transport"
    };
  }
  function createRTCCodecStats(report) {
    return {
      channels: void 0,
      clockRate: void 0,
      id: report.id,
      implementation: void 0,
      mimeType: `${report.stat("mediaType")}/${report.stat("googCodecName")}`,
      payloadType: void 0,
      sdpFmtpLine: void 0,
      timestamp: Date.parse(report.timestamp),
      type: "codec"
    };
  }
  function createRTCMediaStreamTrackStats(report) {
    return {
      audioLevel: isPresent(report, "audioOutputLevel") ? getInt(report, "audioOutputLevel") / OLD_MAX_VOLUME : (getInt(report, "audioInputLevel") || 0) / OLD_MAX_VOLUME,
      detached: void 0,
      echoReturnLoss: getFloat(report, "googEchoCancellationReturnLoss"),
      echoReturnLossEnhancement: getFloat(report, "googEchoCancellationReturnLossEnhancement"),
      ended: void 0,
      frameHeight: isPresent(report, "googFrameHeightReceived") ? getInt(report, "googFrameHeightReceived") : getInt(report, "googFrameHeightSent"),
      frameWidth: isPresent(report, "googFrameWidthReceived") ? getInt(report, "googFrameWidthReceived") : getInt(report, "googFrameWidthSent"),
      framesCorrupted: void 0,
      framesDecoded: getInt(report, "framesDecoded"),
      framesDropped: void 0,
      framesPerSecond: void 0,
      framesReceived: void 0,
      framesSent: getInt(report, "framesEncoded"),
      fullFramesLost: void 0,
      id: report.id,
      kind: report.stat("mediaType"),
      partialFramesLost: void 0,
      remoteSource: void 0,
      ssrcIds: void 0,
      timestamp: Date.parse(report.timestamp),
      trackIdentifier: report.stat("googTrackId"),
      type: "track"
    };
  }
  function createRTCRTPStreamStats(report, isInbound) {
    return {
      associateStatsId: void 0,
      codecId: `codec-${report.id}`,
      firCount: isInbound ? getInt(report, "googFirsSent") : void 0,
      id: report.id,
      isRemote: void 0,
      mediaType: report.stat("mediaType"),
      nackCount: isInbound ? getInt(report, "googNacksSent") : getInt(report, "googNacksReceived"),
      pliCount: isInbound ? getInt(report, "googPlisSent") : getInt(report, "googPlisReceived"),
      qpSum: getInt(report, "qpSum"),
      sliCount: void 0,
      ssrc: report.stat("ssrc"),
      timestamp: Date.parse(report.timestamp),
      trackId: `track-${report.id}`,
      transportId: report.stat("transportId")
    };
  }
  function createRTCInboundRTPStreamStats(report) {
    const rtp = createRTCRTPStreamStats(report, true);
    Object.assign(rtp, {
      burstDiscardCount: void 0,
      burstDiscardRate: void 0,
      burstLossCount: void 0,
      burstLossRate: void 0,
      burstPacketsDiscarded: void 0,
      burstPacketsLost: void 0,
      bytesReceived: getInt(report, "bytesReceived"),
      fractionLost: void 0,
      framesDecoded: getInt(report, "framesDecoded"),
      gapDiscardRate: void 0,
      gapLossRate: void 0,
      jitter: convertMsToSeconds(report.stat("googJitterReceived")),
      packetsDiscarded: void 0,
      packetsLost: getInt(report, "packetsLost"),
      packetsReceived: getInt(report, "packetsReceived"),
      packetsRepaired: void 0,
      roundTripTime: convertMsToSeconds(report.stat("googRtt")),
      type: "inbound-rtp"
    });
    return rtp;
  }
  function createRTCOutboundRTPStreamStats(report) {
    const rtp = createRTCRTPStreamStats(report, false);
    Object.assign(rtp, {
      bytesSent: getInt(report, "bytesSent"),
      framesEncoded: getInt(report, "framesEncoded"),
      packetsSent: getInt(report, "packetsSent"),
      remoteTimestamp: void 0,
      targetBitrate: void 0,
      type: "outbound-rtp"
    });
    return rtp;
  }
  function createRTCIceCandidateStats(report, isRemote) {
    return {
      candidateType: translateCandidateType(report.stat("candidateType")),
      deleted: void 0,
      id: report.id,
      ip: report.stat("ipAddress"),
      isRemote,
      port: getInt(report, "portNumber"),
      priority: getFloat(report, "priority"),
      protocol: report.stat("transport"),
      relayProtocol: void 0,
      timestamp: Date.parse(report.timestamp),
      transportId: void 0,
      type: isRemote ? "remote-candidate" : "local-candidate",
      url: void 0
    };
  }
  function createRTCIceCandidatePairStats(report) {
    return {
      availableIncomingBitrate: void 0,
      availableOutgoingBitrate: void 0,
      bytesReceived: getInt(report, "bytesReceived"),
      bytesSent: getInt(report, "bytesSent"),
      consentRequestsSent: getInt(report, "consentRequestsSent"),
      currentRoundTripTime: convertMsToSeconds(report.stat("googRtt")),
      id: report.id,
      lastPacketReceivedTimestamp: void 0,
      lastPacketSentTimestamp: void 0,
      localCandidateId: report.stat("localCandidateId"),
      nominated: void 0,
      priority: void 0,
      readable: void 0,
      remoteCandidateId: report.stat("remoteCandidateId"),
      requestsReceived: getInt(report, "requestsReceived"),
      requestsSent: getInt(report, "requestsSent"),
      responsesReceived: getInt(report, "responsesReceived"),
      responsesSent: getInt(report, "responsesSent"),
      retransmissionsReceived: void 0,
      retransmissionsSent: void 0,
      state: void 0,
      timestamp: Date.parse(report.timestamp),
      totalRoundTripTime: void 0,
      transportId: report.stat("googChannelId"),
      type: "candidate-pair",
      writable: getBoolean(report, "googWritable")
    };
  }
  function createRTCCertificateStats(report) {
    return {
      base64Certificate: report.stat("googDerBase64"),
      fingerprint: report.stat("googFingerprint"),
      fingerprintAlgorithm: report.stat("googFingerprintAlgorithm"),
      id: report.id,
      issuerCertificateId: report.stat("googIssuerId"),
      timestamp: Date.parse(report.timestamp),
      type: "certificate"
    };
  }
  function createRTCDataChannelStats(report) {
    return {
      bytesReceived: void 0,
      bytesSent: void 0,
      datachannelid: report.stat("datachannelid"),
      id: report.id,
      label: report.stat("label"),
      messagesReceived: void 0,
      messagesSent: void 0,
      protocol: report.stat("protocol"),
      state: report.stat("state"),
      timestamp: Date.parse(report.timestamp),
      transportId: report.stat("transportId"),
      type: "data-channel"
    };
  }
  function convertMsToSeconds(inMs) {
    return isNaN(inMs) || inMs === "" ? void 0 : parseInt(inMs, 10) / 1e3;
  }
  function translateCandidateType(type) {
    switch (type) {
      case "peerreflexive":
        return "prflx";
      case "serverreflexive":
        return "srflx";
      case "host":
      case "relay":
      default:
        return type;
    }
  }
  function getInt(report, statName) {
    const stat = report.stat(statName);
    return isPresent(report, statName) ? parseInt(stat, 10) : void 0;
  }
  function getFloat(report, statName) {
    const stat = report.stat(statName);
    return isPresent(report, statName) ? parseFloat(stat) : void 0;
  }
  function getBoolean(report, statName) {
    const stat = report.stat(statName);
    return isPresent(report, statName) ? stat === "true" || stat === true : void 0;
  }
  function isPresent(report, statName) {
    const stat = report.stat(statName);
    return typeof stat !== "undefined" && stat !== "";
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/stats.js
  var ERROR_PEER_CONNECTION_NULL = "PeerConnection is null";
  var ERROR_WEB_RTC_UNSUPPORTED = "WebRTC statistics are unsupported";
  function findStatById(report, id) {
    if (typeof report.get === "function") {
      return report.get(id);
    }
    return report.find((s) => s.id === id);
  }
  function getRTCStatsReport(peerConnection) {
    if (!peerConnection) {
      return Promise.reject(new InvalidArgumentError(ERROR_PEER_CONNECTION_NULL));
    }
    if (typeof peerConnection.getStats !== "function") {
      return Promise.reject(new NotSupportedError(ERROR_WEB_RTC_UNSUPPORTED));
    }
    let promise;
    try {
      promise = peerConnection.getStats();
    } catch (e) {
      promise = new Promise((resolve) => peerConnection.getStats(resolve)).then(MockRTCStatsReport.fromRTCStatsResponse);
    }
    return promise;
  }
  function getRTCStats(peerConnection, options) {
    options = Object.assign({ createRTCSample }, options);
    return getRTCStatsReport(peerConnection).then(options.createRTCSample);
  }
  function getRTCIceCandidateStatsReport(peerConnection) {
    return getRTCStatsReport(peerConnection).then((report) => {
      const { candidatePairs, localCandidates, remoteCandidates, transport } = Array.from(report.values()).reduce((rval, stat) => {
        ["candidatePairs", "localCandidates", "remoteCandidates"].forEach((prop) => {
          if (!rval[prop]) {
            rval[prop] = [];
          }
        });
        switch (stat.type) {
          case "candidate-pair":
            rval.candidatePairs.push(stat);
            break;
          case "local-candidate":
            rval.localCandidates.push(stat);
            break;
          case "remote-candidate":
            rval.remoteCandidates.push(stat);
            break;
          case "transport":
            if (stat.selectedCandidatePairId) {
              rval.transport = stat;
            }
            break;
        }
        return rval;
      }, {});
      const selectedCandidatePairReport = candidatePairs.find((pair) => (
        // Firefox
        pair.selected || // Spec-compliant way
        transport && pair.id === transport.selectedCandidatePairId
      ));
      let selectedIceCandidatePairStats;
      if (selectedCandidatePairReport) {
        selectedIceCandidatePairStats = {
          localCandidate: localCandidates.find((candidate) => candidate.id === selectedCandidatePairReport.localCandidateId),
          remoteCandidate: remoteCandidates.find((candidate) => candidate.id === selectedCandidatePairReport.remoteCandidateId)
        };
      }
      return {
        iceCandidateStats: [...localCandidates, ...remoteCandidates],
        selectedIceCandidatePairStats
      };
    });
  }
  function RTCSample() {
  }
  function createRTCSample(statsReport) {
    let activeTransportId = null;
    const sample = new RTCSample();
    let fallbackTimestamp;
    Array.from(statsReport.values()).forEach((stats) => {
      if (stats.isRemote) {
        return;
      }
      const type = stats.type.replace("-", "");
      fallbackTimestamp = fallbackTimestamp || stats.timestamp;
      if (stats.remoteId) {
        const remote = findStatById(statsReport, stats.remoteId);
        if (remote && remote.roundTripTime) {
          sample.rtt = remote.roundTripTime * 1e3;
        }
      }
      switch (type) {
        case "inboundrtp":
          sample.timestamp = sample.timestamp || stats.timestamp;
          sample.jitter = stats.jitter * 1e3;
          sample.packetsLost = stats.packetsLost;
          sample.packetsReceived = stats.packetsReceived;
          sample.bytesReceived = stats.bytesReceived;
          break;
        case "outboundrtp":
          sample.timestamp = stats.timestamp;
          sample.packetsSent = stats.packetsSent;
          sample.bytesSent = stats.bytesSent;
          if (stats.codecId) {
            const codec = findStatById(statsReport, stats.codecId);
            sample.codecName = codec ? codec.mimeType && codec.mimeType.match(/(.*\/)?(.*)/)[2] : stats.codecId;
          }
          break;
        case "transport":
          activeTransportId = stats.id;
          break;
      }
    });
    if (!sample.timestamp) {
      sample.timestamp = fallbackTimestamp;
    }
    const activeTransport = findStatById(statsReport, activeTransportId);
    if (!activeTransport) {
      return sample;
    }
    const selectedCandidatePair = findStatById(statsReport, activeTransport.selectedCandidatePairId);
    if (!selectedCandidatePair) {
      return sample;
    }
    const localCandidate = findStatById(statsReport, selectedCandidatePair.localCandidateId);
    const remoteCandidate = findStatById(statsReport, selectedCandidatePair.remoteCandidateId);
    if (!sample.rtt) {
      sample.rtt = selectedCandidatePair && selectedCandidatePair.currentRoundTripTime * 1e3;
    }
    Object.assign(sample, {
      // ip is deprecated. use address first then ip if on older versions of browser
      localAddress: localCandidate && (localCandidate.address || localCandidate.ip),
      remoteAddress: remoteCandidate && (remoteCandidate.address || remoteCandidate.ip)
    });
    return sample;
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/preflight/preflight.js
  var PreflightTest = class _PreflightTest extends import_events5.EventEmitter {
    /**
     * Construct a {@link PreflightTest} instance.
     * @param token - A Twilio JWT token string.
     * @param options
     */
    constructor(token, options) {
      super();
      this._hasInsightsErrored = false;
      this._log = new Log("PreflightTest");
      this._networkTiming = {};
      this._options = {
        codecPreferences: [Call.Codec.PCMU, Call.Codec.Opus],
        edge: "roaming",
        fakeMicInput: false,
        logLevel: "error",
        signalingTimeoutMs: 1e4
      };
      this._status = _PreflightTest.Status.Connecting;
      Object.assign(this._options, options);
      this._samples = [];
      this._warnings = [];
      this._startTime = Date.now();
      this._initDevice(token, Object.assign(Object.assign({}, this._options), { fileInputStream: this._options.fakeMicInput ? this._getStreamFromFile() : void 0 }));
      const userOptions = [
        "codecPreferences",
        "edge",
        "fakeMicInput",
        "logLevel",
        "signalingTimeoutMs"
      ];
      const userOptionOverrides = [
        "audioContext",
        "deviceFactory",
        "fileInputStream",
        "getRTCIceCandidateStatsReport",
        "iceServers",
        "rtcConfiguration"
      ];
      if (typeof options === "object") {
        const toLog = Object.assign({}, options);
        Object.keys(toLog).forEach((key) => {
          if (!userOptions.includes(key) && !userOptionOverrides.includes(key)) {
            delete toLog[key];
          }
          if (userOptionOverrides.includes(key)) {
            toLog[key] = true;
          }
        });
        this._log.debug(".constructor", JSON.stringify(toLog));
      }
    }
    /**
     * Stops the current test and raises a failed event.
     */
    stop() {
      this._log.debug(".stop");
      const error2 = new GeneralErrors.CallCancelledError();
      if (this._device) {
        this._device.once(Device.EventName.Unregistered, () => this._onFailed(error2));
        this._device.destroy();
      } else {
        this._onFailed(error2);
      }
    }
    /**
     * Emit a {PreflightTest.Warning}
     */
    _emitWarning(name, description, rtcWarning) {
      const warning = { name, description };
      if (rtcWarning) {
        warning.rtcWarning = rtcWarning;
      }
      this._warnings.push(warning);
      this._log.debug(`#${_PreflightTest.Events.Warning}`, JSON.stringify(warning));
      this.emit(_PreflightTest.Events.Warning, warning);
    }
    /**
     * Returns call quality base on the RTC Stats
     */
    _getCallQuality(mos) {
      if (mos > 4.2) {
        return _PreflightTest.CallQuality.Excellent;
      } else if (mos >= 4.1 && mos <= 4.2) {
        return _PreflightTest.CallQuality.Great;
      } else if (mos >= 3.7 && mos <= 4) {
        return _PreflightTest.CallQuality.Good;
      } else if (mos >= 3.1 && mos <= 3.6) {
        return _PreflightTest.CallQuality.Fair;
      } else {
        return _PreflightTest.CallQuality.Degraded;
      }
    }
    /**
     * Returns the report for this test.
     */
    _getReport() {
      var _a, _b, _c;
      const stats = this._getRTCStats();
      const testTiming = { start: this._startTime };
      if (this._endTime) {
        testTiming.end = this._endTime;
        testTiming.duration = this._endTime - this._startTime;
      }
      const report = {
        callSid: this._callSid,
        edge: this._edge,
        iceCandidateStats: (_b = (_a = this._rtcIceCandidateStatsReport) === null || _a === void 0 ? void 0 : _a.iceCandidateStats) !== null && _b !== void 0 ? _b : [],
        networkTiming: this._networkTiming,
        samples: this._samples,
        selectedEdge: this._options.edge,
        stats,
        testTiming,
        totals: this._getRTCSampleTotals(),
        warnings: this._warnings
      };
      const selectedIceCandidatePairStats = (_c = this._rtcIceCandidateStatsReport) === null || _c === void 0 ? void 0 : _c.selectedIceCandidatePairStats;
      if (selectedIceCandidatePairStats) {
        report.selectedIceCandidatePairStats = selectedIceCandidatePairStats;
        report.isTurnRequired = selectedIceCandidatePairStats.localCandidate.candidateType === "relay" || selectedIceCandidatePairStats.remoteCandidate.candidateType === "relay";
      }
      if (stats) {
        report.callQuality = this._getCallQuality(stats.mos.average);
      }
      return report;
    }
    /**
     * Returns RTC stats totals for this test
     */
    _getRTCSampleTotals() {
      if (!this._latestSample) {
        return;
      }
      return Object.assign({}, this._latestSample.totals);
    }
    /**
     * Returns RTC related stats captured during the test call
     */
    _getRTCStats() {
      const firstMosSampleIdx = this._samples.findIndex((sample) => typeof sample.mos === "number" && sample.mos > 0);
      const samples = firstMosSampleIdx >= 0 ? this._samples.slice(firstMosSampleIdx) : [];
      if (!samples || !samples.length) {
        return;
      }
      return ["jitter", "mos", "rtt"].reduce((statObj, stat) => {
        const values = samples.map((s) => s[stat]);
        return Object.assign(Object.assign({}, statObj), { [stat]: {
          average: Number((values.reduce((total, value) => total + value) / values.length).toPrecision(5)),
          max: Math.max(...values),
          min: Math.min(...values)
        } });
      }, {});
    }
    /**
     * Returns a MediaStream from a media file
     */
    _getStreamFromFile() {
      const audioContext = this._options.audioContext;
      if (!audioContext) {
        throw new NotSupportedError("Cannot fake input audio stream: AudioContext is not supported by this browser.");
      }
      const audioEl = new Audio(COWBELL_AUDIO_URL);
      audioEl.addEventListener("canplaythrough", () => audioEl.play());
      if (typeof audioEl.setAttribute === "function") {
        audioEl.setAttribute("crossorigin", "anonymous");
      }
      const src = audioContext.createMediaElementSource(audioEl);
      const dest = audioContext.createMediaStreamDestination();
      src.connect(dest);
      return dest.stream;
    }
    /**
     * Initialize the device
     */
    _initDevice(token, options) {
      try {
        this._device = new (options.deviceFactory || Device)(token, {
          chunderw: options.chunderw,
          codecPreferences: options.codecPreferences,
          edge: options.edge,
          eventgw: options.eventgw,
          fileInputStream: options.fileInputStream,
          logLevel: options.logLevel,
          preflight: true
        });
        this._device.once(Device.EventName.Registered, () => {
          this._onDeviceRegistered();
        });
        this._device.once(Device.EventName.Error, (error2) => {
          this._onDeviceError(error2);
        });
        this._device.register();
      } catch (error2) {
        setTimeout(() => {
          this._onFailed(error2);
        });
        return;
      }
      this._signalingTimeoutTimer = setTimeout(() => {
        this._onDeviceError(new SignalingErrors.ConnectionError("WebSocket Connection Timeout"));
      }, options.signalingTimeoutMs);
    }
    /**
     * Called on {@link Device} error event
     * @param error
     */
    _onDeviceError(error2) {
      this._device.destroy();
      this._onFailed(error2);
    }
    /**
     * Called on {@link Device} ready event
     */
    _onDeviceRegistered() {
      return __awaiter(this, void 0, void 0, function* () {
        clearTimeout(this._echoTimer);
        clearTimeout(this._signalingTimeoutTimer);
        this._call = yield this._device.connect({
          rtcConfiguration: this._options.rtcConfiguration
        });
        this._networkTiming.signaling = { start: Date.now() };
        this._setupCallHandlers(this._call);
        this._edge = this._device.edge || void 0;
        if (this._options.fakeMicInput) {
          this._echoTimer = setTimeout(() => this._device.disconnectAll(), ECHO_TEST_DURATION);
          const audio = this._device.audio;
          if (audio) {
            audio.disconnect(false);
            audio.outgoing(false);
          }
        }
        this._call.once("disconnect", () => {
          this._device.once(Device.EventName.Unregistered, () => this._onUnregistered());
          this._device.destroy();
        });
        const publisher = this._call["_publisher"];
        publisher.on("error", () => {
          if (!this._hasInsightsErrored) {
            this._emitWarning("insights-connection-error", "Received an error when attempting to connect to Insights gateway");
          }
          this._hasInsightsErrored = true;
        });
      });
    }
    /**
     * Called when there is a fatal error
     * @param error
     */
    _onFailed(error2) {
      clearTimeout(this._echoTimer);
      clearTimeout(this._signalingTimeoutTimer);
      this._releaseHandlers();
      this._endTime = Date.now();
      this._status = _PreflightTest.Status.Failed;
      this._log.debug(`#${_PreflightTest.Events.Failed}`, error2);
      this.emit(_PreflightTest.Events.Failed, error2);
    }
    /**
     * Called when the device goes offline.
     * This indicates that the test has been completed, but we won't know if it failed or not.
     * The onError event will be the indicator whether the test failed.
     */
    _onUnregistered() {
      setTimeout(() => {
        if (this._status === _PreflightTest.Status.Failed) {
          return;
        }
        clearTimeout(this._echoTimer);
        clearTimeout(this._signalingTimeoutTimer);
        this._releaseHandlers();
        this._endTime = Date.now();
        this._status = _PreflightTest.Status.Completed;
        this._report = this._getReport();
        this._log.debug(`#${_PreflightTest.Events.Completed}`, JSON.stringify(this._report));
        this.emit(_PreflightTest.Events.Completed, this._report);
      }, 10);
    }
    /**
     * Clean up all handlers for device and call
     */
    _releaseHandlers() {
      [this._device, this._call].forEach((emitter) => {
        if (emitter) {
          emitter.eventNames().forEach((name) => emitter.removeAllListeners(name));
        }
      });
    }
    /**
     * Setup the event handlers for the {@link Call} of the test call
     * @param call
     */
    _setupCallHandlers(call) {
      if (this._options.fakeMicInput) {
        call.once("volume", () => {
          call["_mediaHandler"].outputs.forEach((output) => output.audio.muted = true);
        });
      }
      call.on("warning", (name, data) => {
        this._emitWarning(name, "Received an RTCWarning. See .rtcWarning for the RTCWarning", data);
      });
      call.once("accept", () => {
        this._callSid = call["_mediaHandler"].callSid;
        this._status = _PreflightTest.Status.Connected;
        this._log.debug(`#${_PreflightTest.Events.Connected}`);
        this.emit(_PreflightTest.Events.Connected);
      });
      call.on("sample", (sample) => __awaiter(this, void 0, void 0, function* () {
        if (!this._latestSample) {
          this._rtcIceCandidateStatsReport = yield (this._options.getRTCIceCandidateStatsReport || getRTCIceCandidateStatsReport)(call["_mediaHandler"].version.pc);
        }
        this._latestSample = sample;
        this._samples.push(sample);
        this._log.debug(`#${_PreflightTest.Events.Sample}`, JSON.stringify(sample));
        this.emit(_PreflightTest.Events.Sample, sample);
      }));
      [{
        reportLabel: "peerConnection",
        type: "pcconnection"
      }, {
        reportLabel: "ice",
        type: "iceconnection"
      }, {
        reportLabel: "dtls",
        type: "dtlstransport"
      }, {
        reportLabel: "signaling",
        type: "signaling"
      }].forEach(({ type, reportLabel }) => {
        const handlerName = `on${type}statechange`;
        const originalHandler = call["_mediaHandler"][handlerName];
        call["_mediaHandler"][handlerName] = (state) => {
          const timing = this._networkTiming[reportLabel] = this._networkTiming[reportLabel] || { start: 0 };
          if (state === "connecting" || state === "checking") {
            timing.start = Date.now();
          } else if ((state === "connected" || state === "stable") && !timing.duration) {
            timing.end = Date.now();
            timing.duration = timing.end - timing.start;
          }
          originalHandler(state);
        };
      });
    }
    /**
     * The callsid generated for the test call.
     */
    get callSid() {
      return this._callSid;
    }
    /**
     * A timestamp in milliseconds of when the test ended.
     */
    get endTime() {
      return this._endTime;
    }
    /**
     * The latest WebRTC sample collected.
     */
    get latestSample() {
      return this._latestSample;
    }
    /**
     * The report for this test.
     */
    get report() {
      return this._report;
    }
    /**
     * A timestamp in milliseconds of when the test started.
     */
    get startTime() {
      return this._startTime;
    }
    /**
     * The status of the test.
     */
    get status() {
      return this._status;
    }
  };
  (function(PreflightTest2) {
    (function(CallQuality) {
      CallQuality["Excellent"] = "excellent";
      CallQuality["Great"] = "great";
      CallQuality["Good"] = "good";
      CallQuality["Fair"] = "fair";
      CallQuality["Degraded"] = "degraded";
    })(PreflightTest2.CallQuality || (PreflightTest2.CallQuality = {}));
    (function(Events) {
      Events["Completed"] = "completed";
      Events["Connected"] = "connected";
      Events["Failed"] = "failed";
      Events["Sample"] = "sample";
      Events["Warning"] = "warning";
    })(PreflightTest2.Events || (PreflightTest2.Events = {}));
    (function(Status) {
      Status["Connecting"] = "connecting";
      Status["Connected"] = "connected";
      Status["Completed"] = "completed";
      Status["Failed"] = "failed";
    })(PreflightTest2.Status || (PreflightTest2.Status = {}));
  })(PreflightTest || (PreflightTest = {}));

  // node_modules/@twilio/voice-sdk/esm/twilio/pstream.js
  var import_events7 = __toESM(require_events());

  // node_modules/@twilio/voice-sdk/esm/twilio/wstransport.js
  var import_events6 = __toESM(require_events());
  var WebSocket = globalThis.WebSocket;
  var CONNECT_SUCCESS_TIMEOUT = 1e4;
  var CONNECT_TIMEOUT = 5e3;
  var HEARTBEAT_TIMEOUT = 15e3;
  var MAX_PREFERRED_DURATION = 15e3;
  var MAX_PRIMARY_DURATION = Infinity;
  var MAX_RETRY_AFTER_DURATION = 75e3;
  var MAX_PREFERRED_DELAY = 1e3;
  var MAX_PRIMARY_DELAY = 2e4;
  var MAX_RETRY_AFTER_DELAY = 6e4;
  var WSTransportState;
  (function(WSTransportState2) {
    WSTransportState2["Connecting"] = "connecting";
    WSTransportState2["Closed"] = "closed";
    WSTransportState2["Open"] = "open";
  })(WSTransportState || (WSTransportState = {}));
  var WSTransport = class _WSTransport extends import_events6.EventEmitter {
    /**
     * @constructor
     * @param uris - List of URI of the endpoints to connect to.
     * @param [options] - Constructor options.
     */
    constructor(uris, options = {}) {
      super();
      this.state = WSTransportState.Closed;
      this._backoffStartTime = {
        preferred: null,
        primary: null
      };
      this._connectedUri = null;
      this._log = new Log("WSTransport");
      this._retryAfter = null;
      this._shouldFallback = false;
      this._uriIndex = 0;
      this._moveUriIndex = () => {
        this._uriIndex++;
        if (this._uriIndex >= this._uris.length) {
          this._uriIndex = 0;
        }
      };
      this._onSocketClose = (event) => {
        this._log.error(`Received websocket close event code: ${event.code}. Reason: ${event.reason}`);
        if (event.code === 1006 || event.code === 1015) {
          this.emit("error", {
            code: 31005,
            message: event.reason || "Websocket connection to Twilio's signaling servers were unexpectedly ended. If this is happening consistently, there may be an issue resolving the hostname provided. If a region or an edge is being specified in Device setup, ensure it is valid.",
            twilioError: new SignalingErrors.ConnectionError()
          });
          const wasConnected = (
            // Only in Safari and certain Firefox versions, on network interruption, websocket drops right away with 1006
            // Let's check current state if it's open, meaning we should not fallback
            // because we're coming from a previously connected session
            this.state === WSTransportState.Open || // But on other browsers, websocket doesn't drop
            // but our heartbeat catches it, setting the internal state to "Connecting".
            // With this, we should check the previous state instead.
            this._previousState === WSTransportState.Open
          );
          if (this._shouldFallback || !wasConnected) {
            this._moveUriIndex();
          }
          this._shouldFallback = true;
        }
        this._closeSocket();
      };
      this._onSocketError = (err) => {
        this._log.error(`WebSocket received error: ${err.message}`);
        this.emit("error", {
          code: 31e3,
          message: err.message || "WSTransport socket error",
          twilioError: new SignalingErrors.ConnectionDisconnected()
        });
      };
      this._onSocketMessage = (message) => {
        this._setHeartbeatTimeout();
        if (this._socket && message.data === "\n") {
          this._socket.send("\n");
          this._log.debug("heartbeat");
          return;
        }
        if (message && typeof message.data === "string") {
          this._log.debug(`Received: ${message.data}`);
          const { type, payload = {} } = JSON.parse(message.data);
          if (type === "error" && payload.error && payload.error.retryAfter) {
            this._retryAfter = payload.error.retryAfter * 1e3;
          }
        }
        this.emit("message", message);
      };
      this._onSocketOpen = () => {
        this._log.info("WebSocket opened successfully.");
        this._timeOpened = Date.now();
        this._shouldFallback = false;
        this._setState(WSTransportState.Open);
        clearTimeout(this._connectTimeout);
        if (this._backoff) {
          this._resetBackoffs();
        }
        this._setHeartbeatTimeout();
        this.emit("open");
      };
      this._options = Object.assign(Object.assign({}, _WSTransport.defaultConstructorOptions), options);
      this._uris = uris;
      this._backoff = null;
    }
    /**
     * Close the WebSocket, and don't try to reconnect.
     */
    close() {
      this._log.info("WSTransport.close() called...");
      this._close();
    }
    /**
     * Attempt to open a WebSocket connection.
     */
    open() {
      this._log.info("WSTransport.open() called...");
      if (this._socket && (this._socket.readyState === WebSocket.CONNECTING || this._socket.readyState === WebSocket.OPEN)) {
        this._log.info("WebSocket already open.");
        return;
      }
      if (this._preferredUri) {
        this._connect(this._preferredUri);
      } else {
        this._connect(this._uris[this._uriIndex]);
      }
    }
    /**
     * Send a message through the WebSocket connection.
     * @param message - A message to send to the endpoint.
     * @returns Whether the message was sent.
     */
    send(message) {
      this._log.debug(`Sending: ${message}`);
      if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
        this._log.debug("Cannot send message. WebSocket is not open.");
        return false;
      }
      try {
        this._socket.send(message);
      } catch (e) {
        this._log.error("Error while sending message:", e.message);
        this._closeSocket();
        return false;
      }
      return true;
    }
    /**
     * Update the preferred URI to connect to. Useful for Call signaling
     * reconnection, which requires connecting on the same edge. If `null` is
     * passed, the preferred URI is unset and the original `uris` array and
     * `uriIndex` is used to determine the signaling URI to connect to.
     * @param uri
     */
    updatePreferredURI(uri) {
      this._preferredUri = uri;
    }
    /**
     * Update acceptable URIs to reconnect to. Resets the URI index to 0.
     */
    updateURIs(uris) {
      if (typeof uris === "string") {
        uris = [uris];
      }
      this._uris = uris;
      this._uriIndex = 0;
    }
    /**
     * Close the WebSocket, and don't try to reconnect.
     */
    _close() {
      this._setState(WSTransportState.Closed);
      this._closeSocket();
    }
    /**
     * Close the WebSocket and remove all event listeners.
     */
    _closeSocket() {
      clearTimeout(this._connectTimeout);
      clearTimeout(this._heartbeatTimeout);
      this._log.info("Closing and cleaning up WebSocket...");
      if (!this._socket) {
        this._log.info("No WebSocket to clean up.");
        return;
      }
      this._socket.removeEventListener("close", this._onSocketClose);
      this._socket.removeEventListener("error", this._onSocketError);
      this._socket.removeEventListener("message", this._onSocketMessage);
      this._socket.removeEventListener("open", this._onSocketOpen);
      if (this._socket.readyState === WebSocket.CONNECTING || this._socket.readyState === WebSocket.OPEN) {
        this._socket.close();
      }
      if (this._backoff && this._timeOpened && Date.now() - this._timeOpened > CONNECT_SUCCESS_TIMEOUT) {
        this._resetBackoffs();
      }
      if (this.state !== WSTransportState.Closed) {
        if (!this._backoff) {
          this._backoff = this._setupBackoffs();
        }
        this._performBackoff();
      }
      delete this._socket;
      this.emit("close");
    }
    /**
     * Attempt to connect to the endpoint via WebSocket.
     * @param [uri] - URI string to connect to.
     * @param [retryCount] - Retry number, if this is a retry. Undefined if
     *   first attempt, 1+ if a retry.
     */
    _connect(uri, retryCount) {
      this._log.info(typeof retryCount === "number" ? `Attempting to reconnect (retry #${retryCount})...` : "Attempting to connect...");
      this._closeSocket();
      this._setState(WSTransportState.Connecting);
      this._connectedUri = uri;
      try {
        this._socket = new this._options.WebSocket(this._connectedUri);
      } catch (e) {
        this._log.error("Could not connect to endpoint:", e.message);
        this._close();
        this.emit("error", {
          code: 31e3,
          message: e.message || `Could not connect to ${this._connectedUri}`,
          twilioError: new SignalingErrors.ConnectionDisconnected()
        });
        return;
      }
      this._socket.addEventListener("close", this._onSocketClose);
      this._socket.addEventListener("error", this._onSocketError);
      this._socket.addEventListener("message", this._onSocketMessage);
      this._socket.addEventListener("open", this._onSocketOpen);
      delete this._timeOpened;
      this._connectTimeout = setTimeout(() => {
        this._log.info("WebSocket connection attempt timed out.");
        this._moveUriIndex();
        this._closeSocket();
      }, this._options.connectTimeoutMs);
    }
    /**
     * Perform a backoff. If a preferred URI is set (not null), then backoff
     * using the preferred mechanism. Otherwise, use the primary mechanism.
     */
    _performBackoff() {
      if (!this._backoff) {
        this._log.info("No backoff instance to perform backoff.");
        return;
      }
      if (this._preferredUri) {
        this._log.info("Preferred URI set; backing off.");
        this._backoff.preferred.backoff();
      } else {
        this._log.info("Preferred URI not set; backing off.");
        this._backoff.primary.backoff();
      }
    }
    /**
     * Reset both primary and preferred backoff mechanisms.
     */
    _resetBackoffs() {
      if (!this._backoff) {
        this._log.info("No backoff instance to reset.");
        return;
      }
      this._backoff.preferred.removeAllListeners("backoff");
      this._backoff.preferred.removeAllListeners("ready");
      this._backoff.primary.removeAllListeners("backoff");
      this._backoff.primary.removeAllListeners("ready");
      this._backoff = null;
      this._retryAfter = null;
      this._backoffStartTime.preferred = null;
      this._backoffStartTime.primary = null;
    }
    /**
     * Set a timeout to reconnect after HEARTBEAT_TIMEOUT milliseconds
     *   have passed without receiving a message over the WebSocket.
     */
    _setHeartbeatTimeout() {
      clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = setTimeout(() => {
        this._log.info(`No messages received in ${HEARTBEAT_TIMEOUT / 1e3} seconds. Reconnecting...`);
        this._shouldFallback = true;
        this._closeSocket();
      }, HEARTBEAT_TIMEOUT);
    }
    /**
     * Set the current and previous state
     */
    _setState(state) {
      this._previousState = this.state;
      this.state = state;
    }
    /**
     * Set up the primary and preferred backoff mechanisms.
     */
    _setupBackoffs() {
      const preferredRetryAfter = this._retryAfter !== null && this._preferredUri ? this._retryAfter : null;
      if (preferredRetryAfter) {
        this._log.info(`Setting initial preferred backoff value to retryAfter: ${preferredRetryAfter}ms`);
      }
      const maxPreferredDurationMs = preferredRetryAfter ? this._options.maxRetryAfterDurationMs : this._options.maxPreferredDurationMs;
      const preferredBackoffConfig = {
        factor: 2,
        jitter: 0.4,
        max: preferredRetryAfter ? this._options.maxRetryAfterDelayMs : this._options.maxPreferredDelayMs,
        min: preferredRetryAfter || 100,
        useInitialValue: Boolean(preferredRetryAfter)
      };
      this._log.info("Initializing preferred transport backoff using config: ", preferredBackoffConfig);
      const preferredBackoff = new Backoff(preferredBackoffConfig);
      preferredBackoff.on("backoff", (attempt, delay) => {
        if (this.state === WSTransportState.Closed) {
          this._log.info("Preferred backoff initiated but transport state is closed; not attempting a connection.");
          return;
        }
        this._log.info(`Will attempt to reconnect Websocket to preferred URI in ${delay}ms`);
        if (attempt === 0) {
          this._backoffStartTime.preferred = Date.now();
          this._log.info(`Preferred backoff start; ${this._backoffStartTime.preferred}`);
        }
      });
      preferredBackoff.on("ready", (attempt, _delay) => {
        if (this.state === WSTransportState.Closed) {
          this._log.info("Preferred backoff ready but transport state is closed; not attempting a connection.");
          return;
        }
        if (this._backoffStartTime.preferred === null) {
          this._log.info("Preferred backoff start time invalid; not attempting a connection.");
          return;
        }
        if (!this._backoff) {
          this._log.info("Preferred backoff instance invalid; not attempting a connection.");
          return;
        }
        if (Date.now() - this._backoffStartTime.preferred > maxPreferredDurationMs) {
          this._log.info("Max preferred backoff attempt time exceeded; falling back to primary backoff.");
          this._preferredUri = null;
          this._backoff.primary.backoff();
          return;
        }
        if (typeof this._preferredUri !== "string") {
          this._log.info("Preferred URI cleared; falling back to primary backoff.");
          this._preferredUri = null;
          this._backoff.primary.backoff();
          return;
        }
        this._connect(this._preferredUri, attempt + 1);
      });
      const primaryBackoffConfig = {
        factor: 2,
        jitter: 0.4,
        max: this._options.maxPrimaryDelayMs,
        // We only want a random initial delay if there are any fallback edges
        // Initial delay between 1s and 5s both inclusive
        min: this._uris && this._uris.length > 1 ? Math.floor(Math.random() * (5e3 - 1e3 + 1)) + 1e3 : 100
      };
      this._log.info("Initializing primary transport backoff using config: ", primaryBackoffConfig);
      const primaryBackoff = new Backoff(primaryBackoffConfig);
      primaryBackoff.on("backoff", (attempt, delay) => {
        if (this.state === WSTransportState.Closed) {
          this._log.info("Primary backoff initiated but transport state is closed; not attempting a connection.");
          return;
        }
        this._log.info(`Will attempt to reconnect WebSocket in ${delay}ms`);
        if (attempt === 0) {
          this._backoffStartTime.primary = Date.now();
          this._log.info(`Primary backoff start; ${this._backoffStartTime.primary}`);
        }
      });
      primaryBackoff.on("ready", (attempt, _delay) => {
        if (this.state === WSTransportState.Closed) {
          this._log.info("Primary backoff ready but transport state is closed; not attempting a connection.");
          return;
        }
        if (this._backoffStartTime.primary === null) {
          this._log.info("Primary backoff start time invalid; not attempting a connection.");
          return;
        }
        if (Date.now() - this._backoffStartTime.primary > this._options.maxPrimaryDurationMs) {
          this._log.info("Max primary backoff attempt time exceeded; not attempting a connection.");
          return;
        }
        this._connect(this._uris[this._uriIndex], attempt + 1);
      });
      return {
        preferred: preferredBackoff,
        primary: primaryBackoff
      };
    }
    /**
     * The uri the transport is currently connected to
     */
    get uri() {
      return this._connectedUri;
    }
  };
  WSTransport.defaultConstructorOptions = {
    WebSocket,
    connectTimeoutMs: CONNECT_TIMEOUT,
    maxPreferredDelayMs: MAX_PREFERRED_DELAY,
    maxPreferredDurationMs: MAX_PREFERRED_DURATION,
    maxPrimaryDelayMs: MAX_PRIMARY_DELAY,
    maxPrimaryDurationMs: MAX_PRIMARY_DURATION,
    maxRetryAfterDelayMs: MAX_RETRY_AFTER_DELAY,
    maxRetryAfterDurationMs: MAX_RETRY_AFTER_DURATION
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/pstream.js
  var PSTREAM_VERSION = "1.6";
  var MAX_RECONNECT_TIMEOUT_ALLOWED = 30;
  var PStream = class _PStream extends import_events7.EventEmitter {
    constructor(token, uris, options) {
      super();
      if (!(this instanceof _PStream)) {
        return new _PStream(token, uris, options);
      }
      const defaults = {
        TransportFactory: WSTransport
      };
      options = options || {};
      for (const prop in defaults) {
        if (prop in options) {
          continue;
        }
        options[prop] = defaults[prop];
      }
      this.options = options;
      this.token = token || "";
      this.status = "disconnected";
      this.gateway = null;
      this.region = null;
      this._messageQueue = [];
      this._preferredUri = null;
      this._uris = uris;
      this._handleTransportClose = this._handleTransportClose.bind(this);
      this._handleTransportError = this._handleTransportError.bind(this);
      this._handleTransportMessage = this._handleTransportMessage.bind(this);
      this._handleTransportOpen = this._handleTransportOpen.bind(this);
      this._log = new Log("PStream");
      this.on("error", () => {
        this._log.warn("Unexpected error handled in pstream");
      });
      const self = this;
      this.addListener("ready", () => {
        self.status = "ready";
      });
      this.addListener("offline", () => {
        self.status = "offline";
      });
      this.addListener("close", () => {
        self._log.info('Received "close" from server. Destroying PStream...');
        self._destroy();
      });
      this.transport = new this.options.TransportFactory(this._uris, {
        backoffMaxMs: this.options.backoffMaxMs,
        maxPreferredDurationMs: this.options.maxPreferredDurationMs
      });
      Object.defineProperties(this, {
        uri: {
          enumerable: true,
          get() {
            return this.transport.uri;
          }
        }
      });
      this.transport.on("close", this._handleTransportClose);
      this.transport.on("error", this._handleTransportError);
      this.transport.on("message", this._handleTransportMessage);
      this.transport.on("open", this._handleTransportOpen);
      this.transport.open();
      return this;
    }
  };
  PStream.prototype._handleTransportClose = function() {
    this.emit("transportClose");
    if (this.status !== "disconnected") {
      if (this.status !== "offline") {
        this.emit("offline", this);
      }
      this.status = "disconnected";
    }
  };
  PStream.prototype._handleTransportError = function(error2) {
    if (!error2) {
      this.emit("error", { error: {
        code: 31e3,
        message: "Websocket closed without a provided reason",
        twilioError: new SignalingErrors.ConnectionDisconnected()
      } });
      return;
    }
    this.emit("error", typeof error2.code !== "undefined" ? { error: error2 } : error2);
  };
  PStream.prototype._handleTransportMessage = function(msg) {
    if (!msg || !msg.data || typeof msg.data !== "string") {
      return;
    }
    const { type, payload = {} } = JSON.parse(msg.data);
    this.gateway = payload.gateway || this.gateway;
    this.region = payload.region || this.region;
    if (type === "error" && payload.error) {
      payload.error.twilioError = new SignalingErrors.ConnectionError();
    }
    this.emit(type, payload);
  };
  PStream.prototype._handleTransportOpen = function() {
    this.status = "connected";
    this.setToken(this.token);
    this.emit("transportOpen");
    const messages = this._messageQueue.splice(0, this._messageQueue.length);
    messages.forEach((message) => this._publish(...message));
  };
  PStream.toString = () => "[Twilio.PStream class]";
  PStream.prototype.toString = () => "[Twilio.PStream instance]";
  PStream.prototype.setToken = function(token) {
    this._log.info("Setting token and publishing listen");
    this.token = token;
    let reconnectTimeout = 0;
    const t = this.options.maxPreferredDurationMs;
    this._log.info(`maxPreferredDurationMs:${t}`);
    if (typeof t === "number" && t >= 0) {
      reconnectTimeout = Math.min(Math.ceil(t / 1e3), MAX_RECONNECT_TIMEOUT_ALLOWED);
    }
    this._log.info(`reconnectTimeout:${reconnectTimeout}`);
    const payload = {
      browserinfo: getBrowserInfo(),
      reconnectTimeout,
      token
    };
    this._publish("listen", payload);
  };
  PStream.prototype.sendMessage = function(callsid, content, contenttype = "application/json", messagetype, voiceeventsid) {
    const payload = {
      callsid,
      content,
      contenttype,
      messagetype,
      voiceeventsid
    };
    this._publish("message", payload, true);
  };
  PStream.prototype.register = function(mediaCapabilities) {
    const regPayload = { media: mediaCapabilities };
    this._publish("register", regPayload, true);
  };
  PStream.prototype.invite = function(sdp, callsid, params) {
    const payload = {
      callsid,
      sdp,
      twilio: params ? { params } : {}
    };
    this._publish("invite", payload, true);
  };
  PStream.prototype.reconnect = function(sdp, callsid, reconnect) {
    const payload = {
      callsid,
      reconnect,
      sdp,
      twilio: {}
    };
    this._publish("invite", payload, true);
  };
  PStream.prototype.answer = function(sdp, callsid) {
    this._publish("answer", { sdp, callsid }, true);
  };
  PStream.prototype.dtmf = function(callsid, digits) {
    this._publish("dtmf", { callsid, dtmf: digits }, true);
  };
  PStream.prototype.hangup = function(callsid, message) {
    const payload = message ? { callsid, message } : { callsid };
    this._publish("hangup", payload, true);
  };
  PStream.prototype.reject = function(callsid) {
    this._publish("reject", { callsid }, true);
  };
  PStream.prototype.reinvite = function(sdp, callsid) {
    this._publish("reinvite", { sdp, callsid }, false);
  };
  PStream.prototype._destroy = function() {
    this.transport.removeListener("close", this._handleTransportClose);
    this.transport.removeListener("error", this._handleTransportError);
    this.transport.removeListener("message", this._handleTransportMessage);
    this.transport.removeListener("open", this._handleTransportOpen);
    this.transport.close();
    this.emit("offline", this);
  };
  PStream.prototype.destroy = function() {
    this._log.info("PStream.destroy() called...");
    this._destroy();
    return this;
  };
  PStream.prototype.updatePreferredURI = function(uri) {
    this._preferredUri = uri;
    this.transport.updatePreferredURI(uri);
  };
  PStream.prototype.updateURIs = function(uris) {
    this._uris = uris;
    this.transport.updateURIs(this._uris);
  };
  PStream.prototype.publish = function(type, payload) {
    return this._publish(type, payload, true);
  };
  PStream.prototype._publish = function(type, payload, shouldRetry) {
    const msg = JSON.stringify({
      payload,
      type,
      version: PSTREAM_VERSION
    });
    const isSent = !!this.transport.send(msg);
    if (!isSent) {
      this.emit("error", { error: {
        code: 31009,
        message: "No transport available to send or receive messages",
        twilioError: new GeneralErrors.TransportError()
      } });
      if (shouldRetry) {
        this._messageQueue.push([type, payload, true]);
      }
    }
  };
  function getBrowserInfo() {
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const info2 = {
      browser: {
        platform: nav.platform || "unknown",
        userAgent: nav.userAgent || "unknown"
      },
      p: "browser",
      plugin: "rtc",
      v: RELEASE_VERSION
    };
    return info2;
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/regions.js
  var Edge;
  (function(Edge2) {
    Edge2["Sydney"] = "sydney";
    Edge2["SaoPaulo"] = "sao-paulo";
    Edge2["Dublin"] = "dublin";
    Edge2["Frankfurt"] = "frankfurt";
    Edge2["Tokyo"] = "tokyo";
    Edge2["Singapore"] = "singapore";
    Edge2["Ashburn"] = "ashburn";
    Edge2["Umatilla"] = "umatilla";
    Edge2["Roaming"] = "roaming";
    Edge2["AshburnIx"] = "ashburn-ix";
    Edge2["SanJoseIx"] = "san-jose-ix";
    Edge2["LondonIx"] = "london-ix";
    Edge2["FrankfurtIx"] = "frankfurt-ix";
    Edge2["SingaporeIx"] = "singapore-ix";
    Edge2["SydneyIx"] = "sydney-ix";
    Edge2["TokyoIx"] = "tokyo-ix";
  })(Edge || (Edge = {}));
  var Region;
  (function(Region2) {
    Region2["Au1"] = "au1";
    Region2["Au1Ix"] = "au1-ix";
    Region2["Br1"] = "br1";
    Region2["De1"] = "de1";
    Region2["De1Ix"] = "de1-ix";
    Region2["Gll"] = "gll";
    Region2["Ie1"] = "ie1";
    Region2["Ie1Ix"] = "ie1-ix";
    Region2["Ie1Tnx"] = "ie1-tnx";
    Region2["Jp1"] = "jp1";
    Region2["Jp1Ix"] = "jp1-ix";
    Region2["Sg1"] = "sg1";
    Region2["Sg1Ix"] = "sg1-ix";
    Region2["Sg1Tnx"] = "sg1-tnx";
    Region2["Us1"] = "us1";
    Region2["Us1Ix"] = "us1-ix";
    Region2["Us1Tnx"] = "us1-tnx";
    Region2["Us2"] = "us2";
    Region2["Us2Ix"] = "us2-ix";
    Region2["Us2Tnx"] = "us2-tnx";
  })(Region || (Region = {}));
  var regionShortcodes = {
    ASIAPAC_SINGAPORE: Region.Sg1,
    ASIAPAC_SYDNEY: Region.Au1,
    ASIAPAC_TOKYO: Region.Jp1,
    EU_FRANKFURT: Region.De1,
    EU_IRELAND: Region.Ie1,
    SOUTH_AMERICA_SAO_PAULO: Region.Br1,
    US_EAST_VIRGINIA: Region.Us1,
    US_WEST_OREGON: Region.Us2
  };
  var regionToEdge = {
    [Region.Au1]: Edge.Sydney,
    [Region.Br1]: Edge.SaoPaulo,
    [Region.Ie1]: Edge.Dublin,
    [Region.De1]: Edge.Frankfurt,
    [Region.Jp1]: Edge.Tokyo,
    [Region.Sg1]: Edge.Singapore,
    [Region.Us1]: Edge.Ashburn,
    [Region.Us2]: Edge.Umatilla,
    [Region.Gll]: Edge.Roaming,
    /**
     * Interconnect edges
     */
    [Region.Us1Ix]: Edge.AshburnIx,
    [Region.Us2Ix]: Edge.SanJoseIx,
    [Region.Ie1Ix]: Edge.LondonIx,
    [Region.De1Ix]: Edge.FrankfurtIx,
    [Region.Sg1Ix]: Edge.SingaporeIx,
    [Region.Au1Ix]: Edge.SydneyIx,
    [Region.Jp1Ix]: Edge.TokyoIx,
    /**
     * Tnx regions
     */
    [Region.Us1Tnx]: Edge.AshburnIx,
    [Region.Us2Tnx]: Edge.AshburnIx,
    [Region.Ie1Tnx]: Edge.LondonIx,
    [Region.Sg1Tnx]: Edge.SingaporeIx
  };
  var defaultEdge = Edge.Roaming;
  var defaultEventGatewayURI = "eventgw.twilio.com";
  function createChunderEdgeURI(edge) {
    return `voice-js.${edge}.twilio.com`;
  }
  function createEventGatewayURI(region) {
    return region ? `eventgw.${region}.twilio.com` : defaultEventGatewayURI;
  }
  function createSignalingEndpointURL(uri) {
    return `wss://${uri}/signal`;
  }
  function getChunderURIs(edge) {
    if (!!edge && typeof edge !== "string" && !Array.isArray(edge)) {
      throw new InvalidArgumentError("If `edge` is provided, it must be of type `string` or an array of strings.");
    }
    let uris;
    if (edge) {
      const edgeParams = Array.isArray(edge) ? edge : [edge];
      uris = edgeParams.map((param) => createChunderEdgeURI(param));
    } else {
      uris = [createChunderEdgeURI(defaultEdge)];
    }
    return uris;
  }
  function getRegionShortcode(region) {
    return regionShortcodes[region] || null;
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/sdp.js
  var ptToFixedBitrateAudioCodecName = {
    0: "PCMU",
    8: "PCMA"
  };
  var defaultOpusId = 111;
  var BITRATE_MAX = 51e4;
  var BITRATE_MIN = 6e3;
  function getPreferredCodecInfo(sdp) {
    const [, codecId, codecName] = /a=rtpmap:(\d+) (\S+)/m.exec(sdp) || [null, "", ""];
    const regex = new RegExp(`a=fmtp:${codecId} (\\S+)`, "m");
    const [, codecParams] = regex.exec(sdp) || [null, ""];
    return { codecName, codecParams };
  }
  function setIceAggressiveNomination(sdp) {
    if (!isChrome(window, window.navigator)) {
      return sdp;
    }
    return sdp.split("\n").filter((line) => line.indexOf("a=ice-lite") === -1).join("\n");
  }
  function setMaxAverageBitrate(sdp, maxAverageBitrate) {
    if (typeof maxAverageBitrate !== "number" || maxAverageBitrate < BITRATE_MIN || maxAverageBitrate > BITRATE_MAX) {
      return sdp;
    }
    const matches = /a=rtpmap:(\d+) opus/m.exec(sdp);
    const opusId = matches && matches.length ? matches[1] : defaultOpusId;
    const regex = new RegExp(`a=fmtp:${opusId}`);
    const lines = sdp.split("\n").map((line) => regex.test(line) ? line + `;maxaveragebitrate=${maxAverageBitrate}` : line);
    return lines.join("\n");
  }
  function setCodecPreferences(sdp, preferredCodecs) {
    const mediaSections = getMediaSections(sdp);
    const session = sdp.split("\r\nm=")[0];
    return [session].concat(mediaSections.map((section) => {
      if (!/^m=(audio|video)/.test(section)) {
        return section;
      }
      const kind = section.match(/^m=(audio|video)/)[1];
      const codecMap = createCodecMapForMediaSection(section);
      const payloadTypes = getReorderedPayloadTypes(codecMap, preferredCodecs);
      const newSection = setPayloadTypesInMediaSection(payloadTypes, section);
      const pcmaPayloadTypes = codecMap.get("pcma") || [];
      const pcmuPayloadTypes = codecMap.get("pcmu") || [];
      const fixedBitratePayloadTypes = kind === "audio" ? new Set(pcmaPayloadTypes.concat(pcmuPayloadTypes)) : /* @__PURE__ */ new Set();
      return fixedBitratePayloadTypes.has(payloadTypes[0]) ? newSection.replace(/\r\nb=(AS|TIAS):([0-9]+)/g, "") : newSection;
    })).join("\r\n");
  }
  function getMediaSections(sdp, kind, direction) {
    return sdp.replace(/\r\n\r\n$/, "\r\n").split("\r\nm=").slice(1).map((mediaSection) => `m=${mediaSection}`).filter((mediaSection) => {
      const kindPattern = new RegExp(`m=${".*"}`, "gm");
      const directionPattern = new RegExp(`a=${".*"}`, "gm");
      return kindPattern.test(mediaSection) && directionPattern.test(mediaSection);
    });
  }
  function createCodecMapForMediaSection(section) {
    return Array.from(createPtToCodecName(section)).reduce((codecMap, pair) => {
      const pt = pair[0];
      const codecName = pair[1];
      const pts = codecMap.get(codecName) || [];
      return codecMap.set(codecName, pts.concat(pt));
    }, /* @__PURE__ */ new Map());
  }
  function getReorderedPayloadTypes(codecMap, preferredCodecs) {
    preferredCodecs = preferredCodecs.map((codecName) => codecName.toLowerCase());
    const preferredPayloadTypes = flatMap(preferredCodecs, (codecName) => codecMap.get(codecName) || []);
    const remainingCodecs = difference(Array.from(codecMap.keys()), preferredCodecs);
    const remainingPayloadTypes = flatMap(remainingCodecs, (codecName) => codecMap.get(codecName));
    return preferredPayloadTypes.concat(remainingPayloadTypes);
  }
  function setPayloadTypesInMediaSection(payloadTypes, section) {
    const lines = section.split("\r\n");
    let mLine = lines[0];
    const otherLines = lines.slice(1);
    mLine = mLine.replace(/([0-9]+\s?)+$/, payloadTypes.join(" "));
    return [mLine].concat(otherLines).join("\r\n");
  }
  function createPtToCodecName(mediaSection) {
    return getPayloadTypesInMediaSection(mediaSection).reduce((ptToCodecName, pt) => {
      const rtpmapPattern = new RegExp(`a=rtpmap:${pt} ([^/]+)`);
      const matches = mediaSection.match(rtpmapPattern);
      const codecName = matches ? matches[1].toLowerCase() : ptToFixedBitrateAudioCodecName[pt] ? ptToFixedBitrateAudioCodecName[pt].toLowerCase() : "";
      return ptToCodecName.set(pt, codecName);
    }, /* @__PURE__ */ new Map());
  }
  function getPayloadTypesInMediaSection(section) {
    const mLine = section.split("\r\n")[0];
    const matches = mLine.match(/([0-9]+)/g);
    if (!matches) {
      return [];
    }
    return matches.slice(1).map((match) => parseInt(match, 10));
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/rtcpc.js
  function RTCPC(options) {
    this.log = new Log("RTCPC");
    if (typeof window === "undefined") {
      this.log.info("No RTCPeerConnection implementation available. The window object was not found.");
      return;
    }
    if (options && options.RTCPeerConnection) {
      this.RTCPeerConnection = options.RTCPeerConnection;
    } else if (typeof window.RTCPeerConnection === "function") {
      this.RTCPeerConnection = window.RTCPeerConnection;
    } else if (typeof window.webkitRTCPeerConnection === "function") {
      this.RTCPeerConnection = webkitRTCPeerConnection;
    } else if (typeof window.mozRTCPeerConnection === "function") {
      this.RTCPeerConnection = mozRTCPeerConnection;
      window.RTCSessionDescription = mozRTCSessionDescription;
      window.RTCIceCandidate = mozRTCIceCandidate;
    } else {
      this.log.info("No RTCPeerConnection implementation available");
    }
  }
  RTCPC.prototype.create = function(rtcConfiguration) {
    this.pc = new this.RTCPeerConnection(rtcConfiguration);
  };
  RTCPC.prototype.createModernConstraints = (c) => {
    if (typeof c === "undefined") {
      return null;
    }
    const nc = Object.assign({}, c);
    if (typeof webkitRTCPeerConnection !== "undefined" && !isLegacyEdge()) {
      nc.mandatory = {};
      if (typeof c.audio !== "undefined") {
        nc.mandatory.OfferToReceiveAudio = c.audio;
      }
      if (typeof c.video !== "undefined") {
        nc.mandatory.OfferToReceiveVideo = c.video;
      }
    } else {
      if (typeof c.audio !== "undefined") {
        nc.offerToReceiveAudio = c.audio;
      }
      if (typeof c.video !== "undefined") {
        nc.offerToReceiveVideo = c.video;
      }
    }
    delete nc.audio;
    delete nc.video;
    return nc;
  };
  RTCPC.prototype.createOffer = function(maxAverageBitrate, constraints, onSuccess, onError) {
    constraints = this.createModernConstraints(constraints);
    return promisifyCreate(this.pc.createOffer, this.pc)(constraints).then((offer) => {
      if (!this.pc) {
        return Promise.resolve();
      }
      const sdp = setMaxAverageBitrate(offer.sdp, maxAverageBitrate);
      return promisifySet(this.pc.setLocalDescription, this.pc)(new RTCSessionDescription({
        sdp,
        type: "offer"
      }));
    }).then(onSuccess, onError);
  };
  RTCPC.prototype.createAnswer = function(maxAverageBitrate, constraints, onSuccess, onError) {
    constraints = this.createModernConstraints(constraints);
    return promisifyCreate(this.pc.createAnswer, this.pc)(constraints).then((answer) => {
      if (!this.pc) {
        return Promise.resolve();
      }
      const sdp = setMaxAverageBitrate(answer.sdp, maxAverageBitrate);
      return promisifySet(this.pc.setLocalDescription, this.pc)(new RTCSessionDescription({
        sdp,
        type: "answer"
      }));
    }).then(onSuccess, onError);
  };
  RTCPC.prototype.processSDP = function(maxAverageBitrate, codecPreferences, sdp, constraints, onSuccess, onError) {
    sdp = setCodecPreferences(sdp, codecPreferences);
    const desc = new RTCSessionDescription({ sdp, type: "offer" });
    return promisifySet(this.pc.setRemoteDescription, this.pc)(desc).then(() => {
      this.createAnswer(maxAverageBitrate, constraints, onSuccess, onError);
    });
  };
  RTCPC.prototype.getSDP = function() {
    return this.pc.localDescription.sdp;
  };
  RTCPC.prototype.processAnswer = function(codecPreferences, sdp, onSuccess, onError) {
    if (!this.pc) {
      return Promise.resolve();
    }
    sdp = setCodecPreferences(sdp, codecPreferences);
    return promisifySet(this.pc.setRemoteDescription, this.pc)(new RTCSessionDescription({ sdp, type: "answer" })).then(onSuccess, onError);
  };
  RTCPC.test = () => {
    if (typeof navigator === "object") {
      const getUserMedia2 = navigator.mediaDevices && navigator.mediaDevices.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.getUserMedia;
      if (isLegacyEdge(navigator)) {
        return false;
      }
      if (getUserMedia2 && typeof window.RTCPeerConnection === "function") {
        return true;
      } else if (getUserMedia2 && typeof window.webkitRTCPeerConnection === "function") {
        return true;
      } else if (getUserMedia2 && typeof window.mozRTCPeerConnection === "function") {
        try {
          const test = new window.mozRTCPeerConnection();
          if (typeof test.getLocalStreams !== "function") {
            return false;
          }
        } catch (e) {
          return false;
        }
        return true;
      } else if (typeof RTCIceGatherer !== "undefined") {
        return true;
      }
    }
    return false;
  };
  function promisify(fn, ctx, areCallbacksFirst, checkRval) {
    return function() {
      const args = Array.prototype.slice.call(arguments);
      return new Promise((resolve) => {
        const returnValue = fn.apply(ctx, args);
        if (!checkRval) {
          resolve(returnValue);
          return;
        }
        if (typeof returnValue === "object" && typeof returnValue.then === "function") {
          resolve(returnValue);
        } else {
          throw new Error();
        }
      }).catch(() => new Promise((resolve, reject) => {
        fn.apply(ctx, areCallbacksFirst ? [resolve, reject].concat(args) : args.concat([resolve, reject]));
      }));
    };
  }
  function promisifyCreate(fn, ctx) {
    return promisify(fn, ctx, true, true);
  }
  function promisifySet(fn, ctx) {
    return promisify(fn, ctx, false, false);
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/peerconnection.js
  var ICE_GATHERING_TIMEOUT = 15e3;
  var ICE_GATHERING_FAIL_NONE = "none";
  var ICE_GATHERING_FAIL_TIMEOUT = "timeout";
  var INITIAL_ICE_CONNECTION_STATE = "new";
  var VOLUME_INTERVAL_MS = 50;
  function PeerConnection(audioHelper, pstream, options) {
    if (!audioHelper || !pstream) {
      throw new InvalidArgumentError("Audiohelper, and pstream are required arguments");
    }
    if (!(this instanceof PeerConnection)) {
      return new PeerConnection(audioHelper, pstream, options);
    }
    this._log = new Log("PeerConnection");
    function noop() {
      this._log.warn("Unexpected noop call in peerconnection");
    }
    this.onaudio = noop;
    this.onopen = noop;
    this.onerror = noop;
    this.onclose = noop;
    this.ondisconnected = noop;
    this.onfailed = noop;
    this.onconnected = noop;
    this.onreconnected = noop;
    this.onsignalingstatechange = noop;
    this.ondtlstransportstatechange = noop;
    this.onicegatheringfailure = noop;
    this.onicegatheringstatechange = noop;
    this.oniceconnectionstatechange = noop;
    this.onpcconnectionstatechange = noop;
    this.onicecandidate = noop;
    this.onselectedcandidatepairchange = noop;
    this.onvolume = noop;
    this.version = null;
    this.pstream = pstream;
    this.stream = null;
    this.sinkIds = /* @__PURE__ */ new Set(["default"]);
    this.outputs = /* @__PURE__ */ new Map();
    this.status = "connecting";
    this.callSid = null;
    this.isMuted = false;
    const AudioContext2 = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    this._isSinkSupported = !!AudioContext2 && typeof HTMLAudioElement !== "undefined" && HTMLAudioElement.prototype.setSinkId;
    this._audioContext = AudioContext2 && audioHelper._audioContext;
    this._audioHelper = audioHelper;
    this._audioProcessorEventObserver = audioHelper._getAudioProcessorEventObserver();
    this._hasIceCandidates = false;
    this._hasIceGatheringFailures = false;
    this._iceGatheringTimeoutId = null;
    this._masterAudio = null;
    this._masterAudioDeviceId = null;
    this._mediaStreamSource = null;
    this._dtmfSender = null;
    this._dtmfSenderUnsupported = false;
    this._callEvents = [];
    this._nextTimeToPublish = Date.now();
    this._onAnswerOrRinging = noop;
    this._onHangup = noop;
    this._remoteStream = null;
    this._shouldManageStream = true;
    this._iceState = INITIAL_ICE_CONNECTION_STATE;
    this.options = options = options || {};
    this.navigator = options.navigator || (typeof navigator !== "undefined" ? navigator : null);
    this.util = options.util || util_exports;
    this.codecPreferences = options.codecPreferences;
    this._onAudioProcessorAdded = (isRemote) => {
      this._handleAudioProcessorEvent(isRemote, true);
    };
    this._onAudioProcessorRemoved = (isRemote) => {
      this._handleAudioProcessorEvent(isRemote, false);
    };
    this._audioProcessorEventObserver.on("add", this._onAudioProcessorAdded);
    this._audioProcessorEventObserver.on("remove", this._onAudioProcessorRemoved);
    return this;
  }
  PeerConnection.prototype.uri = function() {
    return this._uri;
  };
  PeerConnection.prototype.openDefaultDeviceWithConstraints = function(constraints) {
    return this._audioHelper._openDefaultDeviceWithConstraints(constraints).then(this._setInputTracksFromStream.bind(this, false));
  };
  PeerConnection.prototype.setInputTracksFromStream = function(stream) {
    const self = this;
    return this._setInputTracksFromStream(true, stream).then(() => {
      self._shouldManageStream = false;
    });
  };
  PeerConnection.prototype._createAnalyser = (audioContext, options) => {
    options = Object.assign({
      fftSize: 32,
      smoothingTimeConstant: 0.3
    }, options);
    const analyser = audioContext.createAnalyser();
    for (const field in options) {
      analyser[field] = options[field];
    }
    return analyser;
  };
  PeerConnection.prototype._setVolumeHandler = function(handler) {
    this.onvolume = handler;
  };
  PeerConnection.prototype._startPollingVolume = function() {
    if (!this._audioContext || !this.stream || !this._remoteStream) {
      return;
    }
    const audioContext = this._audioContext;
    const inputAnalyser = this._inputAnalyser = this._createAnalyser(audioContext);
    const inputBufferLength = inputAnalyser.frequencyBinCount;
    const inputDataArray = new Uint8Array(inputBufferLength);
    this._inputAnalyser2 = this._createAnalyser(audioContext, {
      maxDecibels: 0,
      minDecibels: -127,
      smoothingTimeConstant: 0
    });
    const outputAnalyser = this._outputAnalyser = this._createAnalyser(audioContext);
    const outputBufferLength = outputAnalyser.frequencyBinCount;
    const outputDataArray = new Uint8Array(outputBufferLength);
    this._outputAnalyser2 = this._createAnalyser(audioContext, {
      maxDecibels: 0,
      minDecibels: -127,
      smoothingTimeConstant: 0
    });
    this._updateInputStreamSource(this.stream);
    this._updateOutputStreamSource(this._remoteStream);
    const self = this;
    setTimeout(function emitVolume() {
      if (!self._audioContext) {
        return;
      } else if (self.status === "closed") {
        self._inputAnalyser.disconnect();
        self._outputAnalyser.disconnect();
        self._inputAnalyser2.disconnect();
        self._outputAnalyser2.disconnect();
        return;
      }
      self._inputAnalyser.getByteFrequencyData(inputDataArray);
      const inputVolume = self.util.average(inputDataArray);
      self._inputAnalyser2.getByteFrequencyData(inputDataArray);
      const inputVolume2 = self.util.average(inputDataArray);
      self._outputAnalyser.getByteFrequencyData(outputDataArray);
      const outputVolume = self.util.average(outputDataArray);
      self._outputAnalyser2.getByteFrequencyData(outputDataArray);
      const outputVolume2 = self.util.average(outputDataArray);
      self.onvolume(inputVolume / 255, outputVolume / 255, inputVolume2, outputVolume2);
      setTimeout(emitVolume, VOLUME_INTERVAL_MS);
    }, VOLUME_INTERVAL_MS);
  };
  PeerConnection.prototype._stopStream = function _stopStream() {
    if (!this._shouldManageStream) {
      return;
    }
    this._audioHelper._stopDefaultInputDeviceStream();
  };
  PeerConnection.prototype._updateInputStreamSource = function(stream) {
    if (this._inputStreamSource) {
      this._inputStreamSource.disconnect();
    }
    try {
      this._inputStreamSource = this._audioContext.createMediaStreamSource(stream);
      this._inputStreamSource.connect(this._inputAnalyser);
      this._inputStreamSource.connect(this._inputAnalyser2);
    } catch (ex) {
      this._log.warn("Unable to update input MediaStreamSource", ex);
      this._inputStreamSource = null;
    }
  };
  PeerConnection.prototype._updateOutputStreamSource = function(stream) {
    if (this._outputStreamSource) {
      this._outputStreamSource.disconnect();
    }
    try {
      this._outputStreamSource = this._audioContext.createMediaStreamSource(stream);
      this._outputStreamSource.connect(this._outputAnalyser);
      this._outputStreamSource.connect(this._outputAnalyser2);
    } catch (ex) {
      this._log.warn("Unable to update output MediaStreamSource", ex);
      this._outputStreamSource = null;
    }
  };
  PeerConnection.prototype._setInputTracksFromStream = function(shouldClone, newStream) {
    if (!newStream) {
      return Promise.reject(new InvalidArgumentError("Can not set input stream to null while in a call"));
    }
    if (!newStream.getAudioTracks().length) {
      return Promise.reject(new InvalidArgumentError("Supplied input stream has no audio tracks"));
    }
    const localStream = this.stream;
    const getStreamPromise = () => {
      this.mute(this.isMuted);
      return Promise.resolve(this.stream);
    };
    if (!localStream) {
      this.stream = shouldClone ? cloneStream(newStream, this.options.MediaStream) : newStream;
    } else {
      if (this._shouldManageStream) {
        this._stopStream();
      }
      if (!this._sender) {
        this._sender = this.version.pc.getSenders()[0];
      }
      return this._sender.replaceTrack(newStream.getAudioTracks()[0]).then(() => {
        this._updateInputStreamSource(newStream);
        this.stream = shouldClone ? cloneStream(newStream, this.options.MediaStream) : newStream;
        return getStreamPromise();
      });
    }
    return getStreamPromise();
  };
  PeerConnection.prototype._onInputDevicesChanged = function() {
    if (!this.stream) {
      return;
    }
    const activeInputWasLost = this.stream.getAudioTracks().every((track) => track.readyState === "ended");
    if (activeInputWasLost && this._shouldManageStream) {
      this.openDefaultDeviceWithConstraints({ audio: true });
    }
  };
  PeerConnection.prototype._onIceGatheringFailure = function(type) {
    this._hasIceGatheringFailures = true;
    this.onicegatheringfailure(type);
  };
  PeerConnection.prototype._onMediaConnectionStateChange = function(newState) {
    const previousState = this._iceState;
    if (previousState === newState || newState !== "connected" && newState !== "disconnected" && newState !== "failed") {
      return;
    }
    this._iceState = newState;
    let message;
    switch (newState) {
      case "connected":
        if (previousState === "disconnected" || previousState === "failed") {
          message = "ICE liveliness check succeeded. Connection with Twilio restored";
          this._log.info(message);
          this.onreconnected(message);
        } else {
          message = "Media connection established.";
          this._log.info(message);
          this.onconnected(message);
        }
        this._stopIceGatheringTimeout();
        this._hasIceGatheringFailures = false;
        break;
      case "disconnected":
        message = "ICE liveliness check failed. May be having trouble connecting to Twilio";
        this._log.warn(message);
        this.ondisconnected(message);
        break;
      case "failed":
        message = "Connection with Twilio was interrupted.";
        this._log.warn(message);
        this.onfailed(message);
        break;
    }
  };
  PeerConnection.prototype._setSinkIds = function(sinkIds) {
    if (!this._isSinkSupported) {
      return Promise.reject(new NotSupportedError("Audio output selection is not supported by this browser"));
    }
    this.sinkIds = new Set(sinkIds.forEach ? sinkIds : [sinkIds]);
    return this.version ? this._updateAudioOutputs() : Promise.resolve();
  };
  PeerConnection.prototype._startIceGatheringTimeout = function startIceGatheringTimeout() {
    this._stopIceGatheringTimeout();
    this._iceGatheringTimeoutId = setTimeout(() => {
      this._onIceGatheringFailure(ICE_GATHERING_FAIL_TIMEOUT);
    }, ICE_GATHERING_TIMEOUT);
  };
  PeerConnection.prototype._stopIceGatheringTimeout = function stopIceGatheringTimeout() {
    clearInterval(this._iceGatheringTimeoutId);
  };
  PeerConnection.prototype._updateAudioOutputs = function updateAudioOutputs() {
    const addedOutputIds = Array.from(this.sinkIds).filter(function(id) {
      return !this.outputs.has(id);
    }, this);
    const removedOutputIds = Array.from(this.outputs.keys()).filter(function(id) {
      return !this.sinkIds.has(id);
    }, this);
    const self = this;
    const createOutputPromises = addedOutputIds.map(this._createAudioOutput, this);
    return Promise.all(createOutputPromises).then(() => Promise.all(removedOutputIds.map(self._removeAudioOutput, self)));
  };
  PeerConnection.prototype._createAudio = function createAudio(arr) {
    const audio = new Audio(arr);
    this.onaudio(audio);
    return audio;
  };
  PeerConnection.prototype._createAudioOutput = function createAudioOutput(id) {
    let dest = null;
    if (this._mediaStreamSource) {
      dest = this._audioContext.createMediaStreamDestination();
      this._mediaStreamSource.connect(dest);
    }
    const audio = this._createAudio();
    setAudioSource(audio, dest && dest.stream ? dest.stream : this.pcStream, this._audioHelper).catch(() => this._log.error("Error attaching stream to element (_createAudioOutput)."));
    const self = this;
    return audio.setSinkId(id).then(() => audio.play()).then(() => {
      self.outputs.set(id, {
        audio,
        dest
      });
    });
  };
  PeerConnection.prototype._removeAudioOutputs = function removeAudioOutputs() {
    if (this._masterAudio && typeof this._masterAudioDeviceId !== "undefined") {
      this._disableOutput(this, this._masterAudioDeviceId);
      this.outputs.delete(this._masterAudioDeviceId);
      this._masterAudioDeviceId = null;
      if (!this._masterAudio.paused) {
        this._masterAudio.pause();
      }
      if (typeof this._masterAudio.srcObject !== "undefined") {
        this._masterAudio.srcObject = null;
      } else {
        this._masterAudio.src = "";
      }
      this._masterAudio = null;
    }
    return Array.from(this.outputs.keys()).map(this._removeAudioOutput, this);
  };
  PeerConnection.prototype._disableOutput = function disableOutput(pc, id) {
    const output = pc.outputs.get(id);
    if (!output) {
      return;
    }
    if (output.audio) {
      output.audio.pause();
      output.audio.src = "";
    }
    if (output.dest) {
      output.dest.disconnect();
    }
  };
  PeerConnection.prototype._reassignMasterOutput = function reassignMasterOutput(pc, masterId) {
    const masterOutput = pc.outputs.get(masterId);
    pc.outputs.delete(masterId);
    const self = this;
    const activeDeviceId = Array.from(pc.outputs.keys())[0];
    const idToReplace = typeof activeDeviceId === "string" ? activeDeviceId : "default";
    return masterOutput.audio.setSinkId(idToReplace).then(() => {
      self._disableOutput(pc, idToReplace);
      pc.outputs.set(idToReplace, masterOutput);
      pc._masterAudioDeviceId = idToReplace;
    }).catch(function rollback() {
      pc.outputs.set(masterId, masterOutput);
      self._log.info("Could not reassign master output. Attempted to roll back.");
    });
  };
  PeerConnection.prototype._removeAudioOutput = function removeAudioOutput(id) {
    if (this._masterAudioDeviceId === id) {
      return this._reassignMasterOutput(this, id);
    }
    this._disableOutput(this, id);
    this.outputs.delete(id);
    return Promise.resolve();
  };
  PeerConnection.prototype._onAddTrack = function onAddTrack(pc, stream) {
    const audio = pc._masterAudio = this._createAudio();
    setAudioSource(audio, stream, this._audioHelper).then(() => audio.play()).catch(() => pc._log.error("Error attaching stream to element (_onAddTrack)."));
    const activeDeviceId = Array.from(pc.outputs.keys())[0];
    const deviceId = typeof activeDeviceId === "string" ? activeDeviceId : "default";
    pc._masterAudioDeviceId = deviceId;
    pc.outputs.set(deviceId, { audio });
    try {
      pc._mediaStreamSource = pc._audioContext.createMediaStreamSource(stream);
    } catch (ex) {
      this._log.warn("Unable to create a MediaStreamSource from onAddTrack", ex);
      this._mediaStreamSource = null;
    }
    pc.pcStream = stream;
    pc._updateAudioOutputs();
  };
  PeerConnection.prototype._fallbackOnAddTrack = function fallbackOnAddTrack(pc, stream) {
    const audio = document && document.createElement("audio");
    setAudioSource(audio, stream, this._audioHelper).then(() => audio.play()).catch(() => pc._log.error("Error attaching stream to element (_fallbackOnAddTrack)."));
    pc.outputs.set("default", { audio });
  };
  PeerConnection.prototype._setEncodingParameters = function(enableDscp) {
    if (!enableDscp || !this._sender || typeof this._sender.getParameters !== "function" || typeof this._sender.setParameters !== "function") {
      return;
    }
    const params = this._sender.getParameters();
    if (!params.priority && !(params.encodings && params.encodings.length)) {
      return;
    }
    params.priority = "high";
    if (params.encodings && params.encodings.length) {
      params.encodings.forEach((encoding) => {
        encoding.priority = "high";
        encoding.networkPriority = "high";
      });
    }
    this._sender.setParameters(params);
  };
  PeerConnection.prototype._setupPeerConnection = function(rtcConfiguration) {
    const self = this;
    const version = new (this.options.rtcpcFactory || RTCPC)({ RTCPeerConnection: this.options.RTCPeerConnection });
    version.create(rtcConfiguration);
    addStream(version.pc, this.stream);
    const supportedCodecs = RTCRtpReceiver.getCapabilities("audio").codecs;
    this._log.debug("sorting codecs", supportedCodecs, this.codecPreferences);
    const sortedCodecs = sortByMimeTypes(supportedCodecs, this.codecPreferences);
    const [transceiver] = version.pc.getTransceivers();
    this._log.debug("setting sorted codecs", sortedCodecs);
    transceiver.setCodecPreferences(sortedCodecs);
    const eventName = "ontrack" in version.pc ? "ontrack" : "onaddstream";
    version.pc[eventName] = (event) => {
      const stream = self._remoteStream = event.stream || event.streams[0];
      if (typeof version.pc.getSenders === "function") {
        this._sender = version.pc.getSenders()[0];
      }
      if (self._isSinkSupported) {
        self._onAddTrack(self, stream);
      } else {
        self._fallbackOnAddTrack(self, stream);
      }
      self._startPollingVolume();
    };
    return version;
  };
  PeerConnection.prototype._maybeSetIceAggressiveNomination = function(sdp) {
    return this.options.forceAggressiveIceNomination ? setIceAggressiveNomination(sdp) : sdp;
  };
  PeerConnection.prototype._setupChannel = function() {
    const pc = this.version.pc;
    this.version.pc.onopen = () => {
      this.status = "open";
      this.onopen();
    };
    this.version.pc.onstatechange = () => {
      if (this.version.pc && this.version.pc.readyState === "stable") {
        this.status = "open";
        this.onopen();
      }
    };
    this.version.pc.onsignalingstatechange = () => {
      const state = pc.signalingState;
      this._log.info(`signalingState is "${state}"`);
      if (this.version.pc && this.version.pc.signalingState === "stable") {
        this.status = "open";
        this.onopen();
      }
      this.onsignalingstatechange(pc.signalingState);
    };
    pc.onconnectionstatechange = (event) => {
      let state = pc.connectionState;
      if (!state && event && event.target) {
        const targetPc = event.target;
        state = targetPc.connectionState || targetPc.connectionState_;
        this._log.info(`pc.connectionState not detected. Using target PC. State=${state}`);
      }
      if (!state) {
        this._log.warn(`onconnectionstatechange detected but state is "${state}"`);
      } else {
        this._log.info(`pc.connectionState is "${state}"`);
      }
      this.onpcconnectionstatechange(state);
      this._onMediaConnectionStateChange(state);
    };
    pc.onicecandidate = (event) => {
      const { candidate } = event;
      if (candidate) {
        this._hasIceCandidates = true;
        this.onicecandidate(candidate);
        this._setupRTCIceTransportListener();
      }
      this._log.info(`ICE Candidate: ${JSON.stringify(candidate)}`);
    };
    pc.onicegatheringstatechange = () => {
      const state = pc.iceGatheringState;
      if (state === "gathering") {
        this._startIceGatheringTimeout();
      } else if (state === "complete") {
        this._stopIceGatheringTimeout();
        if (!this._hasIceCandidates) {
          this._onIceGatheringFailure(ICE_GATHERING_FAIL_NONE);
        }
        if (this._hasIceCandidates && this._hasIceGatheringFailures) {
          this._startIceGatheringTimeout();
        }
      }
      this._log.info(`pc.iceGatheringState is "${pc.iceGatheringState}"`);
      this.onicegatheringstatechange(state);
    };
    pc.oniceconnectionstatechange = () => {
      this._log.info(`pc.iceConnectionState is "${pc.iceConnectionState}"`);
      this.oniceconnectionstatechange(pc.iceConnectionState);
      this._onMediaConnectionStateChange(pc.iceConnectionState);
    };
  };
  PeerConnection.prototype._initializeMediaStream = function(rtcConfiguration) {
    if (this.status === "open") {
      return false;
    }
    if (this.pstream.status === "disconnected") {
      this.onerror({ info: {
        code: 31e3,
        message: "Cannot establish connection. Client is disconnected",
        twilioError: new SignalingErrors.ConnectionDisconnected()
      } });
      this.close();
      return false;
    }
    this.version = this._setupPeerConnection(rtcConfiguration);
    this._setupChannel();
    return true;
  };
  PeerConnection.prototype._removeReconnectionListeners = function() {
    if (this.pstream) {
      this.pstream.removeListener("answer", this._onAnswerOrRinging);
      this.pstream.removeListener("hangup", this._onHangup);
    }
  };
  PeerConnection.prototype._setupRTCDtlsTransportListener = function() {
    const dtlsTransport = this.getRTCDtlsTransport();
    if (!dtlsTransport || dtlsTransport.onstatechange) {
      return;
    }
    const handler = () => {
      this._log.info(`dtlsTransportState is "${dtlsTransport.state}"`);
      this.ondtlstransportstatechange(dtlsTransport.state);
    };
    handler();
    dtlsTransport.onstatechange = handler;
  };
  PeerConnection.prototype._setupRTCIceTransportListener = function() {
    const iceTransport = this._getRTCIceTransport();
    if (!iceTransport || iceTransport.onselectedcandidatepairchange) {
      return;
    }
    iceTransport.onselectedcandidatepairchange = () => this.onselectedcandidatepairchange(iceTransport.getSelectedCandidatePair());
  };
  PeerConnection.prototype.iceRestart = function() {
    this._log.info("Attempting to restart ICE...");
    this._hasIceCandidates = false;
    this.version.createOffer(this.options.maxAverageBitrate, { iceRestart: true }).then(() => {
      this._removeReconnectionListeners();
      this._onAnswerOrRinging = (payload) => {
        this._removeReconnectionListeners();
        if (!payload.sdp || this.version.pc.signalingState !== "have-local-offer") {
          const message = `Invalid state or param during ICE Restart:hasSdp:${!!payload.sdp}, signalingState:${this.version.pc.signalingState}`;
          this._log.warn(message);
          return;
        }
        const sdp = this._maybeSetIceAggressiveNomination(payload.sdp);
        this._answerSdp = sdp;
        if (this.status !== "closed") {
          this.version.processAnswer(this.codecPreferences, sdp, null, (err) => {
            const message = err && err.message ? err.message : err;
            this._log.error(`Failed to process answer during ICE Restart. Error: ${message}`);
          });
        }
      };
      this._onHangup = () => {
        this._log.info("Received hangup during ICE Restart");
        this._removeReconnectionListeners();
      };
      this.pstream.on("answer", this._onAnswerOrRinging);
      this.pstream.on("hangup", this._onHangup);
      this.pstream.reinvite(this.version.getSDP(), this.callSid);
    }).catch((err) => {
      const message = err && err.message ? err.message : err;
      this._log.error(`Failed to createOffer during ICE Restart. Error: ${message}`);
      this.onfailed(message);
    });
  };
  PeerConnection.prototype.makeOutgoingCall = function(params, signalingReconnectToken, callsid, rtcConfiguration, onMediaStarted) {
    if (!this._initializeMediaStream(rtcConfiguration)) {
      return;
    }
    const self = this;
    this.callSid = callsid;
    function onAnswerSuccess() {
      if (self.options) {
        self._setEncodingParameters(self.options.dscp);
      }
      onMediaStarted(self.version.pc);
    }
    function onAnswerError(err) {
      const errMsg = err.message || err;
      self.onerror({ info: {
        code: 31e3,
        message: `Error processing answer: ${errMsg}`,
        twilioError: new MediaErrors.ClientRemoteDescFailed()
      } });
    }
    this._onAnswerOrRinging = (payload) => {
      if (!payload.sdp) {
        return;
      }
      const sdp = this._maybeSetIceAggressiveNomination(payload.sdp);
      self._answerSdp = sdp;
      if (self.status !== "closed") {
        self.version.processAnswer(this.codecPreferences, sdp, onAnswerSuccess, onAnswerError);
      }
      self.pstream.removeListener("answer", self._onAnswerOrRinging);
      self.pstream.removeListener("ringing", self._onAnswerOrRinging);
    };
    this.pstream.on("answer", this._onAnswerOrRinging);
    this.pstream.on("ringing", this._onAnswerOrRinging);
    function onOfferSuccess() {
      if (self.status !== "closed") {
        if (signalingReconnectToken) {
          self.pstream.reconnect(self.version.getSDP(), self.callSid, signalingReconnectToken);
        } else {
          self.pstream.invite(self.version.getSDP(), self.callSid, params);
        }
        self._setupRTCDtlsTransportListener();
      }
    }
    function onOfferError(err) {
      const errMsg = err.message || err;
      self.onerror({ info: {
        code: 31e3,
        message: `Error creating the offer: ${errMsg}`,
        twilioError: new MediaErrors.ClientLocalDescFailed()
      } });
    }
    this.version.createOffer(this.options.maxAverageBitrate, { audio: true }, onOfferSuccess, onOfferError);
  };
  PeerConnection.prototype.answerIncomingCall = function(callSid, sdp, rtcConfiguration, onMediaStarted) {
    if (!this._initializeMediaStream(rtcConfiguration)) {
      return;
    }
    sdp = this._maybeSetIceAggressiveNomination(sdp);
    this._answerSdp = sdp.replace(/^a=setup:actpass$/gm, "a=setup:passive");
    this.callSid = callSid;
    const self = this;
    function onAnswerSuccess() {
      if (self.status !== "closed") {
        self.pstream.answer(self.version.getSDP(), callSid);
        if (self.options) {
          self._setEncodingParameters(self.options.dscp);
        }
        onMediaStarted(self.version.pc);
        self._setupRTCDtlsTransportListener();
      }
    }
    function onAnswerError(err) {
      const errMsg = err.message || err;
      self.onerror({ info: {
        code: 31e3,
        message: `Error creating the answer: ${errMsg}`,
        twilioError: new MediaErrors.ClientRemoteDescFailed()
      } });
    }
    this.version.processSDP(this.options.maxAverageBitrate, this.codecPreferences, sdp, { audio: true }, onAnswerSuccess, onAnswerError);
  };
  PeerConnection.prototype.close = function() {
    if (this.version && this.version.pc) {
      if (this.version.pc.signalingState !== "closed") {
        this.version.pc.close();
      }
      this.version.pc = null;
    }
    if (this.stream) {
      this.mute(false);
      this._stopStream();
    }
    this.stream = null;
    this._removeReconnectionListeners();
    this._stopIceGatheringTimeout();
    this._audioHelper._destroyRemoteProcessedStream();
    this._audioProcessorEventObserver.removeListener("add", this._onAudioProcessorAdded);
    this._audioProcessorEventObserver.removeListener("remove", this._onAudioProcessorRemoved);
    Promise.all(this._removeAudioOutputs()).catch(() => {
    });
    if (this._mediaStreamSource) {
      this._mediaStreamSource.disconnect();
    }
    if (this._inputAnalyser) {
      this._inputAnalyser.disconnect();
    }
    if (this._outputAnalyser) {
      this._outputAnalyser.disconnect();
    }
    if (this._inputAnalyser2) {
      this._inputAnalyser2.disconnect();
    }
    if (this._outputAnalyser2) {
      this._outputAnalyser2.disconnect();
    }
    this.status = "closed";
    this.onclose();
  };
  PeerConnection.prototype.reject = function(callSid) {
    this.callSid = callSid;
  };
  PeerConnection.prototype.ignore = function(callSid) {
    this.callSid = callSid;
  };
  PeerConnection.prototype.mute = function(shouldMute) {
    this.isMuted = shouldMute;
    if (!this.stream) {
      return;
    }
    if (this._sender && this._sender.track) {
      this._sender.track.enabled = !shouldMute;
    } else {
      const audioTracks = typeof this.stream.getAudioTracks === "function" ? this.stream.getAudioTracks() : this.stream.audioTracks;
      audioTracks.forEach((track) => {
        track.enabled = !shouldMute;
      });
    }
  };
  PeerConnection.prototype.getOrCreateDTMFSender = function getOrCreateDTMFSender() {
    if (this._dtmfSender || this._dtmfSenderUnsupported) {
      return this._dtmfSender || null;
    }
    const self = this;
    const pc = this.version.pc;
    if (!pc) {
      this._log.warn("No RTCPeerConnection available to call createDTMFSender on");
      return null;
    }
    if (typeof pc.getSenders === "function" && (typeof RTCDTMFSender === "function" || typeof RTCDtmfSender === "function")) {
      const chosenSender = pc.getSenders().find((sender) => sender.dtmf);
      if (chosenSender) {
        this._log.info("Using RTCRtpSender#dtmf");
        this._dtmfSender = chosenSender.dtmf;
        return this._dtmfSender;
      }
    }
    if (typeof pc.createDTMFSender === "function" && typeof pc.getLocalStreams === "function") {
      const track = pc.getLocalStreams().map((stream) => {
        const tracks = self._getAudioTracks(stream);
        return tracks && tracks[0];
      })[0];
      if (!track) {
        this._log.warn("No local audio MediaStreamTrack available on the RTCPeerConnection to pass to createDTMFSender");
        return null;
      }
      this._log.info("Creating RTCDTMFSender");
      this._dtmfSender = pc.createDTMFSender(track);
      return this._dtmfSender;
    }
    this._log.info("RTCPeerConnection does not support RTCDTMFSender");
    this._dtmfSenderUnsupported = true;
    return null;
  };
  PeerConnection.prototype.getRTCDtlsTransport = function getRTCDtlsTransport() {
    const sender = this.version && this.version.pc && typeof this.version.pc.getSenders === "function" && this.version.pc.getSenders()[0];
    return sender && sender.transport || null;
  };
  PeerConnection.prototype._canStopMediaStreamTrack = () => typeof MediaStreamTrack.prototype.stop === "function";
  PeerConnection.prototype._getAudioTracks = (stream) => typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : stream.audioTracks;
  PeerConnection.prototype._getRTCIceTransport = function _getRTCIceTransport() {
    const dtlsTransport = this.getRTCDtlsTransport();
    return dtlsTransport && dtlsTransport.iceTransport || null;
  };
  PeerConnection.protocol = (() => RTCPC.test() ? new RTCPC() : null)();
  PeerConnection.prototype._handleAudioProcessorEvent = function(isRemote, isAddProcessor) {
    if (!isRemote || !this._remoteStream) {
      return;
    }
    let audio = null;
    if (this._masterAudio) {
      this._log.info("Setting audio source for master audio.");
      audio = this._masterAudio;
    } else {
      this._log.info("No master audio. Setting audio source for default audio output.");
      audio = this.outputs.get("default").audio;
    }
    setAudioSource(audio, this._remoteStream, this._audioHelper).then(() => {
      const successLog = isAddProcessor ? "Successfully updated audio source with processed stream" : "Successfully reverted audio source to original stream";
      this._log.info(successLog);
      if (audio.paused) {
        this._log.info("Resuming audio playback");
        audio.play();
      }
    }).catch(() => {
      const errorLog = isAddProcessor ? "Failed to update audio source" : "Failed to revert audio source";
      this._log.error(errorLog);
    });
  };
  function addStream(pc, stream) {
    if (typeof pc.addTrack === "function") {
      stream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    } else {
      pc.addStream(stream);
    }
  }
  function cloneStream(oldStream, _MediaStream) {
    let newStream;
    if (_MediaStream) {
      newStream = new _MediaStream();
    } else if (typeof MediaStream !== "undefined") {
      newStream = new MediaStream();
    } else {
      newStream = new webkitMediaStream();
    }
    oldStream.getAudioTracks().forEach(newStream.addTrack, newStream);
    return newStream;
  }
  function setAudioSource(audio, stream, audioHelper) {
    return audioHelper._maybeCreateRemoteProcessedStream(stream).then((maybeProcessedStream) => {
      if (typeof audio.srcObject !== "undefined") {
        audio.srcObject = maybeProcessedStream;
      } else if (typeof audio.mozSrcObject !== "undefined") {
        audio.mozSrcObject = maybeProcessedStream;
      } else if (typeof audio.src !== "undefined") {
        const _window = audio.options.window || window;
        audio.src = (_window.URL || _window.webkitURL).createObjectURL(maybeProcessedStream);
      } else {
        return Promise.reject();
      }
      return Promise.resolve();
    });
  }
  PeerConnection.enabled = RTCPC.test();

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/index.js
  function enabled() {
    return RTCPC.test();
  }
  function getMediaEngine() {
    return typeof RTCIceGatherer !== "undefined" ? "ORTC" : "WebRTC";
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/getusermedia.js
  function getUserMedia(constraints, options) {
    options = options || {};
    options.util = options.util || util_exports;
    options.navigator = options.navigator || (typeof navigator !== "undefined" ? navigator : null);
    return new Promise((resolve, reject) => {
      if (!options.navigator) {
        throw new NotSupportedError("getUserMedia is not supported");
      }
      switch ("function") {
        case typeof (options.navigator.mediaDevices && options.navigator.mediaDevices.getUserMedia):
          return resolve(options.navigator.mediaDevices.getUserMedia(constraints));
        case typeof options.navigator.webkitGetUserMedia:
          return options.navigator.webkitGetUserMedia(constraints, resolve, reject);
        case typeof options.navigator.mozGetUserMedia:
          return options.navigator.mozGetUserMedia(constraints, resolve, reject);
        case typeof options.navigator.getUserMedia:
          return options.navigator.getUserMedia(constraints, resolve, reject);
        default:
          throw new NotSupportedError("getUserMedia is not supported");
      }
    }).catch((e) => {
      throw options.util.isFirefox() && e.name === "NotReadableError" ? new NotSupportedError("Firefox does not currently support opening multiple audio input trackssimultaneously, even across different tabs.\nRelated Bugzilla thread: https://bugzilla.mozilla.org/show_bug.cgi?id=1299324") : e;
    });
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/sid.js
  function generateRandomizedString() {
    if (typeof window !== "object") {
      throw new NotSupportedError("This platform is not supported.");
    }
    const { crypto } = window;
    if (typeof crypto !== "object") {
      throw new NotSupportedError("The `crypto` module is not available on this platform.");
    }
    if (typeof crypto.getRandomValues !== "function") {
      throw new NotSupportedError("The function `crypto.getRandomValues` is not available on this platform.");
    }
    if (typeof window.Uint8Array !== "function") {
      throw new NotSupportedError("The `Uint8Array` module is not available on this platform.");
    }
    return crypto.getRandomValues(new window.Uint8Array(16)).reduce((r, n) => `${r}${n.toString(16).padStart(2, "0")}`, "");
  }
  function generateVoiceEventSid() {
    return `KX${generateRandomizedString()}`;
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/deferred.js
  var Deferred = class {
    /**
     * @constructor
     */
    constructor() {
      this._promise = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });
    }
    /**
     * @returns The {@link Deferred} Promise
     */
    get promise() {
      return this._promise;
    }
    /**
     * Rejects this promise
     */
    reject(reason) {
      this._reject(reason);
    }
    /**
     * Resolves this promise
     */
    resolve(value) {
      this._resolve(value);
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/asyncQueue.js
  var AsyncQueue = class {
    constructor() {
      this._operations = [];
    }
    /**
     * Adds the async operation to the queue
     * @param callback An async callback that returns a promise
     * @returns A promise that will get resolved or rejected after executing the callback
     */
    enqueue(callback) {
      const hasPending = !!this._operations.length;
      const deferred = new Deferred();
      this._operations.push({ deferred, callback });
      if (!hasPending) {
        this._processQueue();
      }
      return deferred.promise;
    }
    /**
     * Start processing the queue. This executes the first item and removes it after.
     * Then do the same for next items until the queue is emptied.
     */
    _processQueue() {
      return __awaiter(this, void 0, void 0, function* () {
        while (this._operations.length) {
          const { deferred, callback } = this._operations[0];
          let result;
          let error2;
          let hasResolved;
          try {
            result = yield callback();
            hasResolved = true;
          } catch (e) {
            error2 = e;
          }
          this._operations.shift();
          if (hasResolved) {
            deferred.resolve(result);
          } else {
            deferred.reject(error2);
          }
        }
      });
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/audioplayer/deferred.js
  var Deferred2 = class {
    get reject() {
      return this._reject;
    }
    get resolve() {
      return this._resolve;
    }
    constructor() {
      this.promise = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/audioplayer/eventtarget.js
  var import_events8 = __toESM(require_events());
  var EventTarget = class {
    constructor() {
      this._eventEmitter = new import_events8.EventEmitter();
    }
    addEventListener(name, handler) {
      return this._eventEmitter.addListener(name, handler);
    }
    dispatchEvent(name, ...args) {
      return this._eventEmitter.emit(name, ...args);
    }
    removeEventListener(name, handler) {
      return this._eventEmitter.removeListener(name, handler);
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/audioplayer/audioplayer.js
  var AudioPlayer = class extends EventTarget {
    get destination() {
      return this._destination;
    }
    get loop() {
      return this._loop;
    }
    set loop(shouldLoop) {
      const self = this;
      function pauseAfterPlaythrough() {
        self._audioNode.removeEventListener("ended", pauseAfterPlaythrough);
        self.pause();
      }
      if (!shouldLoop && this.loop && !this.paused) {
        this._audioNode.addEventListener("ended", pauseAfterPlaythrough);
      }
      this._loop = shouldLoop;
    }
    /**
     * Whether the audio element is muted.
     */
    get muted() {
      return this._gainNode.gain.value === 0;
    }
    set muted(shouldBeMuted) {
      this._gainNode.gain.value = shouldBeMuted ? 0 : 1;
    }
    /**
     * Whether the sound is paused. this._audioNode only exists when sound is playing;
     *   otherwise AudioPlayer is considered paused.
     */
    get paused() {
      return this._audioNode === null;
    }
    get src() {
      return this._src;
    }
    set src(src) {
      this._load(src);
    }
    /**
     * The srcObject of the HTMLMediaElement
     */
    get srcObject() {
      return this._audioElement.srcObject;
    }
    set srcObject(srcObject) {
      this._audioElement.srcObject = srcObject;
    }
    get sinkId() {
      return this._sinkId;
    }
    /**
     * @private
     */
    constructor(audioContext, srcOrOptions = {}, options = {}) {
      super();
      this._audioNode = null;
      this._loop = false;
      this._pendingPlayDeferreds = [];
      this._sinkId = "default";
      this._src = "";
      if (typeof srcOrOptions !== "string") {
        options = srcOrOptions;
      }
      this._audioContext = audioContext;
      this._audioElement = new (options.AudioFactory || Audio)();
      this._bufferPromise = this._createPlayDeferred().promise;
      this._destination = this._audioContext.destination;
      this._gainNode = this._audioContext.createGain();
      this._gainNode.connect(this._destination);
      this._XMLHttpRequest = options.XMLHttpRequestFactory || XMLHttpRequest;
      this.addEventListener("canplaythrough", () => {
        this._resolvePlayDeferreds();
      });
      if (typeof srcOrOptions === "string") {
        this.src = srcOrOptions;
      }
    }
    /**
     * Stop any ongoing playback and reload the source file.
     */
    load() {
      this._load(this._src);
    }
    /**
     * Pause the audio coming from this AudioPlayer. This will reject any pending
     *   play Promises.
     */
    pause() {
      if (this.paused) {
        return;
      }
      this._audioElement.pause();
      this._audioNode.stop();
      this._audioNode.disconnect(this._gainNode);
      this._audioNode = null;
      this._rejectPlayDeferreds(new Error("The play() request was interrupted by a call to pause()."));
    }
    /**
     * Play the sound. If the buffer hasn't loaded yet, wait for the buffer to load. If
     *   the source URL is not set yet, this Promise will remain pending until a source
     *   URL is set.
     */
    play() {
      return __awaiter(this, void 0, void 0, function* () {
        if (!this.paused) {
          yield this._bufferPromise;
          if (!this.paused) {
            return;
          }
          throw new Error("The play() request was interrupted by a call to pause().");
        }
        this._audioNode = this._audioContext.createBufferSource();
        this._audioNode.loop = this.loop;
        this._audioNode.addEventListener("ended", () => {
          if (this._audioNode && this._audioNode.loop) {
            return;
          }
          this.dispatchEvent("ended");
        });
        const buffer = yield this._bufferPromise;
        if (this.paused) {
          throw new Error("The play() request was interrupted by a call to pause().");
        }
        this._audioNode.buffer = buffer;
        this._audioNode.connect(this._gainNode);
        this._audioNode.start();
        if (this._audioElement.srcObject) {
          return this._audioElement.play();
        }
      });
    }
    /**
     * Change which device the sound should play through.
     * @param sinkId - The sink of the device to play sound through.
     */
    setSinkId(sinkId) {
      return __awaiter(this, void 0, void 0, function* () {
        if (typeof this._audioElement.setSinkId !== "function") {
          throw new Error("This browser does not support setSinkId.");
        }
        if (sinkId === this.sinkId) {
          return;
        }
        if (sinkId === "default") {
          if (!this.paused) {
            this._gainNode.disconnect(this._destination);
          }
          this._audioElement.srcObject = null;
          this._destination = this._audioContext.destination;
          this._gainNode.connect(this._destination);
          this._sinkId = sinkId;
          return;
        }
        yield this._audioElement.setSinkId(sinkId);
        if (this._audioElement.srcObject) {
          return;
        }
        this._gainNode.disconnect(this._audioContext.destination);
        this._destination = this._audioContext.createMediaStreamDestination();
        this._audioElement.srcObject = this._destination.stream;
        this._sinkId = sinkId;
        this._gainNode.connect(this._destination);
      });
    }
    /**
     * Create a Deferred for a Promise that will be resolved when .src is set or rejected
     *   when .pause is called.
     */
    _createPlayDeferred() {
      const deferred = new Deferred2();
      this._pendingPlayDeferreds.push(deferred);
      return deferred;
    }
    /**
     * Stop current playback and load a sound file.
     * @param src - The source URL of the file to load
     */
    _load(src) {
      if (this._src && this._src !== src) {
        this.pause();
      }
      this._src = src;
      this._bufferPromise = new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
        if (!src) {
          return this._createPlayDeferred().promise;
        }
        const buffer = yield bufferSound(this._audioContext, this._XMLHttpRequest, src);
        this.dispatchEvent("canplaythrough");
        resolve(buffer);
      }));
    }
    /**
     * Reject all deferreds for the Play promise.
     * @param reason
     */
    _rejectPlayDeferreds(reason) {
      const deferreds = this._pendingPlayDeferreds;
      deferreds.splice(0, deferreds.length).forEach(({ reject }) => reject(reason));
    }
    /**
     * Resolve all deferreds for the Play promise.
     * @param result
     */
    _resolvePlayDeferreds(result) {
      const deferreds = this._pendingPlayDeferreds;
      deferreds.splice(0, deferreds.length).forEach(({ resolve }) => resolve(result));
    }
  };
  function bufferSound(context, RequestFactory, src) {
    return __awaiter(this, void 0, void 0, function* () {
      const request2 = new RequestFactory();
      request2.open("GET", src, true);
      request2.responseType = "arraybuffer";
      const event = yield new Promise((resolve) => {
        request2.addEventListener("load", resolve);
        request2.send();
      });
      try {
        return context.decodeAudioData(event.target.response);
      } catch (e) {
        return new Promise((resolve) => {
          context.decodeAudioData(event.target.response, resolve);
        });
      }
    });
  }

  // node_modules/@twilio/voice-sdk/esm/twilio/sound.js
  function Sound(name, url, options) {
    if (!(this instanceof Sound)) {
      return new Sound(name, url, options);
    }
    if (!name || !url) {
      throw new InvalidArgumentError("name and url are required arguments");
    }
    options = Object.assign({
      AudioFactory: typeof Audio !== "undefined" ? Audio : null,
      maxDuration: 0,
      shouldLoop: false
    }, options);
    options.AudioPlayer = options.audioContext ? AudioPlayer.bind(AudioPlayer, options.audioContext) : options.AudioFactory;
    Object.defineProperties(this, {
      _Audio: { value: options.AudioPlayer },
      _activeEls: { value: /* @__PURE__ */ new Map() },
      _isSinkSupported: {
        value: options.AudioFactory !== null && typeof options.AudioFactory.prototype.setSinkId === "function"
      },
      _maxDuration: { value: options.maxDuration },
      _maxDurationTimeout: {
        value: null,
        writable: true
      },
      _operations: { value: new AsyncQueue() },
      _playPromise: {
        value: null,
        writable: true
      },
      _shouldLoop: { value: options.shouldLoop },
      _sinkIds: { value: ["default"] },
      isPlaying: {
        enumerable: true,
        get() {
          return !!this._playPromise;
        }
      },
      name: {
        enumerable: true,
        value: name
      },
      url: {
        enumerable: true,
        value: url
      }
    });
    if (this._Audio) {
      this._play(true, false);
    }
  }
  function destroyAudioElement(audioElement) {
    if (audioElement) {
      audioElement.pause();
      audioElement.src = "";
      audioElement.srcObject = null;
      audioElement.load();
    }
  }
  Sound.prototype._playAudioElement = function _playAudioElement(sinkId, isMuted, shouldLoop) {
    const audioElement = this._activeEls.get(sinkId);
    if (!audioElement) {
      throw new InvalidArgumentError(`sinkId: "${sinkId}" doesn't have an audio element`);
    }
    audioElement.muted = !!isMuted;
    audioElement.loop = !!shouldLoop;
    return audioElement.play().then(() => audioElement).catch((reason) => {
      destroyAudioElement(audioElement);
      this._activeEls.delete(sinkId);
      throw reason;
    });
  };
  Sound.prototype._play = function _play(forceIsMuted, forceShouldLoop) {
    if (this.isPlaying) {
      this._stop();
    }
    if (this._maxDuration > 0) {
      this._maxDurationTimeout = setTimeout(this._stop.bind(this), this._maxDuration);
    }
    forceShouldLoop = typeof forceShouldLoop === "boolean" ? forceShouldLoop : this._shouldLoop;
    const self = this;
    const playPromise = this._playPromise = Promise.all(this._sinkIds.map(function createAudioElement(sinkId) {
      if (!self._Audio) {
        return Promise.resolve();
      }
      let audioElement = self._activeEls.get(sinkId);
      if (audioElement) {
        return self._playAudioElement(sinkId, forceIsMuted, forceShouldLoop);
      }
      audioElement = new self._Audio(self.url);
      if (typeof audioElement.setAttribute === "function") {
        audioElement.setAttribute("crossorigin", "anonymous");
      }
      return new Promise((resolve) => {
        audioElement.addEventListener("canplaythrough", resolve);
      }).then(() => {
        return (self._isSinkSupported ? audioElement.setSinkId(sinkId) : Promise.resolve()).then(function setSinkIdSuccess() {
          self._activeEls.set(sinkId, audioElement);
          if (!self._playPromise) {
            return Promise.resolve();
          }
          return self._playAudioElement(sinkId, forceIsMuted, forceShouldLoop);
        });
      });
    }));
    return playPromise;
  };
  Sound.prototype._stop = function _stop() {
    this._activeEls.forEach((audioEl, sinkId) => {
      if (this._sinkIds.includes(sinkId)) {
        audioEl.pause();
        audioEl.currentTime = 0;
      } else {
        destroyAudioElement(audioEl);
        this._activeEls.delete(sinkId);
      }
    });
    clearTimeout(this._maxDurationTimeout);
    this._playPromise = null;
    this._maxDurationTimeout = null;
  };
  Sound.prototype.setSinkIds = function setSinkIds(ids) {
    if (!this._isSinkSupported) {
      return;
    }
    ids = ids.forEach ? ids : [ids];
    [].splice.apply(this._sinkIds, [0, this._sinkIds.length].concat(ids));
  };
  Sound.prototype.stop = function stop() {
    this._operations.enqueue(() => {
      this._stop();
      return Promise.resolve();
    });
  };
  Sound.prototype.play = function play() {
    return this._operations.enqueue(() => this._play());
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/device.js
  var REGISTRATION_INTERVAL = 3e4;
  var RINGTONE_PLAY_TIMEOUT = 2e3;
  var PUBLISHER_PRODUCT_NAME = "twilio-js-sdk";
  var INVALID_TOKEN_MESSAGE = 'Parameter "token" must be of type "string".';
  var Device = class _Device extends import_events9.EventEmitter {
    /**
     * The AudioContext to be used by {@link Device} instances.
     * @private
     */
    static get audioContext() {
      return _Device._audioContext;
    }
    /**
     * Which sound file extension is supported.
     * @private
     */
    static get extension() {
      const a = typeof document !== "undefined" ? document.createElement("audio") : { canPlayType: false };
      let canPlayMp3;
      try {
        canPlayMp3 = a.canPlayType && !!a.canPlayType("audio/mpeg").replace(/no/, "");
      } catch (e) {
        canPlayMp3 = false;
      }
      let canPlayVorbis;
      try {
        canPlayVorbis = a.canPlayType && !!a.canPlayType("audio/ogg;codecs='vorbis'").replace(/no/, "");
      } catch (e) {
        canPlayVorbis = false;
      }
      return canPlayVorbis && !canPlayMp3 ? "ogg" : "mp3";
    }
    /**
     * Whether or not this SDK is supported by the current browser.
     */
    static get isSupported() {
      return enabled();
    }
    /**
     * Package name of the SDK.
     */
    static get packageName() {
      return PACKAGE_NAME;
    }
    /**
     * Run some tests to identify issues, if any, prohibiting successful calling.
     * @param token - A Twilio JWT token string
     * @param options
     */
    static runPreflight(token, options) {
      return new PreflightTest(token, Object.assign({ audioContext: _Device._getOrCreateAudioContext() }, options));
    }
    /**
     * String representation of {@link Device} class.
     * @private
     */
    static toString() {
      return "[Twilio.Device class]";
    }
    /**
     * Current SDK version.
     */
    static get version() {
      return RELEASE_VERSION;
    }
    /**
     * Initializes the AudioContext instance shared across the Voice SDK,
     * or returns the existing instance if one has already been initialized.
     */
    static _getOrCreateAudioContext() {
      if (!_Device._audioContext) {
        if (typeof AudioContext !== "undefined") {
          _Device._audioContext = new AudioContext();
        } else if (typeof webkitAudioContext !== "undefined") {
          _Device._audioContext = new webkitAudioContext();
        }
      }
      return _Device._audioContext;
    }
    /**
     * Construct a {@link Device} instance. The {@link Device} can be registered
     * to make and listen for calls using {@link Device.register}.
     * @param options
     */
    constructor(token, options = {}) {
      super();
      this._activeCall = null;
      this._audio = null;
      this._audioProcessorEventObserver = null;
      this._callInputStream = null;
      this._calls = [];
      this._callSinkIds = ["default"];
      this._chunderURIs = [];
      this._defaultOptions = {
        allowIncomingWhileBusy: false,
        closeProtection: false,
        codecPreferences: [Call.Codec.PCMU, Call.Codec.Opus],
        dscp: true,
        enableImprovedSignalingErrorPrecision: false,
        forceAggressiveIceNomination: false,
        logLevel: loglevel2.levels.ERROR,
        maxCallSignalingTimeoutMs: 0,
        preflight: false,
        sounds: {},
        tokenRefreshMs: 1e4,
        voiceEventSidGenerator: generateVoiceEventSid
      };
      this._edge = null;
      this._home = null;
      this._identity = null;
      this._log = new Log("Device");
      this._makeCallPromise = null;
      this._options = {};
      this._preferredURI = null;
      this._publisher = null;
      this._region = null;
      this._regTimer = null;
      this._shouldReRegister = false;
      this._soundcache = /* @__PURE__ */ new Map();
      this._state = _Device.State.Unregistered;
      this._stateEventMapping = {
        [_Device.State.Destroyed]: _Device.EventName.Destroyed,
        [_Device.State.Unregistered]: _Device.EventName.Unregistered,
        [_Device.State.Registering]: _Device.EventName.Registering,
        [_Device.State.Registered]: _Device.EventName.Registered
      };
      this._stream = null;
      this._streamConnectedPromise = null;
      this._tokenWillExpireTimeout = null;
      this._createDefaultPayload = (call) => {
        const payload = {
          aggressive_nomination: this._options.forceAggressiveIceNomination,
          browser_extension: this._isBrowserExtension,
          dscp: !!this._options.dscp,
          ice_restart_enabled: true,
          platform: getMediaEngine(),
          sdk_version: RELEASE_VERSION
        };
        function setIfDefined(propertyName, value) {
          if (value) {
            payload[propertyName] = value;
          }
        }
        if (call) {
          const callSid = call.parameters.CallSid;
          setIfDefined("call_sid", /^TJ/.test(callSid) ? void 0 : callSid);
          setIfDefined("temp_call_sid", call.outboundConnectionId);
          setIfDefined("audio_codec", call.codec);
          payload.direction = call.direction;
        }
        setIfDefined("gateway", this._stream && this._stream.gateway);
        setIfDefined("region", this._stream && this._stream.region);
        return payload;
      };
      this._onSignalingClose = () => {
        this._stream = null;
        this._streamConnectedPromise = null;
      };
      this._onSignalingConnected = (payload) => {
        var _a;
        const region = getRegionShortcode(payload.region);
        this._edge = payload.edge || regionToEdge[region] || payload.region;
        this._region = region || payload.region;
        this._home = payload.home;
        (_a = this._publisher) === null || _a === void 0 ? void 0 : _a.setHost(createEventGatewayURI(payload.home));
        if (payload.token) {
          this._identity = payload.token.identity;
          if (typeof payload.token.ttl === "number" && typeof this._options.tokenRefreshMs === "number") {
            const ttlMs = payload.token.ttl * 1e3;
            const timeoutMs = Math.max(0, ttlMs - this._options.tokenRefreshMs);
            this._tokenWillExpireTimeout = setTimeout(() => {
              this._log.debug("#tokenWillExpire");
              this.emit("tokenWillExpire", this);
              if (this._tokenWillExpireTimeout) {
                clearTimeout(this._tokenWillExpireTimeout);
                this._tokenWillExpireTimeout = null;
              }
            }, timeoutMs);
          }
        }
        const preferredURIs = this._getChunderws() || getChunderURIs(this._edge);
        if (preferredURIs.length > 0) {
          const [preferredURI] = preferredURIs;
          this._preferredURI = createSignalingEndpointURL(preferredURI);
        } else {
          this._log.warn("Could not parse a preferred URI from the stream#connected event.");
        }
        if (this._shouldReRegister) {
          this.register();
        }
      };
      this._onSignalingError = (payload) => {
        if (typeof payload !== "object") {
          this._log.warn("Invalid signaling error payload", payload);
          return;
        }
        const { error: originalError, callsid, voiceeventsid } = payload;
        if (typeof originalError !== "object" || !!voiceeventsid) {
          this._log.warn("Ignoring signaling error payload", { originalError, voiceeventsid });
          return;
        }
        const call = typeof callsid === "string" && this._findCall(callsid) || void 0;
        const { code, message: customMessage } = originalError;
        let { twilioError } = originalError;
        if (typeof code === "number") {
          if (code === 31201) {
            twilioError = new AuthorizationErrors.AuthenticationFailed(originalError);
          } else if (code === 31204) {
            twilioError = new AuthorizationErrors.AccessTokenInvalid(originalError);
          } else if (code === 31205) {
            this._stopRegistrationTimer();
            twilioError = new AuthorizationErrors.AccessTokenExpired(originalError);
          } else {
            const errorConstructor = getPreciseSignalingErrorByCode(!!this._options.enableImprovedSignalingErrorPrecision, code);
            if (typeof errorConstructor !== "undefined") {
              twilioError = new errorConstructor(originalError);
            }
          }
        }
        if (!twilioError) {
          this._log.error("Unknown signaling error: ", originalError);
          twilioError = new GeneralErrors.UnknownError(customMessage, originalError);
        }
        this._log.error("Received error: ", twilioError);
        this._log.debug("#error", originalError);
        this.emit(_Device.EventName.Error, twilioError, call);
      };
      this._onSignalingInvite = (payload) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const wasBusy = !!this._activeCall;
        if (wasBusy && !this._options.allowIncomingWhileBusy) {
          this._log.info("Device busy; ignoring incoming invite");
          return;
        }
        if (!payload.callsid || !payload.sdp) {
          this._log.debug("#error", payload);
          this.emit(_Device.EventName.Error, new ClientErrors.BadRequest("Malformed invite from gateway"));
          return;
        }
        const callParameters = payload.parameters || {};
        callParameters.CallSid = callParameters.CallSid || payload.callsid;
        const customParameters = Object.assign({}, queryToJson(callParameters.Params));
        this._makeCallPromise = this._makeCall(customParameters, {
          callParameters,
          enableImprovedSignalingErrorPrecision: !!this._options.enableImprovedSignalingErrorPrecision,
          offerSdp: payload.sdp,
          reconnectToken: payload.reconnect,
          voiceEventSidGenerator: this._options.voiceEventSidGenerator
        });
        let call;
        try {
          call = yield this._makeCallPromise;
        } finally {
          this._makeCallPromise = null;
        }
        this._calls.push(call);
        call.once("accept", () => {
          this._soundcache.get(_Device.SoundName.Incoming).stop();
          this._publishNetworkChange();
        });
        const play2 = ((_a = this._audio) === null || _a === void 0 ? void 0 : _a.incoming()) && !wasBusy ? () => this._soundcache.get(_Device.SoundName.Incoming).play() : () => Promise.resolve();
        this._showIncomingCall(call, play2);
      });
      this._onSignalingOffline = () => {
        this._log.info("Stream is offline");
        this._edge = null;
        this._region = null;
        this._shouldReRegister = this.state !== _Device.State.Unregistered;
        this._setState(_Device.State.Unregistered);
      };
      this._onSignalingReady = () => {
        this._log.info("Stream is ready");
        this._setState(_Device.State.Registered);
      };
      this._publishNetworkChange = () => {
        if (!this._activeCall) {
          return;
        }
        if (this._networkInformation) {
          this._publisher.info("network-information", "network-change", {
            connection_type: this._networkInformation.type,
            downlink: this._networkInformation.downlink,
            downlinkMax: this._networkInformation.downlinkMax,
            effective_type: this._networkInformation.effectiveType,
            rtt: this._networkInformation.rtt
          }, this._activeCall);
        }
      };
      this._updateInputStream = (inputStream) => {
        const call = this._activeCall;
        if (call && !inputStream) {
          return Promise.reject(new InvalidStateError("Cannot unset input device while a call is in progress."));
        }
        this._callInputStream = inputStream;
        return call ? call._setInputTracksFromStream(inputStream) : Promise.resolve();
      };
      this._updateSinkIds = (type, sinkIds) => {
        const promise = type === "ringtone" ? this._updateRingtoneSinkIds(sinkIds) : this._updateSpeakerSinkIds(sinkIds);
        return promise.then(() => {
          this._publisher.info("audio", `${type}-devices-set`, {
            audio_device_ids: sinkIds
          }, this._activeCall);
        }, (error2) => {
          this._publisher.error("audio", `${type}-devices-set-failed`, {
            audio_device_ids: sinkIds,
            message: error2.message
          }, this._activeCall);
          throw error2;
        });
      };
      this._setupLoglevel(options.logLevel);
      this._logOptions("constructor", options);
      this.updateToken(token);
      if (isLegacyEdge()) {
        throw new NotSupportedError("Microsoft Edge Legacy (https://support.microsoft.com/en-us/help/4533505/what-is-microsoft-edge-legacy) is deprecated and will not be able to connect to Twilio to make or receive calls after September 1st, 2020. Please see this documentation for a list of supported browsers https://www.twilio.com/docs/voice/client/javascript#supported-browsers");
      }
      if (!_Device.isSupported && options.ignoreBrowserSupport) {
        if (window && window.location && window.location.protocol === "http:") {
          throw new NotSupportedError(`twilio.js wasn't able to find WebRTC browser support.           This is most likely because this page is served over http rather than https,           which does not support WebRTC in many browsers. Please load this page over https and           try again.`);
        }
        throw new NotSupportedError(`twilio.js 1.3+ SDKs require WebRTC browser support.         For more information, see <https://www.twilio.com/docs/api/client/twilio-js>.         If you have any questions about this announcement, please contact         Twilio Support at <help@twilio.com>.`);
      }
      const root = globalThis;
      const browser = root.msBrowser || root.browser || root.chrome;
      this._isBrowserExtension = !!browser && !!browser.runtime && !!browser.runtime.id || !!root.safari && !!root.safari.extension;
      if (this._isBrowserExtension) {
        this._log.info("Running as browser extension.");
      }
      if (navigator) {
        const n = navigator;
        this._networkInformation = n.connection || n.mozConnection || n.webkitConnection;
      }
      if (this._networkInformation && typeof this._networkInformation.addEventListener === "function") {
        this._networkInformation.addEventListener("change", this._publishNetworkChange);
      }
      _Device._getOrCreateAudioContext();
      if (_Device._audioContext) {
        if (!_Device._dialtonePlayer) {
          _Device._dialtonePlayer = new DialtonePlayer(_Device._audioContext);
        }
      }
      this._boundDestroy = this.destroy.bind(this);
      this._boundConfirmClose = this._confirmClose.bind(this);
      if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("unload", this._boundDestroy);
        window.addEventListener("pagehide", this._boundDestroy);
      }
      this.updateOptions(options);
    }
    /**
     * Return the {@link AudioHelper} used by this {@link Device}.
     */
    get audio() {
      return this._audio;
    }
    /**
     * Make an outgoing Call.
     * @param options
     */
    connect() {
      return __awaiter(this, arguments, void 0, function* (options = {}) {
        this._log.debug(".connect", JSON.stringify(options));
        this._throwIfDestroyed();
        if (this._activeCall) {
          throw new InvalidStateError("A Call is already active");
        }
        let customParameters;
        let parameters;
        let signalingReconnectToken;
        if (options.connectToken) {
          try {
            const connectTokenParts = JSON.parse(decodeURIComponent(atob(options.connectToken)));
            customParameters = connectTokenParts.customParameters;
            parameters = connectTokenParts.parameters;
            signalingReconnectToken = connectTokenParts.signalingReconnectToken;
          } catch (_a) {
            throw new InvalidArgumentError("Cannot parse connectToken");
          }
          if (!parameters || !parameters.CallSid || !signalingReconnectToken) {
            throw new InvalidArgumentError("Invalid connectToken");
          }
        }
        let isReconnect = false;
        let twimlParams = {};
        const callOptions = {
          enableImprovedSignalingErrorPrecision: !!this._options.enableImprovedSignalingErrorPrecision,
          rtcConfiguration: options.rtcConfiguration,
          voiceEventSidGenerator: this._options.voiceEventSidGenerator
        };
        if (signalingReconnectToken && parameters) {
          isReconnect = true;
          callOptions.callParameters = parameters;
          callOptions.reconnectCallSid = parameters.CallSid;
          callOptions.reconnectToken = signalingReconnectToken;
          twimlParams = customParameters || twimlParams;
        } else {
          twimlParams = options.params || twimlParams;
        }
        let activeCall2;
        this._makeCallPromise = this._makeCall(twimlParams, callOptions, isReconnect);
        try {
          activeCall2 = this._activeCall = yield this._makeCallPromise;
        } finally {
          this._makeCallPromise = null;
        }
        this._calls.splice(0).forEach((call) => call.ignore());
        this._soundcache.get(_Device.SoundName.Incoming).stop();
        activeCall2.accept({ rtcConstraints: options.rtcConstraints });
        this._publishNetworkChange();
        return activeCall2;
      });
    }
    /**
     * Return the calls that this {@link Device} is maintaining.
     */
    get calls() {
      return this._calls;
    }
    /**
     * Destroy the {@link Device}, freeing references to be garbage collected.
     */
    destroy() {
      var _a;
      this._log.debug(".destroy");
      this._log.debug("Rejecting any incoming calls");
      const calls = this._calls.slice(0);
      calls.forEach((call) => call.reject());
      this.disconnectAll();
      this._stopRegistrationTimer();
      this._destroyStream();
      this._destroyAudioHelper();
      (_a = this._audioProcessorEventObserver) === null || _a === void 0 ? void 0 : _a.destroy();
      this._destroyPublisher();
      if (this._networkInformation && typeof this._networkInformation.removeEventListener === "function") {
        this._networkInformation.removeEventListener("change", this._publishNetworkChange);
      }
      if (typeof window !== "undefined" && window.removeEventListener) {
        window.removeEventListener("beforeunload", this._boundConfirmClose);
        window.removeEventListener("unload", this._boundDestroy);
        window.removeEventListener("pagehide", this._boundDestroy);
      }
      this._setState(_Device.State.Destroyed);
      import_events9.EventEmitter.prototype.removeAllListeners.call(this);
    }
    /**
     * Disconnect all {@link Call}s.
     */
    disconnectAll() {
      this._log.debug(".disconnectAll");
      const calls = this._calls.splice(0);
      calls.forEach((call) => call.disconnect());
      if (this._activeCall) {
        this._activeCall.disconnect();
      }
    }
    /**
     * Returns the {@link Edge} value the {@link Device} is currently connected
     * to. The value will be `null` when the {@link Device} is offline.
     */
    get edge() {
      return this._edge;
    }
    /**
     * Returns the home value the {@link Device} is currently connected
     * to. The value will be `null` when the {@link Device} is offline.
     */
    get home() {
      return this._home;
    }
    /**
     * Returns the identity associated with the {@link Device} for incoming calls. Only
     * populated when registered.
     */
    get identity() {
      return this._identity;
    }
    /**
     * Whether the Device is currently on an active Call.
     */
    get isBusy() {
      return !!this._activeCall;
    }
    /**
     * Register the `Device` to the Twilio backend, allowing it to receive calls.
     */
    register() {
      return __awaiter(this, void 0, void 0, function* () {
        this._log.debug(".register");
        if (this.state !== _Device.State.Unregistered) {
          throw new InvalidStateError(`Attempt to register when device is in state "${this.state}". Must be "${_Device.State.Unregistered}".`);
        }
        this._shouldReRegister = false;
        this._setState(_Device.State.Registering);
        yield this._streamConnectedPromise || this._setupStream();
        yield this._sendPresence(true);
        yield promisifyEvents(this, _Device.State.Registered, _Device.State.Unregistered);
      });
    }
    /**
     * Get the state of this {@link Device} instance
     */
    get state() {
      return this._state;
    }
    /**
     * Get the token used by this {@link Device}.
     */
    get token() {
      return this._token;
    }
    /**
     * String representation of {@link Device} instance.
     * @private
     */
    toString() {
      return "[Twilio.Device instance]";
    }
    /**
     * Unregister the `Device` to the Twilio backend, disallowing it to receive
     * calls.
     */
    unregister() {
      return __awaiter(this, void 0, void 0, function* () {
        this._log.debug(".unregister");
        if (this.state !== _Device.State.Registered) {
          throw new InvalidStateError(`Attempt to unregister when device is in state "${this.state}". Must be "${_Device.State.Registered}".`);
        }
        this._shouldReRegister = false;
        const stream = yield this._streamConnectedPromise;
        const streamOfflinePromise = new Promise((resolve) => {
          stream.on("offline", resolve);
        });
        yield this._sendPresence(false);
        yield streamOfflinePromise;
      });
    }
    /**
     * Set the options used within the {@link Device}.
     * @param options
     */
    updateOptions(options = {}) {
      this._logOptions("updateOptions", options);
      if (this.state === _Device.State.Destroyed) {
        throw new InvalidStateError(`Attempt to "updateOptions" when device is in state "${this.state}".`);
      }
      this._options = Object.assign(Object.assign(Object.assign({}, this._defaultOptions), this._options), options);
      const originalChunderURIs = new Set(this._chunderURIs);
      const newChunderURIs = this._chunderURIs = (this._getChunderws() || getChunderURIs(this._options.edge)).map(createSignalingEndpointURL);
      let hasChunderURIsChanged = originalChunderURIs.size !== newChunderURIs.length;
      if (!hasChunderURIsChanged) {
        for (const uri of newChunderURIs) {
          if (!originalChunderURIs.has(uri)) {
            hasChunderURIsChanged = true;
            break;
          }
        }
      }
      if (this.isBusy && hasChunderURIsChanged) {
        throw new InvalidStateError("Cannot change Edge while on an active Call");
      }
      this._setupLoglevel(this._options.logLevel);
      for (const name of Object.keys(_Device._defaultSounds)) {
        const soundDef = _Device._defaultSounds[name];
        const defaultUrl = `${SOUNDS_BASE_URL}/${soundDef.filename}.${_Device.extension}?cache=${RELEASE_VERSION}`;
        const soundUrl = this._options.sounds && this._options.sounds[name] || defaultUrl;
        const sound = new (this._options.Sound || Sound)(name, soundUrl, {
          audioContext: this._options.disableAudioContextSounds ? null : _Device.audioContext,
          maxDuration: soundDef.maxDuration,
          shouldLoop: soundDef.shouldLoop
        });
        this._soundcache.set(name, sound);
      }
      this._setupAudioHelper();
      this._setupPublisher();
      if (hasChunderURIsChanged && this._streamConnectedPromise) {
        this._setupStream();
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function" && this._options.closeProtection) {
        window.removeEventListener("beforeunload", this._boundConfirmClose);
        window.addEventListener("beforeunload", this._boundConfirmClose);
      }
    }
    /**
     * Update the token used by this {@link Device} to connect to Twilio.
     * It is recommended to call this API after [[Device.tokenWillExpireEvent]] is emitted,
     * and before or after a call to prevent a potential ~1s audio loss during the update process.
     * @param token
     */
    updateToken(token) {
      this._log.debug(".updateToken");
      if (this.state === _Device.State.Destroyed) {
        throw new InvalidStateError(`Attempt to "updateToken" when device is in state "${this.state}".`);
      }
      if (typeof token !== "string") {
        throw new InvalidArgumentError(INVALID_TOKEN_MESSAGE);
      }
      this._token = token;
      if (this._stream) {
        this._stream.setToken(this._token);
      }
      if (this._publisher) {
        this._publisher.setToken(this._token);
      }
    }
    /**
     * Called on window's beforeunload event if closeProtection is enabled,
     * preventing users from accidentally navigating away from an active call.
     * @param event
     */
    _confirmClose(event) {
      if (!this._activeCall) {
        return "";
      }
      const closeProtection = this._options.closeProtection || false;
      const confirmationMsg = typeof closeProtection !== "string" ? "A call is currently in-progress. Leaving or reloading this page will end the call." : closeProtection;
      (event || window.event).returnValue = confirmationMsg;
      return confirmationMsg;
    }
    /**
     * Destroy the AudioHelper.
     */
    _destroyAudioHelper() {
      if (!this._audio) {
        return;
      }
      this._audio._destroy();
      this._audio = null;
    }
    /**
     * Destroy the publisher.
     */
    _destroyPublisher() {
      if (!this._publisher) {
        return;
      }
      this._publisher = null;
    }
    /**
     * Destroy the connection to the signaling server.
     */
    _destroyStream() {
      if (this._stream) {
        this._stream.removeListener("close", this._onSignalingClose);
        this._stream.removeListener("connected", this._onSignalingConnected);
        this._stream.removeListener("error", this._onSignalingError);
        this._stream.removeListener("invite", this._onSignalingInvite);
        this._stream.removeListener("offline", this._onSignalingOffline);
        this._stream.removeListener("ready", this._onSignalingReady);
        this._stream.destroy();
        this._stream = null;
      }
      this._onSignalingOffline();
      this._streamConnectedPromise = null;
    }
    /**
     * Find a {@link Call} by its CallSid.
     * @param callSid
     */
    _findCall(callSid) {
      return this._calls.find((call) => call.parameters.CallSid === callSid || call.outboundConnectionId === callSid) || null;
    }
    /**
     * Get chunderws array from the chunderw param
     */
    _getChunderws() {
      return typeof this._options.chunderw === "string" ? [this._options.chunderw] : Array.isArray(this._options.chunderw) ? this._options.chunderw : null;
    }
    /**
     * Utility function to log device options
     */
    _logOptions(caller, options = {}) {
      const userOptions = [
        "allowIncomingWhileBusy",
        "appName",
        "appVersion",
        "closeProtection",
        "codecPreferences",
        "disableAudioContextSounds",
        "dscp",
        "edge",
        "enableImprovedSignalingErrorPrecision",
        "forceAggressiveIceNomination",
        "logLevel",
        "maxAverageBitrate",
        "maxCallSignalingTimeoutMs",
        "sounds",
        "tokenRefreshMs"
      ];
      const userOptionOverrides = [
        "RTCPeerConnection",
        "enumerateDevices",
        "getUserMedia",
        "MediaStream"
      ];
      if (typeof options === "object") {
        const toLog = Object.assign({}, options);
        Object.keys(toLog).forEach((key) => {
          if (!userOptions.includes(key) && !userOptionOverrides.includes(key)) {
            delete toLog[key];
          }
          if (userOptionOverrides.includes(key)) {
            toLog[key] = true;
          }
        });
        this._log.debug(`.${caller}`, JSON.stringify(toLog));
      }
    }
    /**
     * Create a new {@link Call}.
     * @param twimlParams - A flat object containing key:value pairs to be sent to the TwiML app.
     * @param options - Options to be used to instantiate the {@link Call}.
     */
    _makeCall(twimlParams_1, options_1) {
      return __awaiter(this, arguments, void 0, function* (twimlParams, options, isReconnect = false) {
        var _a;
        const inputDevicePromise = (_a = this._audio) === null || _a === void 0 ? void 0 : _a._getInputDevicePromise();
        if (inputDevicePromise) {
          this._log.debug("inputDevicePromise detected, waiting...");
          yield inputDevicePromise;
          this._log.debug("inputDevicePromise resolved");
        }
        const config = {
          audioHelper: this._audio,
          onIgnore: () => {
            this._soundcache.get(_Device.SoundName.Incoming).stop();
          },
          pstream: yield this._streamConnectedPromise || this._setupStream(),
          publisher: this._publisher,
          soundcache: this._soundcache
        };
        options = Object.assign({
          MediaStream: this._options.MediaStream,
          RTCPeerConnection: this._options.RTCPeerConnection,
          beforeAccept: (currentCall) => {
            if (!this._activeCall || this._activeCall === currentCall) {
              return;
            }
            this._activeCall.disconnect();
            this._removeCall(this._activeCall);
          },
          codecPreferences: this._options.codecPreferences,
          customSounds: this._options.sounds,
          dialtonePlayer: _Device._dialtonePlayer,
          dscp: this._options.dscp,
          // TODO(csantos): Remove forceAggressiveIceNomination option in 3.x
          forceAggressiveIceNomination: this._options.forceAggressiveIceNomination,
          getInputStream: () => this._options.fileInputStream || this._callInputStream,
          getSinkIds: () => this._callSinkIds,
          maxAverageBitrate: this._options.maxAverageBitrate,
          preflight: this._options.preflight,
          rtcConstraints: this._options.rtcConstraints,
          shouldPlayDisconnect: () => {
            var _a2;
            return (_a2 = this._audio) === null || _a2 === void 0 ? void 0 : _a2.disconnect();
          },
          twimlParams,
          voiceEventSidGenerator: this._options.voiceEventSidGenerator
        }, options);
        const maybeUnsetPreferredUri = () => {
          if (!this._stream) {
            this._log.warn("UnsetPreferredUri called without a stream");
            return;
          }
          if (this._activeCall === null && this._calls.length === 0) {
            this._stream.updatePreferredURI(null);
          }
        };
        const call = new (this._options.Call || Call)(config, options);
        this._publisher.info("settings", "init", {
          MediaStream: !!this._options.MediaStream,
          RTCPeerConnection: !!this._options.RTCPeerConnection,
          enumerateDevices: !!this._options.enumerateDevices,
          getUserMedia: !!this._options.getUserMedia
        }, call);
        call.once("accept", () => {
          var _a2, _b, _c, _d, _e;
          this._stream.updatePreferredURI(this._preferredURI);
          this._removeCall(call);
          this._activeCall = call;
          if (this._audio) {
            this._audio._maybeStartPollingVolume();
          }
          if (call.direction === Call.CallDirection.Outgoing && ((_a2 = this._audio) === null || _a2 === void 0 ? void 0 : _a2.outgoing()) && !isReconnect) {
            this._soundcache.get(_Device.SoundName.Outgoing).play();
          }
          const data = { edge: this._edge || this._region };
          if (this._options.edge) {
            data["selected_edge"] = Array.isArray(this._options.edge) ? this._options.edge : [this._options.edge];
          }
          this._publisher.info("settings", "edge", data, call);
          if ((_b = this._audio) === null || _b === void 0 ? void 0 : _b.localProcessedStream) {
            (_c = this._audioProcessorEventObserver) === null || _c === void 0 ? void 0 : _c.emit("enabled", false);
          }
          if ((_d = this._audio) === null || _d === void 0 ? void 0 : _d.remoteProcessedStream) {
            (_e = this._audioProcessorEventObserver) === null || _e === void 0 ? void 0 : _e.emit("enabled", true);
          }
        });
        call.addListener("error", (error2) => {
          if (call.status() === "closed") {
            this._removeCall(call);
            maybeUnsetPreferredUri();
          }
          if (this._audio) {
            this._audio._maybeStopPollingVolume();
          }
          this._maybeStopIncomingSound();
        });
        call.once("cancel", () => {
          this._log.info(`Canceled: ${call.parameters.CallSid}`);
          this._removeCall(call);
          maybeUnsetPreferredUri();
          if (this._audio) {
            this._audio._maybeStopPollingVolume();
          }
          this._maybeStopIncomingSound();
        });
        call.once("disconnect", () => {
          if (this._audio) {
            this._audio._maybeStopPollingVolume();
          }
          this._removeCall(call);
          maybeUnsetPreferredUri();
          this._maybeStopIncomingSound();
        });
        call.once("reject", () => {
          this._log.info(`Rejected: ${call.parameters.CallSid}`);
          if (this._audio) {
            this._audio._maybeStopPollingVolume();
          }
          this._removeCall(call);
          maybeUnsetPreferredUri();
          this._maybeStopIncomingSound();
        });
        call.on("transportClose", () => {
          if (call.status() !== Call.State.Pending) {
            return;
          }
          if (this._audio) {
            this._audio._maybeStopPollingVolume();
          }
          this._removeCall(call);
          this._maybeStopIncomingSound();
        });
        return call;
      });
    }
    /**
     * Stop the incoming sound if no {@link Call}s remain.
     */
    _maybeStopIncomingSound() {
      if (!this._calls.length) {
        this._soundcache.get(_Device.SoundName.Incoming).stop();
      }
    }
    /**
     * Remove a {@link Call} from device.calls by reference
     * @param call
     */
    _removeCall(call) {
      if (this._activeCall === call) {
        this._activeCall = null;
        this._makeCallPromise = null;
      }
      for (let i = this._calls.length - 1; i >= 0; i--) {
        if (call === this._calls[i]) {
          this._calls.splice(i, 1);
        }
      }
    }
    /**
     * Register with the signaling server.
     */
    _sendPresence(presence) {
      return __awaiter(this, void 0, void 0, function* () {
        const stream = yield this._streamConnectedPromise;
        if (!stream) {
          return;
        }
        stream.register({ audio: presence });
        if (presence) {
          this._startRegistrationTimer();
        } else {
          this._stopRegistrationTimer();
        }
      });
    }
    /**
     * Helper function that sets and emits the state of the device.
     * @param state The new state of the device.
     */
    _setState(state) {
      if (state === this.state) {
        return;
      }
      this._state = state;
      const name = this._stateEventMapping[state];
      this._log.debug(`#${name}`);
      this.emit(name);
    }
    /**
     * Set up an audio helper for usage by this {@link Device}.
     */
    _setupAudioHelper() {
      if (!this._audioProcessorEventObserver) {
        this._audioProcessorEventObserver = new AudioProcessorEventObserver();
        this._audioProcessorEventObserver.on("event", ({ name, group, isRemote }) => {
          this._publisher.info(group, name, { is_remote: isRemote }, this._activeCall);
        });
      }
      const audioOptions = {
        audioContext: _Device.audioContext,
        audioProcessorEventObserver: this._audioProcessorEventObserver,
        beforeSetInputDevice: () => {
          if (this._makeCallPromise) {
            this._log.debug("beforeSetInputDevice pause detected");
            return this._makeCallPromise;
          } else {
            this._log.debug("beforeSetInputDevice pause not detected, setting default");
            return Promise.resolve();
          }
        },
        enumerateDevices: this._options.enumerateDevices,
        getUserMedia: this._options.getUserMedia || getUserMedia
      };
      if (this._audio) {
        this._log.info("Found existing audio helper; updating options...");
        this._audio._updateUserOptions(audioOptions);
        return;
      }
      this._audio = new (this._options.AudioHelper || AudioHelper$1)(this._updateSinkIds, this._updateInputStream, audioOptions);
      this._audio.on("deviceChange", (lostActiveDevices) => {
        const activeCall2 = this._activeCall;
        const deviceIds = lostActiveDevices.map((device2) => device2.deviceId);
        this._publisher.info("audio", "device-change", {
          lost_active_device_ids: deviceIds
        }, activeCall2);
        if (activeCall2) {
          activeCall2["_mediaHandler"]._onInputDevicesChanged();
        }
      });
    }
    /**
     * Setup logger's loglevel
     */
    _setupLoglevel(logLevel) {
      const level = typeof logLevel === "number" || typeof logLevel === "string" ? logLevel : loglevel2.levels.ERROR;
      this._log.setDefaultLevel(level);
      this._log.info("Set logger default level to", level);
    }
    /**
     * Create and set a publisher for the {@link Device} to use.
     */
    _setupPublisher() {
      if (this._publisher) {
        this._log.info("Found existing publisher; destroying...");
        this._destroyPublisher();
      }
      const publisherOptions = {
        defaultPayload: this._createDefaultPayload,
        metadata: {
          app_name: this._options.appName,
          app_version: this._options.appVersion
        }
      };
      if (this._options.eventgw) {
        publisherOptions.host = this._options.eventgw;
      }
      if (this._home) {
        publisherOptions.host = createEventGatewayURI(this._home);
      }
      this._publisher = new (this._options.Publisher || EventPublisher)(PUBLISHER_PRODUCT_NAME, this.token, publisherOptions);
      if (this._options.publishEvents === false) {
        this._publisher.disable();
      } else {
        this._publisher.on("error", (error2) => {
          this._log.warn("Cannot connect to insights.", error2);
        });
      }
      return this._publisher;
    }
    /**
     * Set up the connection to the signaling server. Tears down an existing
     * stream if called while a stream exists.
     */
    _setupStream() {
      if (this._stream) {
        this._log.info("Found existing stream; destroying...");
        this._destroyStream();
      }
      this._log.info("Setting up VSP");
      this._stream = new (this._options.PStream || PStream)(this.token, this._chunderURIs, {
        backoffMaxMs: this._options.backoffMaxMs,
        maxPreferredDurationMs: this._options.maxCallSignalingTimeoutMs
      });
      this._stream.addListener("close", this._onSignalingClose);
      this._stream.addListener("connected", this._onSignalingConnected);
      this._stream.addListener("error", this._onSignalingError);
      this._stream.addListener("invite", this._onSignalingInvite);
      this._stream.addListener("offline", this._onSignalingOffline);
      this._stream.addListener("ready", this._onSignalingReady);
      return this._streamConnectedPromise = promisifyEvents(this._stream, "connected", "close").then(() => this._stream);
    }
    /**
     * Start playing the incoming ringtone, and subsequently emit the incoming event.
     * @param call
     * @param play - The function to be used to play the sound. Must return a Promise.
     */
    _showIncomingCall(call, play2) {
      let timeout;
      return Promise.race([
        play2(),
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => {
            const msg = "Playing incoming ringtone took too long; it might not play. Continuing execution...";
            reject(new Error(msg));
          }, RINGTONE_PLAY_TIMEOUT);
        })
      ]).catch((reason) => {
        this._log.warn(reason.message);
      }).then(() => {
        clearTimeout(timeout);
        this._log.debug("#incoming", JSON.stringify({
          customParameters: call.customParameters,
          parameters: call.parameters
        }));
        this.emit(_Device.EventName.Incoming, call);
      });
    }
    /**
     * Set a timeout to send another register message to the signaling server.
     */
    _startRegistrationTimer() {
      this._stopRegistrationTimer();
      this._regTimer = setTimeout(() => {
        this._sendPresence(true);
      }, REGISTRATION_INTERVAL);
    }
    /**
     * Stop sending registration messages to the signaling server.
     */
    _stopRegistrationTimer() {
      if (this._regTimer) {
        clearTimeout(this._regTimer);
      }
    }
    /**
     * Throw an error if the {@link Device} is destroyed.
     */
    _throwIfDestroyed() {
      if (this.state === _Device.State.Destroyed) {
        throw new InvalidStateError("Device has been destroyed.");
      }
    }
    /**
     * Update the device IDs of output devices being used to play the incoming ringtone through.
     * @param sinkIds - An array of device IDs
     */
    _updateRingtoneSinkIds(sinkIds) {
      return Promise.resolve(this._soundcache.get(_Device.SoundName.Incoming).setSinkIds(sinkIds));
    }
    /**
     * Update the device IDs of output devices being used to play the non-ringtone sounds
     * and Call audio through.
     * @param sinkIds - An array of device IDs
     */
    _updateSpeakerSinkIds(sinkIds) {
      Array.from(this._soundcache.entries()).filter((entry) => entry[0] !== _Device.SoundName.Incoming).forEach((entry) => entry[1].setSinkIds(sinkIds));
      this._callSinkIds = sinkIds;
      const call = this._activeCall;
      return call ? call._setSinkIds(sinkIds) : Promise.resolve();
    }
  };
  Device._defaultSounds = {
    disconnect: { filename: "disconnect", maxDuration: 3e3 },
    dtmf0: { filename: "dtmf-0", maxDuration: 1e3 },
    dtmf1: { filename: "dtmf-1", maxDuration: 1e3 },
    dtmf2: { filename: "dtmf-2", maxDuration: 1e3 },
    dtmf3: { filename: "dtmf-3", maxDuration: 1e3 },
    dtmf4: { filename: "dtmf-4", maxDuration: 1e3 },
    dtmf5: { filename: "dtmf-5", maxDuration: 1e3 },
    dtmf6: { filename: "dtmf-6", maxDuration: 1e3 },
    dtmf7: { filename: "dtmf-7", maxDuration: 1e3 },
    dtmf8: { filename: "dtmf-8", maxDuration: 1e3 },
    dtmf9: { filename: "dtmf-9", maxDuration: 1e3 },
    dtmfh: { filename: "dtmf-hash", maxDuration: 1e3 },
    dtmfs: { filename: "dtmf-star", maxDuration: 1e3 },
    incoming: { filename: "incoming", shouldLoop: true },
    outgoing: { filename: "outgoing", maxDuration: 3e3 }
  };
  (function(Device2) {
    (function(EventName) {
      EventName["Error"] = "error";
      EventName["Incoming"] = "incoming";
      EventName["Destroyed"] = "destroyed";
      EventName["Unregistered"] = "unregistered";
      EventName["Registering"] = "registering";
      EventName["Registered"] = "registered";
      EventName["TokenWillExpire"] = "tokenWillExpire";
    })(Device2.EventName || (Device2.EventName = {}));
    (function(State) {
      State["Destroyed"] = "destroyed";
      State["Unregistered"] = "unregistered";
      State["Registering"] = "registering";
      State["Registered"] = "registered";
    })(Device2.State || (Device2.State = {}));
    (function(SoundName) {
      SoundName["Incoming"] = "incoming";
      SoundName["Outgoing"] = "outgoing";
      SoundName["Disconnect"] = "disconnect";
      SoundName["Dtmf0"] = "dtmf0";
      SoundName["Dtmf1"] = "dtmf1";
      SoundName["Dtmf2"] = "dtmf2";
      SoundName["Dtmf3"] = "dtmf3";
      SoundName["Dtmf4"] = "dtmf4";
      SoundName["Dtmf5"] = "dtmf5";
      SoundName["Dtmf6"] = "dtmf6";
      SoundName["Dtmf7"] = "dtmf7";
      SoundName["Dtmf8"] = "dtmf8";
      SoundName["Dtmf9"] = "dtmf9";
      SoundName["DtmfS"] = "dtmfs";
      SoundName["DtmfH"] = "dtmfh";
    })(Device2.SoundName || (Device2.SoundName = {}));
  })(Device || (Device = {}));

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/icecandidate.js
  var IceCandidate = class {
    /**
     * @constructor
     * @param iceCandidate RTCIceCandidate coming from the browser
     */
    constructor(iceCandidate, isRemote = false) {
      this.deleted = false;
      let cost;
      const parts = iceCandidate.candidate.split("network-cost ");
      if (parts[1]) {
        cost = parseInt(parts[1], 10);
      }
      this.candidateType = iceCandidate.type;
      this.ip = iceCandidate.ip || iceCandidate.address;
      this.isRemote = isRemote;
      this.networkCost = cost;
      this.port = iceCandidate.port;
      this.priority = iceCandidate.priority;
      this.protocol = iceCandidate.protocol;
      this.relatedAddress = iceCandidate.relatedAddress;
      this.relatedPort = iceCandidate.relatedPort;
      this.tcpType = iceCandidate.tcpType;
      this.transportId = iceCandidate.sdpMid;
    }
    /**
     * Get the payload object for insights
     */
    toPayload() {
      return {
        "candidate_type": this.candidateType,
        "deleted": this.deleted,
        "ip": this.ip,
        "is_remote": this.isRemote,
        "network-cost": this.networkCost,
        "port": this.port,
        "priority": this.priority,
        "protocol": this.protocol,
        "related_address": this.relatedAddress,
        "related_port": this.relatedPort,
        "tcp_type": this.tcpType,
        "transport_id": this.transportId
      };
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/statsMonitor.js
  var import_events10 = __toESM(require_events());

  // node_modules/@twilio/voice-sdk/esm/twilio/rtc/mos.js
  var r0 = 94.768;
  function calculate(rtt, jitter, fractionLost) {
    if (typeof rtt !== "number" || typeof jitter !== "number" || typeof fractionLost !== "number" || !isNonNegativeNumber(rtt) || !isNonNegativeNumber(jitter) || !isNonNegativeNumber(fractionLost)) {
      return null;
    }
    const effectiveLatency = rtt + jitter * 2 + 10;
    let rFactor = 0;
    switch (true) {
      case effectiveLatency < 160:
        rFactor = r0 - effectiveLatency / 40;
        break;
      case effectiveLatency < 1e3:
        rFactor = r0 - (effectiveLatency - 120) / 10;
        break;
    }
    switch (true) {
      case fractionLost <= rFactor / 2.5:
        rFactor = Math.max(rFactor - fractionLost * 2.5, 6.52);
        break;
      default:
        rFactor = 0;
        break;
    }
    const mos = 1 + 0.035 * rFactor + 7e-6 * rFactor * (rFactor - 60) * (100 - rFactor);
    return mos;
  }
  function isNonNegativeNumber(n) {
    return typeof n === "number" && !isNaN(n) && isFinite(n) && n >= 0;
  }
  var Mos = {
    calculate,
    isNonNegativeNumber
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/statsMonitor.js
  var SAMPLE_COUNT_METRICS = 5;
  var SAMPLE_COUNT_CLEAR = 0;
  var SAMPLE_COUNT_RAISE = 3;
  var SAMPLE_INTERVAL = 1e3;
  var WARNING_TIMEOUT = 5 * 1e3;
  var DEFAULT_THRESHOLDS = {
    audioInputLevel: { minStandardDeviation: 327.67, sampleCount: 10 },
    audioOutputLevel: { minStandardDeviation: 327.67, sampleCount: 10 },
    bytesReceived: { clearCount: 2, min: 1, raiseCount: 3, sampleCount: 3 },
    bytesSent: { clearCount: 2, min: 1, raiseCount: 3, sampleCount: 3 },
    jitter: { max: 30 },
    mos: { min: 3 },
    packetsLostFraction: [{
      max: 1
    }, {
      clearValue: 1,
      maxAverage: 3,
      sampleCount: 7
    }],
    rtt: { max: 400 }
  };
  function countHigh(max, values) {
    return values.reduce((highCount, value) => highCount += value > max ? 1 : 0, 0);
  }
  function countLow(min, values) {
    return values.reduce((lowCount, value) => lowCount += value < min ? 1 : 0, 0);
  }
  function calculateStandardDeviation(values) {
    if (values.length <= 0) {
      return null;
    }
    const valueAverage = values.reduce((partialSum, value) => partialSum + value, 0) / values.length;
    const diffSquared = values.map((value) => Math.pow(value - valueAverage, 2));
    const stdDev = Math.sqrt(diffSquared.reduce((partialSum, value) => partialSum + value, 0) / diffSquared.length);
    return stdDev;
  }
  function flattenSamples(sampleSets) {
    return sampleSets.reduce((flat, current) => [...flat, ...current], []);
  }
  var StatsMonitor = class extends import_events10.EventEmitter {
    /**
     * @constructor
     * @param [options] - Optional settings
     */
    constructor(options) {
      super();
      this._activeWarnings = /* @__PURE__ */ new Map();
      this._currentStreaks = /* @__PURE__ */ new Map();
      this._inputVolumes = [];
      this._outputVolumes = [];
      this._sampleBuffer = [];
      this._supplementalSampleBuffers = {
        audioInputLevel: [],
        audioOutputLevel: []
      };
      this._warningsEnabled = true;
      options = options || {};
      this._getRTCStats = options.getRTCStats || getRTCStats;
      this._mos = options.Mos || Mos;
      this._peerConnection = options.peerConnection;
      this._thresholds = Object.assign(Object.assign({}, DEFAULT_THRESHOLDS), options.thresholds);
      const thresholdSampleCounts = Object.values(this._thresholds).map((threshold) => threshold.sampleCount).filter((sampleCount) => !!sampleCount);
      this._maxSampleCount = Math.max(SAMPLE_COUNT_METRICS, ...thresholdSampleCounts);
      if (this._peerConnection) {
        this.enable(this._peerConnection);
      }
    }
    /**
     * Called when a volume sample is available
     * @param inputVolume - Input volume level from 0 to 32767
     * @param outputVolume - Output volume level from 0 to 32767
     */
    addVolumes(inputVolume, outputVolume) {
      this._inputVolumes.push(inputVolume);
      this._outputVolumes.push(outputVolume);
    }
    /**
     * Stop sampling RTC statistics for this {@link StatsMonitor}.
     * @returns The current {@link StatsMonitor}.
     */
    disable() {
      if (this._sampleInterval) {
        clearInterval(this._sampleInterval);
        delete this._sampleInterval;
      }
      return this;
    }
    /**
     * Disable warnings for this {@link StatsMonitor}.
     * @returns The current {@link StatsMonitor}.
     */
    disableWarnings() {
      if (this._warningsEnabled) {
        this._activeWarnings.clear();
      }
      this._warningsEnabled = false;
      return this;
    }
    /**
     * Start sampling RTC statistics for this {@link StatsMonitor}.
     * @param peerConnection - A PeerConnection to monitor.
     * @returns The current {@link StatsMonitor}.
     */
    enable(peerConnection) {
      if (peerConnection) {
        if (this._peerConnection && peerConnection !== this._peerConnection) {
          throw new InvalidArgumentError("Attempted to replace an existing PeerConnection in StatsMonitor.enable");
        }
        this._peerConnection = peerConnection;
      }
      if (!this._peerConnection) {
        throw new InvalidArgumentError("Can not enable StatsMonitor without a PeerConnection");
      }
      this._sampleInterval = this._sampleInterval || setInterval(this._fetchSample.bind(this), SAMPLE_INTERVAL);
      return this;
    }
    /**
     * Enable warnings for this {@link StatsMonitor}.
     * @returns The current {@link StatsMonitor}.
     */
    enableWarnings() {
      this._warningsEnabled = true;
      return this;
    }
    /**
     * Check if there is an active warning for a specific stat and threshold
     * @param statName - The name of the stat to check
     * @param thresholdName - The name of the threshold to check
     * @returns Whether there is an active warning for a specific stat and threshold
     */
    hasActiveWarning(statName, thresholdName) {
      const warningId = `${statName}:${thresholdName}`;
      return !!this._activeWarnings.get(warningId);
    }
    /**
     * Add a sample to our sample buffer and remove the oldest if we are over the limit.
     * @param sample - Sample to add
     */
    _addSample(sample) {
      const samples = this._sampleBuffer;
      samples.push(sample);
      if (samples.length > this._maxSampleCount) {
        samples.splice(0, samples.length - this._maxSampleCount);
      }
    }
    /**
     * Clear an active warning.
     * @param statName - The name of the stat to clear.
     * @param thresholdName - The name of the threshold to clear
     * @param [data] - Any relevant sample data.
     */
    _clearWarning(statName, thresholdName, data) {
      const warningId = `${statName}:${thresholdName}`;
      const activeWarning = this._activeWarnings.get(warningId);
      if (!activeWarning || Date.now() - activeWarning.timeRaised < WARNING_TIMEOUT) {
        return;
      }
      this._activeWarnings.delete(warningId);
      this.emit("warning-cleared", Object.assign(Object.assign({}, data), { name: statName, threshold: {
        name: thresholdName,
        value: this._thresholds[statName][thresholdName]
      } }));
    }
    /**
     * Create a sample object from a stats object using the previous sample, if available.
     * @param stats - Stats retrieved from getStatistics
     * @param [previousSample=null] - The previous sample to use to calculate deltas.
     * @returns A universally-formatted version of RTC stats.
     */
    _createSample(stats, previousSample) {
      const previousBytesSent = previousSample && previousSample.totals.bytesSent || 0;
      const previousBytesReceived = previousSample && previousSample.totals.bytesReceived || 0;
      const previousPacketsSent = previousSample && previousSample.totals.packetsSent || 0;
      const previousPacketsReceived = previousSample && previousSample.totals.packetsReceived || 0;
      const previousPacketsLost = previousSample && previousSample.totals.packetsLost || 0;
      const currentBytesSent = stats.bytesSent - previousBytesSent;
      const currentBytesReceived = stats.bytesReceived - previousBytesReceived;
      const currentPacketsSent = stats.packetsSent - previousPacketsSent;
      const currentPacketsReceived = stats.packetsReceived - previousPacketsReceived;
      const currentPacketsLost = stats.packetsLost - previousPacketsLost;
      const currentInboundPackets = currentPacketsReceived + currentPacketsLost;
      const currentPacketsLostFraction = currentInboundPackets > 0 ? currentPacketsLost / currentInboundPackets * 100 : 0;
      const totalInboundPackets = stats.packetsReceived + stats.packetsLost;
      const totalPacketsLostFraction = totalInboundPackets > 0 ? stats.packetsLost / totalInboundPackets * 100 : 100;
      const rttValue = typeof stats.rtt === "number" || !previousSample ? stats.rtt : previousSample.rtt;
      const audioInputLevelValues = this._inputVolumes.splice(0);
      this._supplementalSampleBuffers.audioInputLevel.push(audioInputLevelValues);
      const audioOutputLevelValues = this._outputVolumes.splice(0);
      this._supplementalSampleBuffers.audioOutputLevel.push(audioOutputLevelValues);
      return {
        audioInputLevel: Math.round(average(audioInputLevelValues)),
        audioOutputLevel: Math.round(average(audioOutputLevelValues)),
        bytesReceived: currentBytesReceived,
        bytesSent: currentBytesSent,
        codecName: stats.codecName,
        jitter: stats.jitter,
        mos: this._mos.calculate(rttValue, stats.jitter, previousSample && currentPacketsLostFraction),
        packetsLost: currentPacketsLost,
        packetsLostFraction: currentPacketsLostFraction,
        packetsReceived: currentPacketsReceived,
        packetsSent: currentPacketsSent,
        rtt: rttValue,
        timestamp: stats.timestamp,
        totals: {
          bytesReceived: stats.bytesReceived,
          bytesSent: stats.bytesSent,
          packetsLost: stats.packetsLost,
          packetsLostFraction: totalPacketsLostFraction,
          packetsReceived: stats.packetsReceived,
          packetsSent: stats.packetsSent
        }
      };
    }
    /**
     * Get stats from the PeerConnection and add it to our list of samples.
     */
    _fetchSample() {
      this._getSample().then((sample) => {
        this._addSample(sample);
        this._raiseWarnings();
        this.emit("sample", sample);
      }).catch((error2) => {
        this.disable();
        this.emit("error", error2);
      });
    }
    /**
     * Get stats from the PeerConnection.
     * @returns A universally-formatted version of RTC stats.
     */
    _getSample() {
      return this._getRTCStats(this._peerConnection).then((stats) => {
        let previousSample = null;
        if (this._sampleBuffer.length) {
          previousSample = this._sampleBuffer[this._sampleBuffer.length - 1];
        }
        return this._createSample(stats, previousSample);
      });
    }
    /**
     * Raise a warning and log its raised time.
     * @param statName - The name of the stat to raise.
     * @param thresholdName - The name of the threshold to raise
     * @param [data] - Any relevant sample data.
     */
    _raiseWarning(statName, thresholdName, data) {
      const warningId = `${statName}:${thresholdName}`;
      if (this._activeWarnings.has(warningId)) {
        return;
      }
      this._activeWarnings.set(warningId, { timeRaised: Date.now() });
      const thresholds = this._thresholds[statName];
      let thresholdValue;
      if (Array.isArray(thresholds)) {
        const foundThreshold = thresholds.find((threshold) => thresholdName in threshold);
        if (foundThreshold) {
          thresholdValue = foundThreshold[thresholdName];
        }
      } else {
        thresholdValue = this._thresholds[statName][thresholdName];
      }
      this.emit("warning", Object.assign(Object.assign({}, data), { name: statName, threshold: {
        name: thresholdName,
        value: thresholdValue
      } }));
    }
    /**
     * Apply our thresholds to our array of RTCStat samples.
     */
    _raiseWarnings() {
      if (!this._warningsEnabled) {
        return;
      }
      Object.keys(this._thresholds).forEach((name) => this._raiseWarningsForStat(name));
    }
    /**
     * Apply thresholds for a given stat name to our array of
     * RTCStat samples and raise or clear any associated warnings.
     * @param statName - Name of the stat to compare.
     */
    _raiseWarningsForStat(statName) {
      const limits = Array.isArray(this._thresholds[statName]) ? this._thresholds[statName] : [this._thresholds[statName]];
      limits.forEach((limit) => {
        const samples = this._sampleBuffer;
        const clearCount = limit.clearCount || SAMPLE_COUNT_CLEAR;
        const raiseCount = limit.raiseCount || SAMPLE_COUNT_RAISE;
        const sampleCount = limit.sampleCount || this._maxSampleCount;
        let relevantSamples = samples.slice(-sampleCount);
        const values = relevantSamples.map((sample) => sample[statName]);
        const containsNull = values.some((value) => typeof value === "undefined" || value === null);
        if (containsNull) {
          return;
        }
        let count;
        if (typeof limit.max === "number") {
          count = countHigh(limit.max, values);
          if (count >= raiseCount) {
            this._raiseWarning(statName, "max", { values, samples: relevantSamples });
          } else if (count <= clearCount) {
            this._clearWarning(statName, "max", { values, samples: relevantSamples });
          }
        }
        if (typeof limit.min === "number") {
          count = countLow(limit.min, values);
          if (count >= raiseCount) {
            this._raiseWarning(statName, "min", { values, samples: relevantSamples });
          } else if (count <= clearCount) {
            this._clearWarning(statName, "min", { values, samples: relevantSamples });
          }
        }
        if (typeof limit.maxDuration === "number" && samples.length > 1) {
          relevantSamples = samples.slice(-2);
          const prevValue = relevantSamples[0][statName];
          const curValue = relevantSamples[1][statName];
          const prevStreak = this._currentStreaks.get(statName) || 0;
          const streak = prevValue === curValue ? prevStreak + 1 : 0;
          this._currentStreaks.set(statName, streak);
          if (streak >= limit.maxDuration) {
            this._raiseWarning(statName, "maxDuration", { value: streak });
          } else if (streak === 0) {
            this._clearWarning(statName, "maxDuration", { value: prevStreak });
          }
        }
        if (typeof limit.minStandardDeviation === "number") {
          const sampleSets = this._supplementalSampleBuffers[statName];
          if (!sampleSets || sampleSets.length < limit.sampleCount) {
            return;
          }
          if (sampleSets.length > limit.sampleCount) {
            sampleSets.splice(0, sampleSets.length - limit.sampleCount);
          }
          const flatSamples = flattenSamples(sampleSets.slice(-sampleCount));
          const stdDev = calculateStandardDeviation(flatSamples);
          if (typeof stdDev !== "number") {
            return;
          }
          if (stdDev < limit.minStandardDeviation) {
            this._raiseWarning(statName, "minStandardDeviation", { value: stdDev });
          } else {
            this._clearWarning(statName, "minStandardDeviation", { value: stdDev });
          }
        }
        [
          ["maxAverage", (x, y) => x > y],
          ["minAverage", (x, y) => x < y]
        ].forEach(([thresholdName, comparator]) => {
          if (typeof limit[thresholdName] === "number" && values.length >= sampleCount) {
            const avg = average(values);
            if (comparator(avg, limit[thresholdName])) {
              this._raiseWarning(statName, thresholdName, { values, samples: relevantSamples });
            } else if (!comparator(avg, limit.clearValue || limit[thresholdName])) {
              this._clearWarning(statName, thresholdName, { values, samples: relevantSamples });
            }
          }
        });
      });
    }
  };

  // node_modules/@twilio/voice-sdk/esm/twilio/call.js
  var BACKOFF_CONFIG = {
    factor: 1.1,
    jitter: 0.5,
    max: 3e4,
    min: 1
  };
  var DTMF_INTER_TONE_GAP = 70;
  var DTMF_PAUSE_DURATION = 500;
  var DTMF_TONE_DURATION = 160;
  var METRICS_BATCH_SIZE = 10;
  var METRICS_DELAY = 5e3;
  var MEDIA_DISCONNECT_ERROR = {
    disconnect: true,
    info: {
      code: 31003,
      message: "Connection with Twilio was interrupted.",
      twilioError: new MediaErrors.ConnectionError()
    }
  };
  var MULTIPLE_THRESHOLD_WARNING_NAMES = {
    // The stat `packetsLostFraction` is monitored by two separate thresholds,
    // `maxAverage` and `max`. Each threshold emits a different warning name.
    packetsLostFraction: {
      max: "packet-loss",
      maxAverage: "packets-lost-fraction"
    }
  };
  var WARNING_NAMES = {
    audioInputLevel: "audio-input-level",
    audioOutputLevel: "audio-output-level",
    bytesReceived: "bytes-received",
    bytesSent: "bytes-sent",
    jitter: "jitter",
    mos: "mos",
    rtt: "rtt"
  };
  var WARNING_PREFIXES = {
    max: "high-",
    maxAverage: "high-",
    maxDuration: "constant-",
    min: "low-",
    minStandardDeviation: "constant-"
  };
  var Call = class _Call extends import_events11.EventEmitter {
    /**
     * Whether this {@link Call} is incoming or outgoing.
     */
    get direction() {
      return this._direction;
    }
    /**
     * Audio codec used for this {@link Call}. Expecting {@link Call.Codec} but
     * will copy whatever we get from RTC stats.
     */
    get codec() {
      return this._codec;
    }
    /**
     * The connect token is available as soon as the call is established
     * and connected to Twilio. Use this token to reconnect to a call via the {@link Device.connect}
     * method.
     *
     * For incoming calls, it is available in the call object after the {@link Device.incomingEvent} is emitted.
     * For outgoing calls, it is available after the {@link Call.acceptEvent} is emitted.
     */
    get connectToken() {
      const signalingReconnectToken = this._signalingReconnectToken;
      const callSid = this.parameters && this.parameters.CallSid ? this.parameters.CallSid : void 0;
      if (!signalingReconnectToken || !callSid) {
        return;
      }
      const customParameters = this.customParameters && typeof this.customParameters.keys === "function" ? Array.from(this.customParameters.keys()).reduce((result, key) => {
        result[key] = this.customParameters.get(key);
        return result;
      }, {}) : {};
      const parameters = this.parameters || {};
      return btoa(encodeURIComponent(JSON.stringify({
        customParameters,
        parameters,
        signalingReconnectToken
      })));
    }
    /**
     * @internal
     * @param config - Mandatory configuration options
     * @param options - Optional settings
     */
    constructor(config, options) {
      super();
      this.parameters = {};
      this._inputVolumeStreak = 0;
      this._isAnswered = false;
      this._isCancelled = false;
      this._isRejected = false;
      this._latestInputVolume = 0;
      this._latestOutputVolume = 0;
      this._log = new Log("Call");
      this._mediaStatus = _Call.State.Pending;
      this._messages = /* @__PURE__ */ new Map();
      this._metricsSamples = [];
      this._options = {
        MediaHandler: PeerConnection,
        MediaStream: null,
        enableImprovedSignalingErrorPrecision: false,
        offerSdp: null,
        shouldPlayDisconnect: () => true,
        voiceEventSidGenerator: generateVoiceEventSid
      };
      this._outputVolumeStreak = 0;
      this._shouldSendHangup = true;
      this._signalingStatus = _Call.State.Pending;
      this._soundcache = /* @__PURE__ */ new Map();
      this._status = _Call.State.Pending;
      this._wasConnected = false;
      this.toString = () => "[Twilio.Call instance]";
      this._emitWarning = (groupPrefix, warningName, threshold, value, wasCleared, warningData) => {
        const groupSuffix = wasCleared ? "-cleared" : "-raised";
        const groupName = `${groupPrefix}warning${groupSuffix}`;
        if (warningName === "constant-audio-input-level" && this.isMuted()) {
          return;
        }
        let level = wasCleared ? "info" : "warning";
        if (warningName === "constant-audio-output-level") {
          level = "info";
        }
        const payloadData = { threshold };
        if (value) {
          if (value instanceof Array) {
            payloadData.values = value.map((val) => {
              if (typeof val === "number") {
                return Math.round(val * 100) / 100;
              }
              return value;
            });
          } else {
            payloadData.value = value;
          }
        }
        this._publisher.post(level, groupName, warningName, { data: payloadData }, this);
        if (warningName !== "constant-audio-output-level") {
          const emitName = wasCleared ? "warning-cleared" : "warning";
          this._log.debug(`#${emitName}`, warningName);
          this.emit(emitName, warningName, warningData && !wasCleared ? warningData : null);
        }
      };
      this._onAck = (payload) => {
        const { acktype, callsid, voiceeventsid } = payload;
        if (this.parameters.CallSid !== callsid) {
          this._log.warn(`Received ack from a different callsid: ${callsid}`);
          return;
        }
        if (acktype === "message") {
          this._onMessageSent(voiceeventsid);
        }
      };
      this._onAnswer = (payload) => {
        if (typeof payload.reconnect === "string") {
          this._signalingReconnectToken = payload.reconnect;
        }
        if (this._isAnswered && this._status !== _Call.State.Reconnecting) {
          return;
        }
        this._setCallSid(payload);
        this._isAnswered = true;
        this._maybeTransitionToOpen();
      };
      this._onCancel = (payload) => {
        const callsid = payload.callsid;
        if (this.parameters.CallSid === callsid) {
          this._isCancelled = true;
          this._publisher.info("connection", "cancel", null, this);
          this._cleanupEventListeners();
          this._mediaHandler.close();
          this._status = _Call.State.Closed;
          this._log.debug("#cancel");
          this.emit("cancel");
          this._pstream.removeListener("cancel", this._onCancel);
        }
      };
      this._onConnected = () => {
        this._log.info("Received connected from pstream");
        if (this._signalingReconnectToken && this._mediaHandler.version) {
          this._pstream.reconnect(this._mediaHandler.version.getSDP(), this.parameters.CallSid, this._signalingReconnectToken);
        }
      };
      this._onHangup = (payload) => {
        if (this.status() === _Call.State.Closed) {
          return;
        }
        if (payload.callsid && (this.parameters.CallSid || this.outboundConnectionId)) {
          if (payload.callsid !== this.parameters.CallSid && payload.callsid !== this.outboundConnectionId) {
            return;
          }
        } else if (payload.callsid) {
          return;
        }
        this._log.info("Received HANGUP from gateway");
        if (payload.error) {
          const code = payload.error.code;
          const errorConstructor = getPreciseSignalingErrorByCode(this._options.enableImprovedSignalingErrorPrecision, code);
          const error2 = typeof errorConstructor !== "undefined" ? new errorConstructor(payload.error.message) : new GeneralErrors.ConnectionError("Error sent from gateway in HANGUP", payload.error);
          this._log.error("Received an error from the gateway:", error2);
          this._log.debug("#error", error2);
          this.emit("error", error2);
        }
        this._shouldSendHangup = false;
        this._publisher.info("connection", "disconnected-by-remote", null, this);
        this._disconnect(null, true);
        this._cleanupEventListeners();
      };
      this._onMediaFailure = (type) => {
        const { ConnectionDisconnected, ConnectionFailed, IceGatheringFailed, LowBytes } = _Call.MediaFailure;
        const isEndOfIceCycle = type === ConnectionFailed || type === IceGatheringFailed;
        if (!isChrome(window, window.navigator) && type === ConnectionFailed) {
          return this._mediaHandler.onerror(MEDIA_DISCONNECT_ERROR);
        }
        if (this._mediaStatus === _Call.State.Reconnecting) {
          if (isEndOfIceCycle) {
            if (Date.now() - this._mediaReconnectStartTime > BACKOFF_CONFIG.max) {
              this._log.warn("Exceeded max ICE retries");
              return this._mediaHandler.onerror(MEDIA_DISCONNECT_ERROR);
            }
            try {
              this._mediaReconnectBackoff.backoff();
            } catch (error2) {
              if (!(error2.message && error2.message === "Backoff in progress.")) {
                throw error2;
              }
            }
          }
          return;
        }
        const pc = this._mediaHandler.version.pc;
        const isIceDisconnected = pc && pc.iceConnectionState === "disconnected";
        const hasLowBytesWarning = this._monitor.hasActiveWarning("bytesSent", "min") || this._monitor.hasActiveWarning("bytesReceived", "min");
        if (type === LowBytes && isIceDisconnected || type === ConnectionDisconnected && hasLowBytesWarning || isEndOfIceCycle) {
          const mediaReconnectionError = new MediaErrors.ConnectionError("Media connection failed.");
          this._log.warn("ICE Connection disconnected.");
          this._publisher.warn("connection", "error", mediaReconnectionError, this);
          this._publisher.info("connection", "reconnecting", null, this);
          this._mediaReconnectStartTime = Date.now();
          this._status = _Call.State.Reconnecting;
          this._mediaStatus = _Call.State.Reconnecting;
          this._mediaReconnectBackoff.reset();
          this._mediaReconnectBackoff.backoff();
          this._log.debug("#reconnecting");
          this.emit("reconnecting", mediaReconnectionError);
        }
      };
      this._onMediaReconnected = () => {
        if (this._mediaStatus !== _Call.State.Reconnecting) {
          return;
        }
        this._log.info("ICE Connection reestablished.");
        this._mediaStatus = _Call.State.Open;
        if (this._signalingStatus === _Call.State.Open) {
          this._publisher.info("connection", "reconnected", null, this);
          this._log.debug("#reconnected");
          this.emit("reconnected");
          this._status = _Call.State.Open;
        }
      };
      this._onMessageReceived = (payload) => {
        const { callsid, content, contenttype, messagetype, voiceeventsid } = payload;
        if (this.parameters.CallSid !== callsid) {
          this._log.warn(`Received a message from a different callsid: ${callsid}`);
          return;
        }
        const data = {
          content,
          contentType: contenttype,
          messageType: messagetype,
          voiceEventSid: voiceeventsid
        };
        this._publisher.info("call-message", messagetype, {
          content_type: contenttype,
          event_type: "received",
          voice_event_sid: voiceeventsid
        }, this);
        this._log.debug("#messageReceived", JSON.stringify(data));
        this.emit("messageReceived", data);
      };
      this._onMessageSent = (voiceEventSid) => {
        if (!this._messages.has(voiceEventSid)) {
          this._log.warn(`Received a messageSent with a voiceEventSid that doesn't exists: ${voiceEventSid}`);
          return;
        }
        const message2 = this._messages.get(voiceEventSid);
        this._messages.delete(voiceEventSid);
        this._publisher.info("call-message", message2 === null || message2 === void 0 ? void 0 : message2.messageType, {
          content_type: message2 === null || message2 === void 0 ? void 0 : message2.contentType,
          event_type: "sent",
          voice_event_sid: voiceEventSid
        }, this);
        this._log.debug("#messageSent", JSON.stringify(message2));
        this.emit("messageSent", message2);
      };
      this._onRinging = (payload) => {
        this._setCallSid(payload);
        if (this._status !== _Call.State.Connecting && this._status !== _Call.State.Ringing) {
          return;
        }
        const hasEarlyMedia = !!payload.sdp;
        this._status = _Call.State.Ringing;
        this._publisher.info("connection", "outgoing-ringing", { hasEarlyMedia }, this);
        this._log.debug("#ringing");
        this.emit("ringing", hasEarlyMedia);
      };
      this._onRTCSample = (sample) => {
        const callMetrics = Object.assign(Object.assign({}, sample), { inputVolume: this._latestInputVolume, outputVolume: this._latestOutputVolume });
        this._codec = callMetrics.codecName;
        this._metricsSamples.push(callMetrics);
        if (this._metricsSamples.length >= METRICS_BATCH_SIZE) {
          this._publishMetrics();
        }
        this.emit("sample", sample);
      };
      this._onSignalingError = (payload) => {
        const { callsid, voiceeventsid, error: error2 } = payload;
        if (this.parameters.CallSid !== callsid) {
          this._log.warn(`Received an error from a different callsid: ${callsid}`);
          return;
        }
        if (voiceeventsid && this._messages.has(voiceeventsid)) {
          this._messages.delete(voiceeventsid);
          this._log.warn(`Received an error while sending a message.`, payload);
          this._publisher.error("call-message", "error", {
            code: error2.code,
            message: error2.message,
            voice_event_sid: voiceeventsid
          }, this);
          let twilioError;
          const errorConstructor = getPreciseSignalingErrorByCode(!!this._options.enableImprovedSignalingErrorPrecision, error2.code);
          if (typeof errorConstructor !== "undefined") {
            twilioError = new errorConstructor(error2);
          }
          if (!twilioError) {
            this._log.error("Unknown Call Message Error: ", error2);
            twilioError = new GeneralErrors.UnknownError(error2.message, error2);
          }
          this._log.debug("#error", error2, twilioError);
          this.emit("error", twilioError);
        }
      };
      this._onSignalingReconnected = () => {
        if (this._signalingStatus !== _Call.State.Reconnecting) {
          return;
        }
        this._log.info("Signaling Connection reestablished.");
        this._signalingStatus = _Call.State.Open;
        if (this._mediaStatus === _Call.State.Open) {
          this._publisher.info("connection", "reconnected", null, this);
          this._log.debug("#reconnected");
          this.emit("reconnected");
          this._status = _Call.State.Open;
        }
      };
      this._onTransportClose = () => {
        this._log.error("Received transportClose from pstream");
        this._log.debug("#transportClose");
        this.emit("transportClose");
        if (this._signalingReconnectToken) {
          this._status = _Call.State.Reconnecting;
          this._signalingStatus = _Call.State.Reconnecting;
          this._publisher.info("connection", "reconnecting", null, this);
          this._log.debug("#reconnecting");
          this.emit("reconnecting", new SignalingErrors.ConnectionDisconnected());
        } else {
          this._status = _Call.State.Closed;
          this._signalingStatus = _Call.State.Closed;
        }
      };
      this._reemitWarning = (warningData, wasCleared) => {
        const groupPrefix = /^audio/.test(warningData.name) ? "audio-level-" : "network-quality-";
        const warningPrefix = WARNING_PREFIXES[warningData.threshold.name];
        let warningName;
        if (warningData.name in MULTIPLE_THRESHOLD_WARNING_NAMES) {
          warningName = MULTIPLE_THRESHOLD_WARNING_NAMES[warningData.name][warningData.threshold.name];
        } else if (warningData.name in WARNING_NAMES) {
          warningName = WARNING_NAMES[warningData.name];
        }
        const warning = warningPrefix + warningName;
        this._emitWarning(groupPrefix, warning, warningData.threshold.value, warningData.values || warningData.value, wasCleared, warningData);
      };
      this._reemitWarningCleared = (warningData) => {
        this._reemitWarning(warningData, true);
      };
      this._soundcache = config.soundcache;
      if (typeof config.onIgnore === "function") {
        this._onIgnore = config.onIgnore;
      }
      const message = options && options.twimlParams || {};
      this.customParameters = new Map(Object.entries(message).map(([key, val]) => [key, String(val)]));
      Object.assign(this._options, options);
      if (this._options.callParameters) {
        this.parameters = this._options.callParameters;
      }
      if (this._options.reconnectToken) {
        this._signalingReconnectToken = this._options.reconnectToken;
      }
      this._voiceEventSidGenerator = this._options.voiceEventSidGenerator || generateVoiceEventSid;
      this._direction = this.parameters.CallSid && !this._options.reconnectCallSid ? _Call.CallDirection.Incoming : _Call.CallDirection.Outgoing;
      if (this.parameters) {
        this.callerInfo = this.parameters.StirStatus ? { isVerified: this.parameters.StirStatus === "TN-Validation-Passed-A" } : null;
      } else {
        this.callerInfo = null;
      }
      this._mediaReconnectBackoff = new Backoff(BACKOFF_CONFIG);
      this._mediaReconnectBackoff.on("ready", () => this._mediaHandler.iceRestart());
      this.outboundConnectionId = generateTempCallSid();
      const publisher = this._publisher = config.publisher;
      if (this._direction === _Call.CallDirection.Incoming) {
        publisher.info("connection", "incoming", null, this);
      } else {
        publisher.info("connection", "outgoing", {
          preflight: this._options.preflight,
          reconnect: !!this._options.reconnectCallSid
        }, this);
      }
      const monitor = this._monitor = new (this._options.StatsMonitor || StatsMonitor)();
      monitor.on("sample", this._onRTCSample);
      monitor.disableWarnings();
      setTimeout(() => monitor.enableWarnings(), METRICS_DELAY);
      monitor.on("warning", (data, wasCleared) => {
        if (data.name === "bytesSent" || data.name === "bytesReceived") {
          this._onMediaFailure(_Call.MediaFailure.LowBytes);
        }
        this._reemitWarning(data, wasCleared);
      });
      monitor.on("warning-cleared", (data) => {
        this._reemitWarningCleared(data);
      });
      this._mediaHandler = new this._options.MediaHandler(config.audioHelper, config.pstream, {
        MediaStream: this._options.MediaStream,
        RTCPeerConnection: this._options.RTCPeerConnection,
        codecPreferences: this._options.codecPreferences,
        dscp: this._options.dscp,
        forceAggressiveIceNomination: this._options.forceAggressiveIceNomination,
        maxAverageBitrate: this._options.maxAverageBitrate
      });
      this.on("volume", (inputVolume, outputVolume) => {
        this._inputVolumeStreak = this._checkVolume(inputVolume, this._inputVolumeStreak, this._latestInputVolume, "input");
        this._outputVolumeStreak = this._checkVolume(outputVolume, this._outputVolumeStreak, this._latestOutputVolume, "output");
        this._latestInputVolume = inputVolume;
        this._latestOutputVolume = outputVolume;
      });
      this._mediaHandler.onaudio = (remoteAudio) => {
        this._log.debug("#audio");
        this.emit("audio", remoteAudio);
      };
      this._mediaHandler.onvolume = (inputVolume, outputVolume, internalInputVolume, internalOutputVolume) => {
        monitor.addVolumes(internalInputVolume / 255 * 32767, internalOutputVolume / 255 * 32767);
        this.emit("volume", inputVolume, outputVolume);
      };
      this._mediaHandler.ondtlstransportstatechange = (state) => {
        const level = state === "failed" ? "error" : "debug";
        this._publisher.post(level, "dtls-transport-state", state, null, this);
      };
      this._mediaHandler.onpcconnectionstatechange = (state) => {
        let level = "debug";
        const dtlsTransport = this._mediaHandler.getRTCDtlsTransport();
        if (state === "failed") {
          level = dtlsTransport && dtlsTransport.state === "failed" ? "error" : "warning";
        }
        this._publisher.post(level, "pc-connection-state", state, null, this);
      };
      this._mediaHandler.onicecandidate = (candidate) => {
        const payload = new IceCandidate(candidate).toPayload();
        this._publisher.debug("ice-candidate", "ice-candidate", payload, this);
      };
      this._mediaHandler.onselectedcandidatepairchange = (pair) => {
        const localCandidatePayload = new IceCandidate(pair.local).toPayload();
        const remoteCandidatePayload = new IceCandidate(pair.remote, true).toPayload();
        this._publisher.debug("ice-candidate", "selected-ice-candidate-pair", {
          local_candidate: localCandidatePayload,
          remote_candidate: remoteCandidatePayload
        }, this);
      };
      this._mediaHandler.oniceconnectionstatechange = (state) => {
        const level = state === "failed" ? "error" : "debug";
        this._publisher.post(level, "ice-connection-state", state, null, this);
      };
      this._mediaHandler.onicegatheringfailure = (type) => {
        this._publisher.warn("ice-gathering-state", type, null, this);
        this._onMediaFailure(_Call.MediaFailure.IceGatheringFailed);
      };
      this._mediaHandler.onicegatheringstatechange = (state) => {
        this._publisher.debug("ice-gathering-state", state, null, this);
      };
      this._mediaHandler.onsignalingstatechange = (state) => {
        this._publisher.debug("signaling-state", state, null, this);
      };
      this._mediaHandler.ondisconnected = (msg) => {
        this._log.warn(msg);
        this._publisher.warn("network-quality-warning-raised", "ice-connectivity-lost", {
          message: msg
        }, this);
        this._log.debug("#warning", "ice-connectivity-lost");
        this.emit("warning", "ice-connectivity-lost");
        this._onMediaFailure(_Call.MediaFailure.ConnectionDisconnected);
      };
      this._mediaHandler.onfailed = (msg) => {
        this._onMediaFailure(_Call.MediaFailure.ConnectionFailed);
      };
      this._mediaHandler.onconnected = () => {
        if (this._status === _Call.State.Reconnecting) {
          this._onMediaReconnected();
        }
      };
      this._mediaHandler.onreconnected = (msg) => {
        this._log.info(msg);
        this._publisher.info("network-quality-warning-cleared", "ice-connectivity-lost", {
          message: msg
        }, this);
        this._log.debug("#warning-cleared", "ice-connectivity-lost");
        this.emit("warning-cleared", "ice-connectivity-lost");
        this._onMediaReconnected();
      };
      this._mediaHandler.onerror = (e) => {
        if (e.disconnect === true) {
          this._disconnect(e.info && e.info.message);
        }
        const error2 = e.info.twilioError || new GeneralErrors.UnknownError(e.info.message);
        this._log.error("Received an error from MediaStream:", e);
        this._log.debug("#error", error2);
        this.emit("error", error2);
      };
      this._mediaHandler.onopen = () => {
        if (this._status === _Call.State.Open || this._status === _Call.State.Reconnecting) {
          return;
        } else if (this._status === _Call.State.Ringing || this._status === _Call.State.Connecting) {
          this.mute(this._mediaHandler.isMuted);
          this._mediaStatus = _Call.State.Open;
          this._maybeTransitionToOpen();
        } else {
          this._mediaHandler.close();
        }
      };
      this._mediaHandler.onclose = () => {
        this._status = _Call.State.Closed;
        if (this._options.shouldPlayDisconnect && this._options.shouldPlayDisconnect() && !this._isCancelled && !this._isRejected) {
          this._soundcache.get(Device.SoundName.Disconnect).play();
        }
        monitor.disable();
        this._publishMetrics();
        if (!this._isCancelled && !this._isRejected) {
          this._log.debug("#disconnect");
          this.emit("disconnect", this);
        }
      };
      this._pstream = config.pstream;
      this._pstream.on("ack", this._onAck);
      this._pstream.on("cancel", this._onCancel);
      this._pstream.on("error", this._onSignalingError);
      this._pstream.on("ringing", this._onRinging);
      this._pstream.on("transportClose", this._onTransportClose);
      this._pstream.on("connected", this._onConnected);
      this._pstream.on("message", this._onMessageReceived);
      this.on("error", (error2) => {
        this._publisher.error("connection", "error", {
          code: error2.code,
          message: error2.message
        }, this);
        if (this._pstream && this._pstream.status === "disconnected") {
          this._cleanupEventListeners();
        }
      });
      this.on("disconnect", () => {
        this._cleanupEventListeners();
      });
    }
    /**
     * Set the audio input tracks from a given stream.
     * @internal
     * @param stream
     */
    _setInputTracksFromStream(stream) {
      return this._mediaHandler.setInputTracksFromStream(stream);
    }
    /**
     * Set the audio output sink IDs.
     * @internal
     * @param sinkIds
     */
    _setSinkIds(sinkIds) {
      return this._mediaHandler._setSinkIds(sinkIds);
    }
    /**
     * Accept the incoming {@link Call}.
     * @param [options]
     */
    accept(options) {
      this._log.debug(".accept", options);
      if (this._status !== _Call.State.Pending) {
        this._log.debug(`.accept noop. status is '${this._status}'`);
        return;
      }
      options = options || {};
      const rtcConfiguration = options.rtcConfiguration || this._options.rtcConfiguration;
      const rtcConstraints = options.rtcConstraints || this._options.rtcConstraints || {};
      const audioConstraints = {
        audio: typeof rtcConstraints.audio !== "undefined" ? rtcConstraints.audio : true
      };
      this._status = _Call.State.Connecting;
      const connect = () => {
        if (this._status !== _Call.State.Connecting) {
          this._cleanupEventListeners();
          this._mediaHandler.close();
          return;
        }
        const onAnswer = (pc) => {
          const eventName = this._direction === _Call.CallDirection.Incoming ? "accepted-by-local" : "accepted-by-remote";
          this._publisher.info("connection", eventName, null, this);
          const { codecName, codecParams } = getPreferredCodecInfo(this._mediaHandler.version.getSDP());
          this._publisher.info("settings", "codec", {
            codec_params: codecParams,
            selected_codec: codecName
          }, this);
          this._monitor.enable(pc);
        };
        const sinkIds = typeof this._options.getSinkIds === "function" && this._options.getSinkIds();
        if (Array.isArray(sinkIds)) {
          this._mediaHandler._setSinkIds(sinkIds).catch(() => {
          });
        }
        this._pstream.addListener("hangup", this._onHangup);
        if (this._direction === _Call.CallDirection.Incoming) {
          this._isAnswered = true;
          this._pstream.on("answer", this._onAnswer);
          this._mediaHandler.answerIncomingCall(this.parameters.CallSid, this._options.offerSdp, rtcConfiguration, onAnswer);
        } else {
          const params = Array.from(this.customParameters.entries()).map((pair) => `${encodeURIComponent(pair[0])}=${encodeURIComponent(pair[1])}`).join("&");
          this._pstream.on("answer", this._onAnswer);
          this._mediaHandler.makeOutgoingCall(params, this._signalingReconnectToken, this._options.reconnectCallSid || this.outboundConnectionId, rtcConfiguration, onAnswer);
        }
      };
      if (this._options.beforeAccept) {
        this._options.beforeAccept(this);
      }
      const inputStream = typeof this._options.getInputStream === "function" && this._options.getInputStream();
      const promise = inputStream ? this._mediaHandler.setInputTracksFromStream(inputStream) : this._mediaHandler.openDefaultDeviceWithConstraints(audioConstraints);
      promise.then(() => {
        this._publisher.info("get-user-media", "succeeded", {
          data: { audioConstraints }
        }, this);
        connect();
      }, (error2) => {
        let twilioError;
        if (error2.code === 31208 || ["PermissionDeniedError", "NotAllowedError"].indexOf(error2.name) !== -1) {
          twilioError = new UserMediaErrors.PermissionDeniedError();
          this._publisher.error("get-user-media", "denied", {
            data: {
              audioConstraints,
              error: error2
            }
          }, this);
        } else {
          twilioError = new UserMediaErrors.AcquisitionFailedError();
          this._publisher.error("get-user-media", "failed", {
            data: {
              audioConstraints,
              error: error2
            }
          }, this);
        }
        this._disconnect();
        this._log.debug("#error", error2);
        this.emit("error", twilioError);
      });
    }
    /**
     * Disconnect from the {@link Call}.
     */
    disconnect() {
      this._log.debug(".disconnect");
      this._disconnect();
    }
    /**
     * Get the local MediaStream, if set.
     */
    getLocalStream() {
      return this._mediaHandler && this._mediaHandler.stream;
    }
    /**
     * Get the remote MediaStream, if set.
     */
    getRemoteStream() {
      return this._mediaHandler && this._mediaHandler._remoteStream;
    }
    /**
     * Ignore the incoming {@link Call}.
     */
    ignore() {
      this._log.debug(".ignore");
      if (this._status !== _Call.State.Pending) {
        this._log.debug(`.ignore noop. status is '${this._status}'`);
        return;
      }
      this._status = _Call.State.Closed;
      this._mediaHandler.ignore(this.parameters.CallSid);
      this._publisher.info("connection", "ignored-by-local", null, this);
      if (this._onIgnore) {
        this._onIgnore();
      }
    }
    /**
     * Check whether call is muted
     */
    isMuted() {
      return this._mediaHandler.isMuted;
    }
    /**
     * Mute incoming audio.
     * @param shouldMute - Whether the incoming audio should be muted. Defaults to true.
     */
    mute(shouldMute = true) {
      this._log.debug(".mute", shouldMute);
      const wasMuted = this._mediaHandler.isMuted;
      this._mediaHandler.mute(shouldMute);
      const isMuted = this._mediaHandler.isMuted;
      if (wasMuted !== isMuted) {
        this._publisher.info("connection", isMuted ? "muted" : "unmuted", null, this);
        this._log.debug("#mute", isMuted);
        this.emit("mute", isMuted, this);
      }
    }
    /**
     * Post an event to Endpoint Analytics indicating that the end user
     *   has given call quality feedback. Called without a score, this
     *   will report that the customer declined to give feedback.
     * @param score - The end-user's rating of the call; an
     *   integer 1 through 5. Or undefined if the user declined to give
     *   feedback.
     * @param issue - The primary issue the end user
     *   experienced on the call. Can be: ['one-way-audio', 'choppy-audio',
     *   'dropped-call', 'audio-latency', 'noisy-call', 'echo']
     */
    postFeedback(score, issue) {
      if (typeof score === "undefined" || score === null) {
        return this._postFeedbackDeclined();
      }
      if (!Object.values(_Call.FeedbackScore).includes(score)) {
        throw new InvalidArgumentError(`Feedback score must be one of: ${Object.values(_Call.FeedbackScore)}`);
      }
      if (typeof issue !== "undefined" && issue !== null && !Object.values(_Call.FeedbackIssue).includes(issue)) {
        throw new InvalidArgumentError(`Feedback issue must be one of: ${Object.values(_Call.FeedbackIssue)}`);
      }
      return this._publisher.info("feedback", "received", {
        issue_name: issue,
        quality_score: score
      }, this, true);
    }
    /**
     * Reject the incoming {@link Call}.
     */
    reject() {
      this._log.debug(".reject");
      if (this._status !== _Call.State.Pending) {
        this._log.debug(`.reject noop. status is '${this._status}'`);
        return;
      }
      this._isRejected = true;
      this._pstream.reject(this.parameters.CallSid);
      this._mediaHandler.reject(this.parameters.CallSid);
      this._publisher.info("connection", "rejected-by-local", null, this);
      this._cleanupEventListeners();
      this._mediaHandler.close();
      this._status = _Call.State.Closed;
      this._log.debug("#reject");
      this.emit("reject");
    }
    /**
     * Send a string of digits.
     * @param digits
     */
    sendDigits(digits) {
      this._log.debug(".sendDigits", digits);
      if (digits.match(/[^0-9*#w]/)) {
        throw new InvalidArgumentError("Illegal character passed into sendDigits");
      }
      const customSounds = this._options.customSounds || {};
      const sequence = [];
      digits.split("").forEach((digit) => {
        let dtmf = digit !== "w" ? `dtmf${digit}` : "";
        if (dtmf === "dtmf*") {
          dtmf = "dtmfs";
        }
        if (dtmf === "dtmf#") {
          dtmf = "dtmfh";
        }
        sequence.push(dtmf);
      });
      const playNextDigit = () => {
        const digit = sequence.shift();
        if (digit) {
          if (this._options.dialtonePlayer && !customSounds[digit]) {
            this._options.dialtonePlayer.play(digit);
          } else {
            this._soundcache.get(digit).play();
          }
        }
        if (sequence.length) {
          setTimeout(() => playNextDigit(), 200);
        }
      };
      playNextDigit();
      const dtmfSender = this._mediaHandler.getOrCreateDTMFSender();
      function insertDTMF(dtmfs) {
        if (!dtmfs.length) {
          return;
        }
        const dtmf = dtmfs.shift();
        if (dtmf && dtmf.length) {
          dtmfSender.insertDTMF(dtmf, DTMF_TONE_DURATION, DTMF_INTER_TONE_GAP);
        }
        setTimeout(insertDTMF.bind(null, dtmfs), DTMF_PAUSE_DURATION);
      }
      if (dtmfSender) {
        if (!("canInsertDTMF" in dtmfSender) || dtmfSender.canInsertDTMF) {
          this._log.info("Sending digits using RTCDTMFSender");
          insertDTMF(digits.split("w"));
          return;
        }
        this._log.info("RTCDTMFSender cannot insert DTMF");
      }
      this._log.info("Sending digits over PStream");
      if (this._pstream !== null && this._pstream.status !== "disconnected") {
        this._pstream.dtmf(this.parameters.CallSid, digits);
      } else {
        const error2 = new GeneralErrors.ConnectionError("Could not send DTMF: Signaling channel is disconnected");
        this._log.debug("#error", error2);
        this.emit("error", error2);
      }
    }
    /**
     * Send a message to Twilio. Your backend application can listen for these
     * messages to allow communication between your frontend and backend applications.
     * <br/><br/>This feature is currently in Beta.
     * @param message - The message object to send.
     * @returns A voice event sid that uniquely identifies the message that was sent.
     */
    sendMessage(message) {
      this._log.debug(".sendMessage", JSON.stringify(message));
      const { content, contentType, messageType } = message;
      if (typeof content === "undefined" || content === null) {
        throw new InvalidArgumentError("`content` is empty");
      }
      if (typeof messageType !== "string") {
        throw new InvalidArgumentError("`messageType` must be a string.");
      }
      if (messageType.length === 0) {
        throw new InvalidArgumentError("`messageType` must be a non-empty string.");
      }
      if (this._pstream === null) {
        throw new InvalidStateError("Could not send CallMessage; Signaling channel is disconnected");
      }
      const callSid = this.parameters.CallSid;
      if (typeof this.parameters.CallSid === "undefined") {
        throw new InvalidStateError("Could not send CallMessage; Call has no CallSid");
      }
      const voiceEventSid = this._voiceEventSidGenerator();
      this._messages.set(voiceEventSid, { content, contentType, messageType, voiceEventSid });
      this._pstream.sendMessage(callSid, content, contentType, messageType, voiceEventSid);
      return voiceEventSid;
    }
    /**
     * Get the current {@link Call} status.
     */
    status() {
      return this._status;
    }
    /**
     * Check the volume passed, emitting a warning if one way audio is detected or cleared.
     * @param currentVolume - The current volume for this direction
     * @param streakFieldName - The name of the field on the {@link Call} object that tracks how many times the
     *   current value has been repeated consecutively.
     * @param lastValueFieldName - The name of the field on the {@link Call} object that tracks the most recent
     *   volume for this direction
     * @param direction - The directionality of this audio track, either 'input' or 'output'
     * @returns The current streak; how many times in a row the same value has been polled.
     */
    _checkVolume(currentVolume, currentStreak, lastValue, direction) {
      const wasWarningRaised = currentStreak >= 10;
      let newStreak = 0;
      if (lastValue === currentVolume) {
        newStreak = currentStreak;
      }
      if (newStreak >= 10) {
        this._emitWarning("audio-level-", `constant-audio-${direction}-level`, 10, newStreak, false);
      } else if (wasWarningRaised) {
        this._emitWarning("audio-level-", `constant-audio-${direction}-level`, 10, newStreak, true);
      }
      return newStreak;
    }
    /**
     * Clean up event listeners.
     */
    _cleanupEventListeners() {
      const cleanup = () => {
        if (!this._pstream) {
          return;
        }
        this._pstream.removeListener("ack", this._onAck);
        this._pstream.removeListener("answer", this._onAnswer);
        this._pstream.removeListener("cancel", this._onCancel);
        this._pstream.removeListener("error", this._onSignalingError);
        this._pstream.removeListener("hangup", this._onHangup);
        this._pstream.removeListener("ringing", this._onRinging);
        this._pstream.removeListener("transportClose", this._onTransportClose);
        this._pstream.removeListener("connected", this._onConnected);
        this._pstream.removeListener("message", this._onMessageReceived);
      };
      cleanup();
      setTimeout(cleanup, 0);
    }
    /**
     * Create the payload wrapper for a batch of metrics to be sent to Insights.
     */
    _createMetricPayload() {
      const payload = {
        call_sid: this.parameters.CallSid,
        dscp: !!this._options.dscp,
        sdk_version: RELEASE_VERSION
      };
      if (this._options.gateway) {
        payload.gateway = this._options.gateway;
      }
      payload.direction = this._direction;
      return payload;
    }
    /**
     * Disconnect the {@link Call}.
     * @param message - A message explaining why the {@link Call} is being disconnected.
     * @param wasRemote - Whether the disconnect was triggered locally or remotely.
     */
    _disconnect(message, wasRemote) {
      message = typeof message === "string" ? message : null;
      if (this._status !== _Call.State.Open && this._status !== _Call.State.Connecting && this._status !== _Call.State.Reconnecting && this._status !== _Call.State.Ringing) {
        return;
      }
      this._log.info("Disconnecting...");
      if (this._pstream !== null && this._pstream.status !== "disconnected" && this._shouldSendHangup) {
        const callsid = this.parameters.CallSid || this.outboundConnectionId;
        if (callsid) {
          this._pstream.hangup(callsid, message);
        }
      }
      this._cleanupEventListeners();
      this._mediaHandler.close();
      if (!wasRemote) {
        this._publisher.info("connection", "disconnected-by-local", null, this);
      }
    }
    /**
     * Transition to {@link CallStatus.Open} if criteria is met.
     */
    _maybeTransitionToOpen() {
      this._wasConnected;
      if (this._isAnswered) {
        this._onSignalingReconnected();
        this._signalingStatus = _Call.State.Open;
        if (this._mediaHandler && this._mediaHandler.status === "open") {
          this._status = _Call.State.Open;
          if (!this._wasConnected) {
            this._wasConnected = true;
            this._log.debug("#accept");
            this.emit("accept", this);
          }
        }
      }
    }
    /**
     * Post an event to Endpoint Analytics indicating that the end user
     *   has ignored a request for feedback.
     */
    _postFeedbackDeclined() {
      return this._publisher.info("feedback", "received-none", null, this, true);
    }
    /**
     * Publish the current set of queued metrics samples to Insights.
     */
    _publishMetrics() {
      if (this._metricsSamples.length === 0) {
        return;
      }
      this._publisher.postMetrics("quality-metrics-samples", "metrics-sample", this._metricsSamples.splice(0), this._createMetricPayload(), this).catch((e) => {
        this._log.warn("Unable to post metrics to Insights. Received error:", e);
      });
    }
    /**
     * Set the CallSid
     * @param payload
     */
    _setCallSid(payload) {
      const callSid = payload.callsid;
      if (!callSid) {
        return;
      }
      this.parameters.CallSid = callSid;
      this._mediaHandler.callSid = callSid;
    }
  };
  Call.toString = () => "[Twilio.Call class]";
  (function(Call2) {
    (function(State) {
      State["Closed"] = "closed";
      State["Connecting"] = "connecting";
      State["Open"] = "open";
      State["Pending"] = "pending";
      State["Reconnecting"] = "reconnecting";
      State["Ringing"] = "ringing";
    })(Call2.State || (Call2.State = {}));
    (function(FeedbackIssue) {
      FeedbackIssue["AudioLatency"] = "audio-latency";
      FeedbackIssue["ChoppyAudio"] = "choppy-audio";
      FeedbackIssue["DroppedCall"] = "dropped-call";
      FeedbackIssue["Echo"] = "echo";
      FeedbackIssue["NoisyCall"] = "noisy-call";
      FeedbackIssue["OneWayAudio"] = "one-way-audio";
    })(Call2.FeedbackIssue || (Call2.FeedbackIssue = {}));
    (function(FeedbackScore) {
      FeedbackScore[FeedbackScore["One"] = 1] = "One";
      FeedbackScore[FeedbackScore["Two"] = 2] = "Two";
      FeedbackScore[FeedbackScore["Three"] = 3] = "Three";
      FeedbackScore[FeedbackScore["Four"] = 4] = "Four";
      FeedbackScore[FeedbackScore["Five"] = 5] = "Five";
    })(Call2.FeedbackScore || (Call2.FeedbackScore = {}));
    (function(CallDirection) {
      CallDirection["Incoming"] = "INCOMING";
      CallDirection["Outgoing"] = "OUTGOING";
    })(Call2.CallDirection || (Call2.CallDirection = {}));
    (function(Codec) {
      Codec["Opus"] = "opus";
      Codec["PCMU"] = "pcmu";
    })(Call2.Codec || (Call2.Codec = {}));
    (function(IceGatheringFailureReason) {
      IceGatheringFailureReason["None"] = "none";
      IceGatheringFailureReason["Timeout"] = "timeout";
    })(Call2.IceGatheringFailureReason || (Call2.IceGatheringFailureReason = {}));
    (function(MediaFailure) {
      MediaFailure["ConnectionDisconnected"] = "ConnectionDisconnected";
      MediaFailure["ConnectionFailed"] = "ConnectionFailed";
      MediaFailure["IceGatheringFailed"] = "IceGatheringFailed";
      MediaFailure["LowBytes"] = "LowBytes";
    })(Call2.MediaFailure || (Call2.MediaFailure = {}));
  })(Call || (Call = {}));
  function generateTempCallSid() {
    return "TJSxxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }

  // public/dialer.js
  var device;
  var activeCall = null;
  var incomingCall = null;
  var muted = false;
  var $ = (id) => document.getElementById(id);
  var log = (msg) => {
    $("log").textContent += msg + "\n";
    $("log").scrollTop = $("log").scrollHeight;
  };
  var setStatus = (s) => $("status").textContent = s;
  async function fetchToken(identity) {
    const r = await fetch(`/twilio/token?identity=${encodeURIComponent(identity)}`);
    if (!r.ok) throw new Error("Token fetch failed");
    return r.json();
  }
  async function startDevice() {
    const identity = $("identity").value.trim();
    const { token } = await fetchToken(identity);
    device = new Device(token, {
      logLevel: 1
      // tokenRefreshMs: 30000, // optional: refresh before expiry
    });
    device.on("registered", () => {
      log("\u2705 Device registered, ready for incoming calls");
      setStatus("ready");
    });
    device.on("error", (e) => {
      log("\u274C Device error: " + (e?.message || e));
      setStatus("error");
    });
    device.on("incoming", (call) => {
      incomingCall = call;
      log("\u{1F4DE} Incoming call from: " + call.parameters.From);
      setStatus("incoming");
      call.on("disconnect", () => {
        log("\u{1F4F4} Incoming call ended");
        incomingCall = null;
        setStatus("ready");
      });
      call.on("error", (e) => log("\u274C Call error: " + (e?.message || e)));
    });
    await device.register();
  }
  async function makeCall() {
    if (!device) return log("Start device first.");
    if (activeCall) return log("Already on a call.");
    const to = $("to").value.trim();
    if (!to) return log("Enter a phone number.");
    setStatus("calling");
    log("\u{1F4F2} Dialing: " + to);
    activeCall = await device.connect({ params: { To: to } });
    activeCall.on("accept", () => {
      log("\u2705 Call connected");
      setStatus("in-call");
    });
    activeCall.on("disconnect", () => {
      log("\u{1F4F4} Call ended");
      activeCall = null;
      muted = false;
      setStatus("ready");
      $("mute").textContent = "Mute";
    });
    activeCall.on("error", (e) => {
      log("\u274C Call error: " + (e?.message || e));
    });
  }
  function hangup() {
    if (incomingCall) {
      incomingCall.reject();
      incomingCall = null;
      setStatus("ready");
      log("\u274E Rejected incoming call");
      return;
    }
    if (activeCall) {
      activeCall.disconnect();
    } else if (device) {
      device.disconnectAll();
    }
  }
  function acceptIncoming() {
    if (!incomingCall) return log("No incoming call.");
    incomingCall.accept();
    log("\u2705 Incoming call accepted");
    setStatus("in-call");
  }
  function rejectIncoming() {
    if (!incomingCall) return log("No incoming call.");
    incomingCall.reject();
    log("\u274E Incoming call rejected");
    incomingCall = null;
    setStatus("ready");
  }
  function toggleMute() {
    if (!activeCall) return log("No active call to mute.");
    muted = !muted;
    activeCall.mute(muted);
    $("mute").textContent = muted ? "Unmute" : "Mute";
    log(muted ? "\u{1F507} Muted" : "\u{1F50A} Unmuted");
  }
  $("startup").addEventListener("click", () => startDevice().catch((e) => log(e.message)));
  $("call").addEventListener("click", () => makeCall().catch((e) => log(e.message)));
  $("hangup").addEventListener("click", hangup);
  $("accept").addEventListener("click", acceptIncoming);
  $("reject").addEventListener("click", rejectIncoming);
  $("mute").addEventListener("click", toggleMute);
})();
