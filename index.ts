"use strict";

import { queue as createQueue } from "async";

export interface ISimpleCallback {
    (err?: any): void;
}

interface ICallbackForTasks {
    (err: any, taskCallback: any): void;
}

interface ICallbackForTasksWithAdditional<TAdditional> {
    (err: any, additionalData: TAdditional, taskCallback: any): void;
}

interface IQueueTask {
    (taskCallback: ISimpleCallback): void;
}

interface IQueue {
    push(task: IQueueTask, callback: ISimpleCallback): void;
    kill(): void;
}

export interface IWalkerLeafHandler<TLeaf> {
    (leaf: TLeaf): void;
}

export interface IWalkerTreeHandler<TSource> {
    (tree: TSource): void;
}

interface IProcessTaskCallback {
    (taskCallback: any): (err: any) => void;
}

interface IProcessTask {
    (task: IQueueTask, callback: IProcessTaskCallback): void;
}

interface IProcessTaskCallbackWithAdditional<TAdditional> {
    (taskCallback: any): (err: any, additional: TAdditional) => void;
}

interface IProcessTaskWithAdditional<TAdditional> {
    (task: IQueueTask, callback: IProcessTaskCallbackWithAdditional<TAdditional>): void;
}

export interface ITreeWalker<TSource, TLeaf> {
    on(eventType: "tree", handler: IWalkerTreeHandler<TSource>): ITreeWalker<TSource, TLeaf>;
    on(eventType: "error", handler: (error: any) => void): ITreeWalker<TSource, TLeaf>;
    on(eventType: "leaf", handler: IWalkerLeafHandler<TLeaf>): ITreeWalker<TSource, TLeaf>;
    on(eventType: "done", handler: () => void): ITreeWalker<TSource, TLeaf>;
}

export interface ICopierOptions<TSource, TTemporaryTarget, TTarget, TLeaf> {
    readonly concurrency?: number;
    copyLeaf(leaf: TLeaf, target: TTarget, callback: ISimpleCallback): void;
    createTargetTree(subTree: TSource, target: TTarget, callback: (err?: any, newTarget?: TTemporaryTarget) => void): void;
    finalizeTargetTree(target: TTemporaryTarget, callback: ISimpleCallback): void;
    walkSourceTree(source: TSource): ITreeWalker<TSource, TLeaf>;
}

const checkNotEmpty = (arg: any, argName: string) => {
    if (!arg) {
        throw new Error(argName + " should be defined");
    }
};

export const createCopier = <TSource, TTemporaryTarget extends TTarget, TTarget, TLeaf>(options: ICopierOptions<TSource, TTemporaryTarget, TTarget, TLeaf>) => {
    const walkSourceTreeProcessor = (processTask: IProcessTask) => (source: TSource, onLeaf: IWalkerLeafHandler<TLeaf>, onSubtree: IWalkerTreeHandler<TSource>, callbackForTasks: ICallbackForTasks) => {
        checkNotEmpty(callbackForTasks, "callbackForTasks");

        processTask((queueCallback: ISimpleCallback) => {
            let finished = false;
            options.walkSourceTree(source)
                .on("error", (err) => {
                    if (!finished) {
                        finished = true;
                        queueCallback(err);
                    }
                })
                .on("leaf", onLeaf)
                .on("tree", onSubtree)
                .on("done", () => {
                    if (!finished) {
                        finished = true;
                        queueCallback();
                    }
                });
        }, (taskCallback) => (err) => callbackForTasks(err, taskCallback));
    };

    const createTargetTreeProcessor = (processTask: IProcessTaskWithAdditional<TTemporaryTarget>) => (tree: TSource, target: TTarget, callbackForTasks: ICallbackForTasksWithAdditional<TTemporaryTarget>) => {
        checkNotEmpty(callbackForTasks, "callbackForTasks");

        processTask(
            (queueCallback) => options.createTargetTree(tree, target, queueCallback),
            (taskCallback) => (err, newTree) => callbackForTasks(err, newTree, taskCallback),
        );
    };

    const finalizeTargetTreeProcessor = (processTask: IProcessTask) => (newTree: TTemporaryTarget, callbackForTasks: ICallbackForTasks) => {
        checkNotEmpty(callbackForTasks, "callbackForTasks");

        processTask(
            (queueCallback) => options.finalizeTargetTree(newTree, queueCallback),
            (taskCallback) => (err) => callbackForTasks(err, taskCallback),
        );
    };

    const copyLeafProcessor = (processTask: IProcessTask) => (leaf: TLeaf, target: TTarget, callbackForTasks: ICallbackForTasks) => {
        checkNotEmpty(callbackForTasks, "callbackForTasks");

        processTask(
            (queueCallback) => options.copyLeaf(leaf, target, queueCallback),
            (taskCallback) => (err) => callbackForTasks(err, taskCallback),
        );
    };

    const createCopyImpl = (outerCallback: ISimpleCallback) => {
        let queue = createQueue((task: IQueueTask, callback: ISimpleCallback) => task(callback), options.concurrency || 1) as IQueue;
        const copyImpl = (source: TSource, target: TTarget, callback: ISimpleCallback) => {
            let tasksToProcess = 0;
            const onTaskProcessed = (err: any) => {
                if (err) {
                    const oldCallback = outerCallback;
                    outerCallback = () => { return; };
                    queue.kill();
                    queue = { push: () => { return; }, kill: () => { return; } };
                    oldCallback(err);
                }

                tasksToProcess = tasksToProcess - 1;
                if (tasksToProcess === 0) {
                    callback();
                }
            };
            const processTask = (processor: IQueueTask, postProcess: IProcessTaskCallback) => {
                tasksToProcess = tasksToProcess + 1;
                queue.push(processor, postProcess(onTaskProcessed));
            };
            const processLeaf = (leaf: TLeaf) => copyLeafProcessor(processTask)(leaf, target, (err: any, taskCallback: ISimpleCallback) => taskCallback(err));
            const processSubtree = (tree: TSource) => createTargetTreeProcessor(processTask)(tree, target, (createTreeErr: any, newTree: TTemporaryTarget, taskCallback: ISimpleCallback) => {
                if (createTreeErr) {
                    return taskCallback(createTreeErr);
                }

                copyImpl(tree, newTree, (copyErr?: any) => {
                    if (copyErr) {
                        return taskCallback(copyErr);
                    }

                    finalizeTargetTreeProcessor(processTask)(newTree, (finalizeErr: any, finalizeTaskCallback) => finalizeTaskCallback(finalizeErr));
                    return taskCallback();
                });
            });

            walkSourceTreeProcessor(processTask)(source, processLeaf, processSubtree, (err, taskCallback) => taskCallback(err));
        };

        return (source: TSource, target: TTarget) => copyImpl(source, target, outerCallback);
    };

    const copy = (source: TSource, target: TTarget, callback: ISimpleCallback) => createCopyImpl(callback)(source, target);

    return { copy };
};
