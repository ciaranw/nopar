/*jslint browser: false */
/*globals */
/*! Copyright (C) 2013 by Andreas F. Bobak, Switzerland. All Rights Reserved. !*/

var fs      = require("fs");
var path    = require("path");
var url     = require("url");
var winston = require("winston");

function makePackagePath(app, packagename) {
  var pkgPath = path.join(app.get("registryPath"), packagename);
  if (!fs.existsSync(pkgPath)) {
    fs.mkdirSync(pkgPath, "770");
  }
  return pkgPath;
}

function proxyFile(app, packagename, filename, forwardUrl, cb) {
  winston.info("Downloading tarball " + forwardUrl);

  var httpOptions = forwardUrl;
  var fileUrl     = url.parse(forwardUrl);
  var protocol;

  var forwarder  = app.get("forwarder");
  if (forwarder && forwarder.proxy) {
    var proxyUrl = url.parse(forwarder.proxy);
    winston.log("Using proxy at: " + proxyUrl);
    protocol     = proxyUrl.protocol.substr(0, proxyUrl.protocol.length - 1);
    httpOptions  = {
      hostname : proxyUrl.hostname,
      port     : proxyUrl.port,
      path     : forwardUrl,
      headers  : {
        host         : fileUrl.hostname,
        "User-Agent" : forwarder.userAgent
      }
    };
  } else {
    protocol = fileUrl.protocol.substr(0, fileUrl.protocol.length - 1);
  }

  var get = require(protocol).get;

  get(httpOptions, function (res) {
    if (res.statusCode !== 200) {
      return cb({
        text    : "Failed to retrieve dist package",
        details : res.statusCode
      });
    }
    res.on("error", function (err) {
      winston.error("Error while downloading " + forwardUrl + ": "  + JSON.stringify(err), err);
      cb(err);
    });

    var pkgPath  = makePackagePath(app, packagename);
    var filePath = path.join(pkgPath, filename);
    var out      = fs.createWriteStream(filePath, {
      flags    : "w",
      encoding : null,
      mode     : "0660"
    });
    out.on("error", function (err) {
      winston.error("Error while writing " + filePath + ": "  + JSON.stringify(err), err);
      cb(err);
    });
    res.on("end", function () {
      cb();
    });
    res.pipe(out);
  });
}

/**
 * https://github.com/isaacs/npmjs.org#put-packagename012
 */
exports.download = function (app) {
  return function(req, res) {
    winston.info("GET " + req.originalUrl);
    var packagename = req.params.packagename;
    var attachment  = req.params.attachment || "";
    var registry    = app.get("registry");

    if (attachment.indexOf("/") >= 0) {
      return res.json(404, {
        "error"  : "not_found",
        "reason" : "attachment not found"
      });
    }

    var pkgMeta = registry.getPackage(packagename);
    if (!pkgMeta) {
      return res.json(404, {
        "error"  : "not_found",
        "reason" : "package not found"
      });
    }

    var pkgPath  = makePackagePath(app, packagename);
    var filePath = path.join(pkgPath, attachment);
    if (!fs.existsSync(filePath)) {
      if (pkgMeta["_attachments"][attachment]) {
        proxyFile(
          app,
          packagename,
          attachment,
          pkgMeta["_attachments"][attachment].forwardUrl,
          function (err) {
            if (err) {
              return res.json("500", err);
            }
            pkgMeta["_attachments"][attachment].cached = true;
            registry.setPackage(pkgMeta);
            res.download(filePath, attachment);
        });
      } else {
        return res.json(404, {
          "error"  : "not_found",
          "reason" : "attachment not found"
        });
      }
    } else {
      res.download(filePath, attachment);
    }
  };
};

/**
 * https://github.com/isaacs/npmjs.org#put-packagename012
 */
exports.attach = function (app) {
  return function(req, res) {
    winston.info("PUT " + req.originalUrl);
    if (req.headers["content-type"] !== "application/octet-stream") {
      return res.json(400, {
        "error"  : "wrong_content",
        "reason" : "content-type MUST be application/octet-stream"
      });
    }

    var attachment = req.params["attachment"];
    if (attachment.indexOf("/") >= 0 || attachment.indexOf("%2F") >= 0) {
      return res.json(404, {
        "error"  : "not_found",
        "reason" : "attachment not found"
      });
    }

    var registry    = app.get("registry");
    var packagename = req.params["packagename"];
    var pkgMeta     = registry.getPackage(packagename);

    var pkgPath  = makePackagePath(app, packagename);
    var filePath = path.join(pkgPath, attachment);
    var out      = fs.createWriteStream(filePath, {
      flags    : "w",
      encoding : null,
      mode     : "0660"
    });
    req.pipe(out);
    req.on("end", function () {
      exports.refreshMeta(app, pkgMeta);
      registry.setPackage(pkgMeta);

      res.json(200, {
        "ok"  : true,
        "id"  : filePath,
        "rev" : "1"
      });
    });
  };
};

exports.detach = function (app) {
  return function(req, res) {
    winston.info("DELETE " + req.originalUrl, req.body);

    var attachment = req.params["attachment"];
    if (attachment.indexOf("/") >= 0 || attachment.indexOf("%2F") >= 0) {
      return res.json(404, {
        "error"  : "not_found",
        "reason" : "attachment not found"
      });
    }

    var registry    = app.get("registry");
    var packagename = req.params["packagename"];
    var pkgMeta     = registry.getPackage(packagename);
    if (!pkgMeta) {
      return res.json(404, {
        "error"  : "not_found",
        "reason" : "package not found"
      });
    }

    var pkgPath  = makePackagePath(app, req.params.packagename);
    var filePath = path.join(pkgPath, attachment);
    if (!fs.existsSync(filePath)) {
      return res.json(404, {
        "error"  : "not_found",
        "reason" : "attachment not found"
      });
    }

    fs.unlinkSync(filePath);
    exports.refreshMeta(app, pkgMeta);
    registry.setPackage(pkgMeta);

    res.json(200, {"ok" : true});
  };
};

exports.refreshMeta = function (app, pkgMeta) {
  var attachments = {};
  var packagename = pkgMeta.name;
  var pkgPath     = makePackagePath(app, packagename);

  for (var v in pkgMeta.versions) {
    var p = pkgMeta.versions[v];
    var attachment  = p.dist.tarball.substr(
                      p.dist.tarball.lastIndexOf("/") + 1);
    var origTarball = p.dist.tarball;
    var tarballUrl = {
      protocol : "http",
      port     : app.get("port"),
      hostname : app.get("hostname"),
      pathname : "/" + packagename + "/-/" + attachment
    };
    p.dist.tarball = url.format(tarballUrl);

    var filePath = path.join(pkgPath, attachment);
    attachments[attachment] = {
      cached     : fs.existsSync(filePath),
      forwardUrl : origTarball
    };
  }

  pkgMeta["_attachments"] = attachments;
};
