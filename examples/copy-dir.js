"use strict";

var fs = require('fs'),
	path = require('path'),
	EventEmitter = require('events').EventEmitter,
	async = require('async'),
	Copier = require('../').Copier,
	log = function (message) {
		console.log(new Date() + ": " + message);
	},
	toPath = function (info) {
		return path.join(info.path, info.name);
	},
	copyFile = function (source, target, cb) {
		// Code taken from http://stackoverflow.com/a/14387791/831314
		var cbCalled = false,
			done = function (err) {
				if (!cbCalled) {
					cb(err);
					cbCalled = true;
				}
			},
			rd = fs.createReadStream(source),
			wr = fs.createWriteStream(target);

		rd.on("error", function(err) {
			done(err);
		});
		wr.on("error", function(err) {
			done(err);
		});
		wr.on("close", function(err) {
			done(err);
		});
		rd.pipe(wr);
	},
	copier = new Copier({
		concurrency: 4,
		walkSourceTree: function (dirInfo) {
			var emitter = new EventEmitter(),
				dir = toPath(dirInfo);

			log("walkSourceTree(" + JSON.stringify(arguments) + ")");

			fs.readdir(dir, function (err, files) {
				if (err) {
					return emitter.emit('error', err);
				}

				async.parallel(files.map(function (file) {
					return function (callback) {
						fs.stat(path.join(dir, file), function (err, stats) {
							if (err) {
								emitter.emit('error', err);
								return callback(err);
							}

							var toEmit = { path: dir, name: file };
							if (stats.isFile()) {
								emitter.emit('leaf', toEmit);
								callback();
							} else if (stats.isDirectory()) {
								emitter.emit('tree', toEmit);
								callback();
							}
						});
					};
				}), function () {
					emitter.emit('done');
				});
			});
			return emitter;
		},
		createTargetTree: function (dirInfo, targetInfo, callback) {
			log("createTargetTree(" + JSON.stringify(arguments) + ")");
			fs.mkdir(path.join(toPath(targetInfo), dirInfo.name + ".copying"), function (err) {
				if (err) {
					return callback(err);
				}

				callback(undefined, { path: toPath(targetInfo), name: dirInfo.name + ".copying", originalName: dirInfo.name });
			});
		},
		finalizeTargetTree: function (newDirInfo, callback) {
			log("finalizeTargetTree(" + JSON.stringify(arguments) + ")");
			fs.rename(toPath(newDirInfo), toPath({ path: newDirInfo.path, name: newDirInfo.originalName }), function (err) {
				if (err && err.code === 'EPERM') {
					// It could be antivirus protection on Windows, try again within 10 seconds
					return setTimeout(function () {
						fs.rename(toPath(newDirInfo), toPath({ path: newDirInfo.path, name: newDirInfo.originalName }), callback);
					}, 2000);
				}

				callback(err);
			});
		},
		copyLeaf: function (fileInfo, targetDirInfo, callback) {
			log("copyLeaf(" + JSON.stringify(arguments) + ")");
			copyFile(toPath(fileInfo), path.join(toPath(targetDirInfo), fileInfo.name), callback);
		}
	});

copier.copy({ path: "D:\\Data\\GitHub\\micro-build-server", name: "." }, { path: "D:\\Data\\GitHub\\node-recursive-tree-copy\\examples\\result", name: "." }, function (err) {
	if (err) {
		return log(err);
	}

	log("done");
});
