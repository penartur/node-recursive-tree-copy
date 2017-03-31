/* tslint:disable:no-console */

"use strict";

import { parallel } from "async";
import { EventEmitter } from "events";
import { createReadStream, createWriteStream, mkdir, readdir, rename, stat } from "fs";
import { join } from "path";
import { createCopier } from "..";

interface IPathInfo {
    readonly name: string;
    readonly path: string;
}

interface ITemporaryPathInfo extends IPathInfo {
    readonly originalName: string;
}

const log = (message: string) => console.log(`${new Date()}: ${message}`);

const toPath = (info: IPathInfo) => join(info.path, info.name);

const copyFile = (source: string, target: string, callback: (err?: any) => void) => {
    // Code taken from http://stackoverflow.com/a/14387791/831314
    let cbCalled = false;
    const done = (err: any) => {
        if (!cbCalled) {
            callback(err);
            cbCalled = true;
        }
    };
    const rd = createReadStream(source);
    const wr = createWriteStream(target);

    wr.on("error", done).on("close", done);
    rd.on("error", done).pipe(wr);
};

const copier = createCopier({
    concurrency: 4,
    copyLeaf: (fileInfo: IPathInfo, targetDirInfo: IPathInfo, callback) => {
        log(`copyLeaf(${JSON.stringify(fileInfo)}, ${JSON.stringify(targetDirInfo)})`);
        copyFile(toPath(fileInfo), join(toPath(targetDirInfo), fileInfo.name), callback);
    },
    createTargetTree: (dirInfo: IPathInfo, targetInfo: IPathInfo, callback) => {
        log(`createTargetTree(${JSON.stringify(dirInfo)}, ${JSON.stringify(targetInfo)})`);
        const newDirName = dirInfo.name + ".copiying";
        mkdir(join(toPath(targetInfo), newDirName), (err) => {
            if (err) {
                return callback(err);
            }

            callback(undefined, { path: toPath(targetInfo), name: newDirName, originalName: dirInfo.name });
        });
    },
    finalizeTargetTree: (newDirInfo: ITemporaryPathInfo, callback) => {
        log(`finalizeTargetTree(${JSON.stringify(newDirInfo)})`);
        rename(toPath(newDirInfo), toPath({ path: newDirInfo.path, name: newDirInfo.originalName }), (err) => {
            if (err && err.code === "EPERM") {
                // It could be antivirus protection on Windows, try again within 10 seconds
                return setTimeout(() => rename(toPath(newDirInfo), toPath({ path: newDirInfo.path, name: newDirInfo.originalName }), callback), 2000);
            }

            return callback(err);
        });
    },
    walkSourceTree: (dirInfo: IPathInfo) => {
        const emitter = new EventEmitter();
        const dir = toPath(dirInfo);

        log(`walkSourceTree(${JSON.stringify(dirInfo)})`);

        readdir(dir, (readdirErr, files) => {
            if (readdirErr) {
                return emitter.emit("error", readdirErr);
            }

            return parallel(files.map((file) => (callback: (err?: any) => void) => stat(join(dir, file), (err, stats) => {
                if (err) {
                    emitter.emit("error", err);
                    return callback(err);
                }

                const toEmit = { path: dir, name: file };
                if (stats.isFile()) {
                    emitter.emit("leaf", toEmit);
                } else if (stats.isDirectory()) {
                    emitter.emit("tree", toEmit);
                }

                return callback();
            })), () => emitter.emit("done"));
        });

        return emitter;
    },
});

copier.copy({ path: "D:\\Data\\GitHub\\micro-build-server", name: "." }, { path: "D:\\Data\\GitHub\\node-recursive-tree-copy\\examples\\result", name: "." }, (err) => {
    if (err) {
        return log(err);
    }

    log("done");
});
