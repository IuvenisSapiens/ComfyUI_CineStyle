import { app } from "../../../scripts/app.js";

const NODE_ID = "CS_Save_Video";
const CLAIMED = "__csFreePreviewLayout";
// Core's PreviewVideo widget derives its own minimum height from the video
// aspect ratio and the node width captured when the element finished loading,
// then caches both in a closure:
//
//   setMinDimensions = (video) => { ...fitDimensionsToNodeWidth(
//       video.videoWidth, video.videoHeight, node.size[0]) }
//   widget.computeLayoutSize = () => ({ minHeight, minWidth })
//
// The closure is only refreshed on the next `loadeddata`, so the cached
// minimum keeps the widget, and therefore the whole node, from shrinking:
// a tall or since-widened video pins the outer frame to its aspect height.
// Replace that with the fixed viewport floor the core image preview widget and
// CS Preview Any use, so the user owns the node box and the media letterboxes
// inside the space that is left.
const MIN_VIEWPORT_HEIGHT = 220;
const PREVIEW_WIDGET_NAMES = ["video-preview", "preview"];

function widget(node, name) {
    return node.widgets?.find((item) => item.name === name);
}

function claimPreviewLayout(node) {
    for (const name of PREVIEW_WIDGET_NAMES) {
        const target = widget(node, name);
        if (!target || target[CLAIMED]) continue;
        target.computeLayoutSize = () => ({
            minHeight: MIN_VIEWPORT_HEIGHT,
            minWidth: 1,
        });
        target.aspectRatio = undefined;
        target[CLAIMED] = true;
        node.graph?.setDirtyCanvas?.(true, true);
    }
}

function claimWhenPresent(node) {
    if (!node) return;
    claimPreviewLayout(node);
    // Core creates the video element lazily after execution finishes, so the
    // widget can appear one frame later than the first claim attempt.
    if (!PREVIEW_WIDGET_NAMES.some((name) => widget(node, name))) {
        requestAnimationFrame(() => claimPreviewLayout(node));
    }
}

app.registerExtension({
    name: "CineStyle.SaveVideoPreviewLayout",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_ID) return;
        for (const hookName of ["onNodeCreated", "onExecuted"]) {
            const original = nodeType.prototype[hookName];
            nodeType.prototype[hookName] = function (...args) {
                const result = original?.apply(this, args);
                claimWhenPresent(this);
                return result;
            };
        }
        const onDrawBackground = nodeType.prototype.onDrawBackground;
        nodeType.prototype.onDrawBackground = function (...args) {
            const result = onDrawBackground?.apply(this, args);
            claimPreviewLayout(this);
            return result;
        };
    },
    loadedGraphNode(node) {
        if (node?.type !== NODE_ID && node?.comfyClass !== NODE_ID) return;
        claimWhenPresent(node);
    },
});
