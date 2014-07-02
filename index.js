"use strict";

var async = require('async');

var checkNotEmpty = function (arg, argName) {
	if (!arg) {
		throw new Error(argName + " should be defined");
	}
};

var Copier = function (options) {
	var walkSourceTreeProcessor = function (processTask) {
			return function (source, onLeaf, onSubtree, callbackForTasks) {
				checkNotEmpty(callbackForTasks, "callbackForTasks");

				processTask(function (queueCallback) {
					var finished = false;
					options.walkSourceTree(source)
						.on('error', function (err) {
							if (!finished) {
								finished = true;
								queueCallback(err);
							}
						})
						.on('leaf', onLeaf)
						.on('tree', onSubtree)
						.on('done', function () {
							if (!finished) {
								finished = true;
								queueCallback();
							}
						});
				}, function (taskCallback) {
					return function (err) {
						callbackForTasks(err, taskCallback);
					};
				});
			};
		},
		createTargetTreeProcessor = function (processTask) {
			return function (tree, target, callbackForTasks) {
				checkNotEmpty(callbackForTasks, "callbackForTasks");

				processTask(function (queueCallback) {
					options.createTargetTree(tree, target, queueCallback);
				}, function (taskCallback) {
					return function (err, newTree) {
						callbackForTasks(err, newTree, taskCallback);
					};
				});
			};
		},
		finalizeTargetTreeProcessor = function (processTask) {
			return function (newTree, callbackForTasks) {
				checkNotEmpty(callbackForTasks, "callbackForTasks");

				processTask(function (queueCallback) {
					options.finalizeTargetTree(newTree, queueCallback);
				}, function (taskCallback) {
					return function (err) {
						callbackForTasks(err, taskCallback);
					};
				});
			};
		},
		copyLeafProcessor = function (processTask) {
			return function (leaf, target, callbackForTasks) {
				checkNotEmpty(callbackForTasks, "callbackForTasks");

				processTask(function (queueCallback) {
					options.copyLeaf(leaf, target, queueCallback);
				}, function (taskCallback) {
					return function (err) {
						callbackForTasks(err, taskCallback);
					};
				});
			};
		},
		createCopyImpl = function (outerCallback) {
			var queue = async.queue(function (task, callback) {
					task(callback);
				}, options.concurrency || 1),
				copyImpl = function (source, target, callback) {
					var tasksToProcess = 0,
						onTaskProcessed = function (err) {
							if (err) {
								var oldCallback = outerCallback;
								outerCallback = function () { return; };
								queue.kill();
								queue = { push: function () { return; }, kill: function () { return; } };
								oldCallback(err);
							}

							tasksToProcess = tasksToProcess - 1;
							if (tasksToProcess === 0) {
								callback();
							}
						},
						processTask = function (processor, postProcess) {
							tasksToProcess = tasksToProcess + 1;
							queue.push(function () {
								processor.apply(this, arguments);
							}, function () {
								postProcess(onTaskProcessed).apply(this, arguments);
							});
						},
						processLeaf = function (leaf) {
							copyLeafProcessor(processTask)(leaf, target, function (err, taskCallback) {
								taskCallback(err);
							});
						},
						processSubtree = function (tree) {
							createTargetTreeProcessor(processTask)(tree, target, function (err, newTree, taskCallback) {
								if (err) {
									return taskCallback(err);
								}

								copyImpl(tree, newTree, function (err) {
									if (err) {
										return taskCallback(err);
									}

									finalizeTargetTreeProcessor(processTask)(newTree, function (err, finalizeTaskCallback) {
										finalizeTaskCallback(err);
									});
									return taskCallback(err);
								});
							});
						};

					walkSourceTreeProcessor(processTask)(source, processLeaf, processSubtree, function (err, taskCallback) {
						return taskCallback(err);
					});
				};

			return function (source, target) {
				return copyImpl(source, target, outerCallback);
			};
		};

	this.copy = function (source, target, callback) {
		return createCopyImpl(callback)(source, target);
	};
};

exports.Copier = Copier;
