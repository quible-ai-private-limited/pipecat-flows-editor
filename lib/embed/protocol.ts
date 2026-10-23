/**
 * The messages the editor exchanges with a page that embeds it in an iframe
 * (`/editor?embed=1`). The host page loads a flow into the editor, asks for it
 * back when the user saves, and hears when it has been edited. See
 * docs/EMBEDDING.md.
 */

import type { FlowConfig } from "@/lib/schema/flowConfig";
import type { NodePositions } from "@/lib/storage/positionStore";
import type { FlowIssue } from "@/lib/validation/flowIssues";

export const EMBED_QUERY_PARAM = "embed";
/** With `embed=1`, `view=1` shows the flow read-only, for a preview. */
export const VIEW_QUERY_PARAM = "view";

/** Sent by the host page. */
export type HostMessage =
  | { type: "LOAD_FLOW"; payload: LoadFlowPayload }
  | { type: "NEW_FLOW" }
  | { type: "GET_FLOW"; requestId?: string | number };

export interface LoadFlowPayload {
  flowName?: string;
  /** The flow as YAML text, as last saved; preferred, since it keeps comments. */
  yaml?: string;
  /** The flow as a FlowConfig object, used when there is no YAML. */
  flow?: unknown;
  /** Canvas positions as last saved, keyed by canvas node id. */
  positions?: NodePositions;
  /** The message the call opens with, as last saved (kept outside the FlowConfig). */
  initialMessage?: string;
}

/** Sent by the editor. */
export type EditorMessage =
  | { type: "EDITOR_READY" }
  | { type: "FLOW_LOADED"; ok: boolean; error?: string }
  | { type: "FLOW_DATA"; requestId?: string | number; payload: FlowDataPayload }
  | { type: "FLOW_CHANGED" };

export interface FlowDataPayload {
  flowName: string;
  /** The FlowConfig a Pipecat application loads. */
  flow: FlowConfig;
  /** The same flow as YAML text, with the comments it was opened with. */
  yaml: string;
  positions: NodePositions;
  /**
   * The message the call opens with, from the initial node's General tab.
   * Saved by the host next to the flow; not part of the FlowConfig.
   */
  initialMessage: string;
  /** Schema and reference errors, or the graph warnings when there are none. */
  issues: FlowIssue[];
  /** True when Pipecat would refuse to load the flow. */
  hasErrors: boolean;
}

export function isEmbedMode(search: string): boolean {
  return new URLSearchParams(search).get(EMBED_QUERY_PARAM) === "1";
}

export function isViewMode(search: string): boolean {
  return isEmbedMode(search) && new URLSearchParams(search).get(VIEW_QUERY_PARAM) === "1";
}

/** The comma-separated origins allowed to embed the editor, normalized. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0 && origin !== "*");
}

export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.includes(origin);
}

/** The origin of the embedding page from the iframe's referrer, when it is allowed. */
export function parentOriginFromReferrer(
  referrer: string,
  allowed: readonly string[]
): string | null {
  try {
    const origin = new URL(referrer).origin;
    return isAllowedOrigin(origin, allowed) ? origin : null;
  } catch {
    return null;
  }
}

function isPositions(value: unknown): value is NodePositions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as { x: unknown }).x === "number" &&
      typeof (p as { y: unknown }).y === "number"
  );
}

/** A host message, or null for anything else posted to the window. */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { type?: unknown; payload?: unknown; requestId?: unknown };
  switch (message.type) {
    case "NEW_FLOW":
      return { type: "NEW_FLOW" };
    case "GET_FLOW": {
      const { requestId } = message;
      return typeof requestId === "string" || typeof requestId === "number"
        ? { type: "GET_FLOW", requestId }
        : { type: "GET_FLOW" };
    }
    case "LOAD_FLOW": {
      const payload = message.payload;
      if (typeof payload !== "object" || payload === null) return null;
      const { flowName, yaml, flow, positions, initialMessage } = payload as Record<
        string,
        unknown
      >;
      return {
        type: "LOAD_FLOW",
        payload: {
          flowName: typeof flowName === "string" && flowName.trim() ? flowName.trim() : undefined,
          yaml: typeof yaml === "string" && yaml.trim() ? yaml : undefined,
          flow: typeof flow === "object" && flow !== null ? flow : undefined,
          positions: isPositions(positions) ? positions : undefined,
          initialMessage: typeof initialMessage === "string" ? initialMessage : undefined,
        },
      };
    }
    default:
      return null;
  }
}

/** The text to open for a LOAD_FLOW: its YAML, else its FlowConfig (JSON is YAML). */
export function flowTextFromPayload(payload: LoadFlowPayload): string | null {
  if (payload.yaml) return payload.yaml;
  if (payload.flow) return JSON.stringify(payload.flow, null, 2);
  return null;
}
