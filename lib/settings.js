/*jslint browser: false */
/*globals */
/*! Copyright (C) 2013 by Andreas F. Bobak, Switzerland. All Rights Reserved. !*/

var fs       = require("fs");
var path     = require("path");
var registry = require("./registry");
var winston  = require("winston");

var me = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json")));
exports.me = me;

var defaults = {
  logfile       : "",
  registryPath  : path.normalize(path.join(__dirname, "..", "registry")),
  hostname      : process.env.NOPAR_HOSTNAME || "localhost",
  port          : process.env.NOPAR_PORT || 5984,
  forwarder     : {
    registry    : process.env.NOPAR_FORWARDER_URL || "https://registry.npmjs.org",
    proxy       : process.env.NOPAR_PROXY_URL || null,
    autoForward : process.env.NOPAR_AUTO_FORWARD === null ||
                  process.env.NOPAR_AUTO_FORWARD === undefined ||
                  process.env.NOPAR_AUTO_FORWARD === "" ||
                  process.env.NOPAR_AUTO_FORWARD === "yes" ? true : false,
    userAgent   : process.env.NOPAR_USER_AGENT || "nopar/" + me.version
  }
};
exports.defaults = defaults;

function getRenderer(app) {
  return function renderSettings(req, res, message) {
    var vars = {
      title    : me.name + "@" + me.version,
      version  : me.version,
      message  : typeof message === "string" ? message : null,
      settings : {
        registryPath : app.get("registryPath"),
        forwarder    : app.get("forwarder"),
        hostname     : app.get("hostname"),
        port         : app.get("port")
      },
      defaults : app.get("defaults")
    };
    console.log("vars:", vars);
    if (vars.settings.forwarder.registry === defaults.forwarder.registry) {
      vars.settings.forwarder.registry = null;
    }
    if (vars.settings.forwarder.proxy === defaults.forwarder.proxy) {
      vars.settings.forwarder.proxy = null;
    }
    if (vars.settings.forwarder.proxy === defaults.forwarder.proxy) {
      vars.settings.forwarder.proxy = null;
    }
    if (vars.settings.forwarder.userAgent === defaults.forwarder.userAgent) {
      vars.settings.forwarder.userAgent = null;
    }
    if (vars.settings.hostname === defaults.hostname) {
      vars.settings.hostname = null;
    }
    if ("" + vars.settings.port === "" + defaults.port) {
      vars.settings.port = null;
    }

    res.render("settings", vars);
  };
}

exports.init = function init(app) {
  app.set("defaults", defaults);

  var settings = registry.getMeta().settings || {};
  if (!settings.forwarder) {
    settings.forwarder = {};
  }

  var forwarder = {
    registry    : settings.forwarder.registry || defaults.forwarder.registry,
    proxy       : settings.forwarder.proxy || defaults.forwarder.proxy,
    autoForward : settings.forwarder.autoForward === undefined ||
                  settings.forwarder.autoForward === null ?
                  defaults.forwarder.autoForward : settings.forwarder.autoForward,
    userAgent   : settings.forwarder.userAgent || defaults.forwarder.userAgent
  };
  app.set("forwarder", forwarder);
  app.set("hostname", settings.hostname || defaults.hostname);
  app.set("port", settings.port || defaults.port);
};

exports.render = function render(app) {
  return getRenderer(app);
};

exports.save = function save(app) {
  var renderer = getRenderer(app);

  return function (req, res, message) {
    var body = req.body;
    var forwarder = app.get("forwarder");
    var settings = {
      //registryPath : body.registryPath || app.get("registryPath"),
      hostname     : body.hostname || app.get("hostname"),
      port         : body.port || app.get("port"),
      forwarder    : {
        registry    : body.registry,
        proxy       : body.proxy,
        autoForward : body.autoForward ? true : false,
        userAgent   : body.userAgent
      }
    };

    winston.info("Saving settings: " + JSON.stringify(settings));

    var meta = registry.getMeta();
    meta.settings = settings;
    registry.writeMeta();

    exports.init(app);

    return renderer(req, res, message);
  };
};