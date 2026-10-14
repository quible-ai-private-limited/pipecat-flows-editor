import { useCallback, useEffect, useRef } from "react";

import {
  type EditorMessage,
  type FlowDataPayload,
  isAllowedOrigin,
  type LoadFlowPayload,
  parentOriginFromReferrer,
  parseAllowedOrigins,
  parseHostMessage,
} from "@/lib/embed/protocol";

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS);

export interface EmbedHandlers {
  /** Opens the host's flow; false when it cannot be opened. */
  onLoad: (payload: LoadFlowPayload) => boolean;
  onNew: () => void;
  snapshot: () => FlowDataPayload;
}

/**
 * The editor's side of the iframe messages (lib/embed/protocol.ts). Only an
 * allowed origin's parent window is listened to and written to; nothing
 * happens unless `embedded`.
 */
export function useEmbedBridge(embedded: boolean, handlers: EmbedHandlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const parentOriginRef = useRef<string | null>(null);

  const post = useCallback(
    (message: EditorMessage) => {
      if (!embedded || window.parent === window) return;
      const origin =
        parentOriginRef.current ?? parentOriginFromReferrer(document.referrer, ALLOWED_ORIGINS);
      // Until the host has written, try each allowed origin; the browser
      // delivers only to the one the parent actually has.
      for (const target of origin ? [origin] : ALLOWED_ORIGINS) {
        window.parent.postMessage(message, target);
      }
    },
    [embedded]
  );

  useEffect(() => {
    if (!embedded) return;
    if (ALLOWED_ORIGINS.length === 0) {
      console.error("Embedded editor: NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS is not set");
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !isAllowedOrigin(event.origin, ALLOWED_ORIGINS)) {
        return;
      }
      const message = parseHostMessage(event.data);
      if (!message) return;
      parentOriginRef.current = event.origin;
      switch (message.type) {
        case "LOAD_FLOW": {
          const ok = handlersRef.current.onLoad(message.payload);
          post(
            ok
              ? { type: "FLOW_LOADED", ok }
              : { type: "FLOW_LOADED", ok, error: "The flow could not be opened" }
          );
          break;
        }
        case "NEW_FLOW":
          handlersRef.current.onNew();
          break;
        case "GET_FLOW":
          post({
            type: "FLOW_DATA",
            requestId: message.requestId,
            payload: handlersRef.current.snapshot(),
          });
          break;
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "EDITOR_READY" });
    return () => window.removeEventListener("message", onMessage);
  }, [embedded, post]);

  const notifyChanged = useCallback(() => post({ type: "FLOW_CHANGED" }), [post]);
  return { notifyChanged };
}
